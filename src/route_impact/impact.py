"""Compare coordinate trips using stable directed segments and endpoint identity."""

import csv
from collections.abc import Iterable, Mapping
from dataclasses import asdict
from math import inf, isfinite
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
from scipy.spatial import cKDTree

from route_impact.graph import Graph, Route, Segment, build_graph, route_pairs
from route_impact.risk import Thresholds, exit_code, risk_level
from route_impact.rootcause import WayInfo, explain_trips, load_way_info


def read_trips(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="", encoding="utf-8") as source:
        return list(csv.DictReader(source))


class Snapper:
    """Index projected candidate coordinates; resolve distance ties by node id."""

    def __init__(self, nodes: Iterable[tuple[int, float, float]]) -> None:
        ordered = sorted(nodes)
        self.ids = [n[0] for n in ordered]
        self.coords = np.radians([(n[1], n[2]) for n in ordered]).reshape(-1, 2)
        self.scale = float(np.cos(self.coords[:, 0].mean())) if ordered else 1.0
        self.tree = cKDTree(self.project(self.coords))

    def project(self, coords: np.ndarray) -> np.ndarray:
        return 6371008.8 * np.column_stack((coords[:, 1] * self.scale, coords[:, 0]))

    def nearest(self, lat: float, lon: float) -> tuple[int | None, float]:
        if not self.ids:
            return None, inf
        point = np.radians([[lat, lon]])
        projected = self.project(point)[0]
        distance, _ = self.tree.query(projected)
        candidates = self.tree.query_ball_point(projected, float(distance) + 1e-7)
        # The query radius admits only floating-point ties at this tolerance.
        index = min(candidates, key=lambda i: self.ids[i])
        delta = self.coords[index] - point[0]
        hav = (
            np.sin(delta[0] / 2) ** 2
            + np.cos(point[0, 0]) * np.cos(self.coords[index, 0]) * np.sin(delta[1] / 2) ** 2
        )
        metres = float(2 * 6371008.8 * np.arcsin(np.sqrt(np.clip(hav, 0, 1))))
        return self.ids[index], metres


def snapshot_nodes(
    db: Path, graph: Graph, threads: int, memory_limit: str
) -> list[tuple[int, float, float]]:
    with duckdb.connect(
        str(db), config={"threads": threads, "memory_limit": memory_limit}
    ) as connection:
        return [
            row
            for row in connection.execute(
                "SELECT node_id, lat, lon FROM road_nodes ORDER BY node_id"
            ).fetchall()
            if row[0] in graph.indices
        ]


def new_endpoint(
    node: int, lat: float, lon: float, graph: Graph, snapper: Snapper, limit: float
) -> tuple[int | None, bool]:
    if node in graph.indices:
        return node, False
    replacement, distance = snapper.nearest(lat, lon)
    return (replacement if distance <= limit else None), True


def segment_costs(graph: Graph) -> dict[tuple[int, int], float]:
    costs: dict[tuple[int, int], float] = {}
    for edge in graph.edges:
        for segment in edge.segments:
            pair = segment.a, segment.b
            costs[pair] = min(costs.get(pair, inf), segment.seconds)
    return costs


def path_ids(segments: tuple[Segment, ...] | None) -> list[list[int]] | None:
    return None if segments is None else [[s.a, s.b, s.way_id] for s in segments]


def prepare_trips(trips: Iterable[Mapping[str, Any]], old_snapper: Snapper) -> list[dict[str, Any]]:
    """Validate coordinate rows and snap endpoints to the supplied OLD index."""
    prepared = []
    seen = set()
    for source in trips:
        trip = dict(source)
        if not trip["trip_id"] or trip["trip_id"] in seen:
            raise ValueError("trip_id must be nonempty and unique")
        seen.add(trip["trip_id"])
        if trip["kind"] not in {"intercity", "local"}:
            raise ValueError("kind must be intercity or local")
        for key in ("o_lat", "o_lon", "d_lat", "d_lon"):
            trip[key] = float(trip[key])
            if not isfinite(trip[key]):
                raise ValueError(f"{key} must be finite")
        raw_weight = trip["weight"]
        try:
            weight = int(raw_weight)
        except (ValueError, TypeError, OverflowError) as error:
            raise ValueError("weight must be a positive integer") from error
        if (
            isinstance(raw_weight, bool)
            or weight <= 0
            or (not isinstance(raw_weight, str) and weight != raw_weight)
        ):
            raise ValueError("weight must be a positive integer")
        trip["weight"] = weight
        if any(
            abs(trip[k]) > limit
            for k, limit in (("o_lat", 90), ("d_lat", 90), ("o_lon", 180), ("d_lon", 180))
        ):
            raise ValueError("Invalid weight or coordinates")
        trip["old_origin"] = old_snapper.nearest(trip["o_lat"], trip["o_lon"])[0]
        trip["old_destination"] = old_snapper.nearest(trip["d_lat"], trip["d_lon"])[0]
        prepared.append(trip)
    return prepared


def finish_trip(
    record: dict[str, Any], routes: Mapping[tuple[int, int], Route], slow_seconds: float
) -> None:
    """Attach NEW route measurements and worsening status to a prepared record."""
    lost = record["new_origin"] is None or record["new_destination"] is None
    route = (
        Route(inf, None) if lost else routes.get((record["new_origin"], record["new_destination"]))
    )
    seconds = route.seconds if route is not None else record["old_seconds"]
    delay = seconds - record["old_seconds"]
    status = "broken" if not isfinite(seconds) else "slowed" if delay >= slow_seconds else "ok"
    record.update(
        new_seconds=seconds,
        delay_s=delay,
        status=status,
        reason="endpoint_lost"
        if lost
        else "unreachable"
        if status == "broken"
        else "slower"
        if status == "slowed"
        else None,
        new_path=path_ids(route.segments) if route is not None else record["old_path"],
        improved=isfinite(delay) and delay < 0,
    )


def compare_trips(
    old_graph: Graph,
    new_graph: Graph,
    old_nodes: Iterable[tuple[int, float, float]],
    new_nodes: Iterable[tuple[int, float, float]],
    trips: Iterable[Mapping[str, Any]],
    thresholds: Thresholds,
    *,
    full: bool = False,
    batch: int = 32,
    old_routes: Mapping[tuple[int, int], Route] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return all routed records (including ok/improved trips) and excluded inputs.

    Incremental times retain the OLD time for skipped trips. Improvements are
    measured on rerouted trips; full mode also measures improvements elsewhere.
    """
    lscc = old_graph.lscc()
    old_snapper = Snapper(n for n in old_nodes if n[0] in lscc)
    new_snapper = Snapper(new_nodes)
    prepared = prepare_trips(trips, old_snapper)
    old_routes = (
        old_routes
        if old_routes is not None
        else route_pairs(
            old_graph,
            (
                (t["old_origin"], t["old_destination"])
                for t in prepared
                if t["old_origin"] is not None and t["old_destination"] is not None
            ),
            batch,
        )
    )
    costs = segment_costs(new_graph)
    records, excluded = [], []
    for trip in prepared:
        origin, destination = trip["old_origin"], trip["old_destination"]
        old_route = old_routes.get((origin, destination), Route(inf, None))
        if origin == destination or old_route.segments is None:
            excluded.append(trip)
            continue
        changed = tuple(
            s for s in old_route.segments if costs.get((s.a, s.b), inf) > s.seconds + 1e-6
        )
        new_origin, origin_fallback = new_endpoint(
            origin, trip["o_lat"], trip["o_lon"], new_graph, new_snapper, thresholds.snap_fallback_m
        )
        new_destination, destination_fallback = new_endpoint(
            destination,
            trip["d_lat"],
            trip["d_lon"],
            new_graph,
            new_snapper,
            thresholds.snap_fallback_m,
        )
        fallback = origin_fallback or destination_fallback
        records.append(
            {
                "trip_id": trip["trip_id"],
                "kind": trip["kind"],
                "weight": trip["weight"],
                "old_origin": origin,
                "old_destination": destination,
                "new_origin": new_origin,
                "new_destination": new_destination,
                "fallback_snap": fallback,
                "changed_segments": path_ids(changed),
                "old_path": path_ids(old_route.segments),
                "old_seconds": old_route.seconds,
                "rerouted": bool(full or changed or fallback),
            }
        )
    new_routes = route_pairs(
        new_graph,
        (
            (t["new_origin"], t["new_destination"])
            for t in records
            if t["rerouted"] and t["new_origin"] is not None and t["new_destination"] is not None
        ),
        batch,
    )
    for record in records:
        finish_trip(record, new_routes, thresholds.slow_seconds)
    return sorted(records, key=lambda t: t["trip_id"]), excluded


def summarize(
    records: list[dict[str, Any]], excluded: list[dict[str, Any]], thresholds: Thresholds
) -> dict[str, Any]:
    def counts(rows: list[dict[str, Any]], omitted: list[dict[str, Any]]) -> dict[str, Any]:
        delays = [r["delay_s"] for r in rows if r["status"] == "slowed"]
        return {
            "trips_total": len(rows) + len(omitted),
            "excluded_old": len(omitted),
            "routed": len(rows),
            "rerouted": sum(r["rerouted"] for r in rows),
            "changed_segments": len({tuple(s[:2]) for r in rows for s in r["changed_segments"]}),
            "broken": sum(r["status"] == "broken" for r in rows),
            "slowed": len(delays),
            "improved": sum(r["improved"] for r in rows),
            "delay_median_s": float(np.percentile(delays, 50)) if delays else None,
            "delay_p95_s": float(np.percentile(delays, 95)) if delays else None,
        }

    metrics = counts(records, excluded)
    for kind in ("intercity", "local"):
        metrics[kind] = counts(
            [r for r in records if r["kind"] == kind], [r for r in excluded if r["kind"] == kind]
        )
    intercity = [r for r in records if r["kind"] == "intercity"]
    denominator = sum(r["weight"] for r in intercity)
    for key, seconds in (
        ("gravity_share_affected", thresholds.slow_seconds),
        ("gravity_share_high", thresholds.high_slow_seconds),
    ):
        metrics[key] = (
            sum(
                r["weight"] for r in intercity if r["status"] == "broken" or r["delay_s"] >= seconds
            )
            / denominator
            if denominator
            else 0.0
        )
    return metrics


def json_safe(value: Any) -> Any:
    """Sort mappings and replace nonfinite floats before deterministic serialization."""
    if isinstance(value, dict):
        return {key: json_safe(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, float):
        return round(value, 2) if isfinite(value) else None
    return value


def compute_impact(
    old_db: Path,
    new_db: Path,
    trips: Iterable[Mapping[str, Any]],
    thresholds: Thresholds,
    *,
    old_label: str,
    new_label: str,
    full: bool = False,
    batch: int = 32,
    threads: int = 2,
    memory_limit: str = "2GB",
) -> dict:
    old_graph = build_graph(old_db, threads=threads, memory_limit=memory_limit)
    return impact_from_graphs(
        old_graph,
        snapshot_nodes(old_db, old_graph, threads, memory_limit),
        load_way_info(old_db, threads=threads, memory_limit=memory_limit),
        new_db,
        trips,
        thresholds,
        old_label=old_label,
        new_label=new_label,
        full=full,
        batch=batch,
        threads=threads,
        memory_limit=memory_limit,
    )


def impact_from_graphs(
    old_graph: Graph,
    old_nodes: list[tuple[int, float, float]],
    old_ways: dict[int, WayInfo],
    new_db: Path,
    trips: Iterable[Mapping[str, Any]],
    thresholds: Thresholds,
    *,
    old_label: str,
    new_label: str,
    full: bool = False,
    batch: int = 32,
    threads: int = 2,
    memory_limit: str = "2GB",
    old_routes: Mapping[tuple[int, int], Route] | None = None,
    raw_trips: list[dict[str, Any]] | None = None,
    new_graph: Graph | None = None,
    new_nodes: list[tuple[int, float, float]] | None = None,
    new_ways: dict[int, WayInfo] | None = None,
) -> dict:
    """Reuse supplied snapshot data; raw_trips receives all unrounded route records."""
    if new_graph is None:
        new_graph = build_graph(new_db, threads=threads, memory_limit=memory_limit)
    if new_nodes is None:
        new_nodes = snapshot_nodes(new_db, new_graph, threads, memory_limit)
    if new_ways is None:
        new_ways = load_way_info(new_db, threads=threads, memory_limit=memory_limit)
    records, excluded = compare_trips(
        old_graph,
        new_graph,
        old_nodes,
        new_nodes,
        trips,
        thresholds,
        full=full,
        batch=batch,
        old_routes=old_routes,
    )
    metrics = summarize(records, excluded, thresholds)
    level, rule = risk_level(metrics, thresholds)
    affected = [
        {k: v for k, v in r.items() if k not in {"rerouted", "improved"}}
        for r in records
        if r["status"] in {"broken", "slowed"}
    ]
    culprits, candidates = explain_trips(
        affected,
        old_graph,
        new_graph,
        old_ways,
        new_ways,
        thresholds.slow_seconds,
    )
    if raw_trips is not None:
        raw_trips.extend(records)
    return json_safe(
        {
            "old": old_label,
            "new": new_label,
            "mode": "full" if full else "incremental",
            "thresholds": asdict(thresholds),
            "metrics": metrics,
            "risk": {"level": level, "rule": rule},
            "exit_code": exit_code(level),
            "excluded_trip_ids": sorted(t["trip_id"] for t in excluded),
            "trips": affected,
            "culprits": culprits,
            "candidates": candidates,
        }
    )
