"""Python oracle for the fault playground (PLAYGROUND §5.4, §5.5, §5.8; PLAN P1b).

Reads a format-v1 export directory (shipped arrays only, never DuckDB), applies one Stomp,
Flip, Meteor or compound way-id edit as an active-mask change, fully recomputes every trip,
and runs the uncapped "what mattered" counterfactuals. The result is the canonical-v1
schema that the browser's `canonical()` must also produce. Written from the PLAN spec; it
does not port the spike's `procedure.js` or `precompute_presets`.
"""

import functools
import gzip
import hashlib
import json
import math
import os
from collections import defaultdict
from collections.abc import Iterable, Iterator, Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from scipy.sparse.csgraph import dijkstra

from route_impact.playground import ROOT, BaselineCsr, baseline_csr, load_config, write_export

CHUNK = 64  # origins per scipy Dijkstra call
DRAWN_ROWS = 25  # rows whose after-edit path a preset ships (the pipeline map's cap)
WEAPONS = ("stomp", "flip", "meteor")


class OracleError(RuntimeError):
    """An invariant of the playground method failed on this export."""


@dataclass(frozen=True, slots=True)
class Export:
    """The shipped arrays of one export, plus indexes derived from them."""

    meta: dict
    vertices: int
    edge_source: np.ndarray
    edge_target: np.ndarray
    edge_ms: np.ndarray
    edge_way: np.ndarray
    initially_active: np.ndarray  # bool
    way_osm_id: np.ndarray  # int64
    way_oneway: np.ndarray  # bool
    geometry_offsets: np.ndarray
    geometry_coords: np.ndarray
    trip_origin: np.ndarray
    trip_destination: np.ndarray
    trip_ms: np.ndarray  # int64
    path_offsets: np.ndarray
    path_edges: np.ndarray
    way_edges_sorted: np.ndarray  # edge ids grouped by way
    way_edges_offsets: np.ndarray
    slow_ms: int
    earth_radius_m: float
    geometry_scale: float

    @property
    def trips(self) -> int:
        return len(self.trip_origin)

    def way_edges(self, ways: Sequence[int]) -> np.ndarray:
        parts = [
            self.way_edges_sorted[self.way_edges_offsets[w] : self.way_edges_offsets[w + 1]]
            for w in ways
        ]
        return np.concatenate(parts) if parts else np.zeros(0, np.int64)

    def path(self, trip: int) -> np.ndarray:
        return self.path_edges[self.path_offsets[trip] : self.path_offsets[trip + 1]]


# --- Loading ---------------------------------------------------------------------------------


def _read_array(directory: Path, entry: Mapping[str, Any], hashes: Mapping[str, str]) -> np.ndarray:
    packed = (directory / entry["file"]).read_bytes()
    expected = hashes.get(entry["file"])
    if expected is not None and hashlib.sha256(packed).hexdigest() != expected:
        raise OracleError(f"{entry['file']} does not match its sha256 in meta.json")
    array = np.frombuffer(gzip.decompress(packed), dtype=entry["dtype"])
    if len(array) != entry["length"]:
        raise OracleError(f"{entry['file']} has {len(array)} values, meta says {entry['length']}")
    return array


def _earth_radius(meta: Mapping[str, Any]) -> float:
    """meta.json's radius; the format-0 spike export predates the key, so it uses the toml."""
    if "earth_radius_m" in meta:
        return float(meta["earth_radius_m"])
    if meta.get("format_version") == 0:
        return load_config(ROOT / "config/playground.toml").earth_radius_m
    raise KeyError("meta.json has no earth_radius_m")


def _as_int(values: np.ndarray, name: str) -> np.ndarray:
    integers = values.astype(np.int64)
    if not np.array_equal(integers, values):
        raise OracleError(f"{name} must hold whole numbers")
    return integers


def check_twins(
    edge_way: np.ndarray, active: np.ndarray, twin: np.ndarray, oneway: np.ndarray
) -> None:
    """Every inactive edge is the twin of an active edge of the same one-way way, and back.

    The Flip mask toggles a one-way way's edges, so this pairing is what makes it correct.
    """
    inactive = np.flatnonzero(~active)
    pair = twin[inactive]
    if np.any(pair < 0):
        raise OracleError("An initially inactive edge has no twin")
    if not (
        np.all(active[pair])
        and np.array_equal(twin[pair], inactive)
        and np.array_equal(edge_way[pair], edge_way[inactive])
        and np.all(oneway[edge_way[inactive]])
    ):
        raise OracleError("Inactive edges must be twins of active edges of the same one-way way")
    forward = np.flatnonzero(active & oneway[edge_way])
    if np.any(twin[forward] < 0) or np.any(active[twin[forward]]):
        raise OracleError("Every active edge of a one-way way needs an inactive twin")


def load_export(directory: Path) -> Export:
    meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
    if meta.get("format_version") not in (0, 1):
        raise OracleError(f"Unsupported format_version {meta.get('format_version')}")
    hashes = {row["file"]: row["sha256"] for row in meta["files"] if "sha256" in row}
    a = {e["name"]: _read_array(directory, e, hashes) for e in meta["arrays"]}
    offsets = a["csr_offsets"].astype(np.int64)
    vertices = len(offsets) - 1
    edge_way = a["edge_way"].astype(np.int64)
    ways = len(a["way_osm_id"])
    active = a["edge_initially_active"].astype(bool)
    oneway = a["way_oneway"].astype(bool)
    check_twins(edge_way, active, a["edge_twin"].astype(np.int64), oneway)
    by_way = np.argsort(edge_way, kind="stable")
    way_offsets = np.r_[0, np.cumsum(np.bincount(edge_way, minlength=ways))]
    return Export(
        meta=meta,
        vertices=vertices,
        edge_source=np.repeat(np.arange(vertices, dtype=np.int64), np.diff(offsets)),
        edge_target=a["edge_target"].astype(np.int64),
        edge_ms=a["edge_ms"].astype(np.int64),
        edge_way=edge_way,
        initially_active=active,
        way_osm_id=_as_int(a["way_osm_id"], "way_osm_id"),
        way_oneway=oneway,
        geometry_offsets=a["geometry_offsets"].astype(np.int64),
        geometry_coords=a["geometry_coords"].astype(np.int64),
        trip_origin=a["trip_origin"].astype(np.int64),
        trip_destination=a["trip_destination"].astype(np.int64),
        trip_ms=_as_int(a["trip_ms"], "trip_ms"),
        path_offsets=a["trip_path_offsets"].astype(np.int64),
        path_edges=a["trip_path_edges"].astype(np.int64),
        way_edges_sorted=by_way,
        way_edges_offsets=way_offsets,
        slow_ms=round(float(meta["slow_seconds"]) * 1000),
        earth_radius_m=_earth_radius(meta),
        geometry_scale=float(meta["geometry_scale"]),
    )


# --- Edits -----------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Edit:
    weapon: str
    ways: tuple[int, ...]  # dense way indices, ascending OSM id

    @property
    def counterfactuals(self) -> bool:
        """Meteor, or more than one way hit (so a 1-way Meteor and a multi-way Flip test)."""
        return self.weapon == "meteor" or len(self.ways) > 1


def segment_distances2(export: Export, lat: float, lon: float) -> tuple[np.ndarray, np.ndarray]:
    """(way per segment, squared metres from the tap to each clamped segment projection).

    Equirectangular metres at the tap's latitude, with these exact operations (the browser
    must use the same order so a segment at exactly r agrees):
    `k = R × π / 180`, `kx = k × cos(lat0 × π / 180)`, `x = (lon − lon0) × kx`,
    `y = (lat − lat0) × k`, coordinates = shipped integer / geometry_scale. A way with
    fewer than 2 points has no segments.
    """
    k = export.earth_radius_m * math.pi / 180
    kx = k * math.cos(lat * math.pi / 180)
    points = export.geometry_coords.reshape(-1, 2) / export.geometry_scale
    y = (points[:, 0] - lat) * k
    x = (points[:, 1] - lon) * kx
    point_way = np.repeat(
        np.arange(len(export.geometry_offsets) - 1), np.diff(export.geometry_offsets)
    )
    start = np.flatnonzero(point_way[:-1] == point_way[1:])
    ax, ay = x[start], y[start]
    dx, dy = x[start + 1] - ax, y[start + 1] - ay
    length2 = dx * dx + dy * dy
    projection = np.divide(
        -(ax * dx + ay * dy), length2, out=np.zeros(len(start)), where=length2 > 0
    )
    t = np.clip(projection, 0.0, 1.0)
    cx, cy = ax + t * dx, ay + t * dy
    return point_way[start], cx * cx + cy * cy


def meteor_hits(export: Export, lat: float, lon: float, radius_m: float) -> list[int]:
    """Dense way indices with any segment within radius_m of the tap (distance² ≤ r²)."""
    ways, distance2 = segment_distances2(export, lat, lon)
    return sorted(set(ways[distance2 <= radius_m * radius_m].tolist()))


def _way_ids(case: Mapping[str, Any]) -> list[int]:
    ids = case.get("way_ids", [case["way_id"]] if "way_id" in case else None)
    if not ids:
        raise ValueError("Stomp and Flip need way_id or way_ids")
    return [int(w) for w in ids]


def parse_edit(export: Export, case: Mapping[str, Any]) -> Edit:
    """Resolve a case (`weapon` plus way ids, or Meteor lat/lon/radius_m) to dense ways."""
    weapon = case["weapon"]
    if weapon not in WEAPONS:
        raise ValueError(f"Unknown weapon {weapon!r}")
    if weapon == "meteor":
        lat, lon = float(case["lat"]), float(case["lon"])
        box = export.meta["box"]
        if not (
            box["min_lat"] <= lat <= box["max_lat"] and box["min_lon"] <= lon <= box["max_lon"]
        ):
            raise ValueError(f"Meteor tap lat={lat}, lon={lon} is outside the export box {box}")
        ways = meteor_hits(export, lat, lon, float(case["radius_m"]))
    else:
        ids = _way_ids(case)
        duplicates = sorted({w for w in ids if ids.count(w) > 1})
        if duplicates:
            raise ValueError(f"Duplicate way ids in the edit: {duplicates}")
        dense = {int(osm): i for i, osm in enumerate(export.way_osm_id)}
        missing = [w for w in ids if w not in dense]
        if missing:
            raise ValueError(f"Way ids not in the export: {missing}")
        ways = sorted(dense[w] for w in ids)
        if weapon == "flip" and not all(export.way_oneway[ways]):
            two_way = [int(export.way_osm_id[w]) for w in ways if not export.way_oneway[w]]
            raise ValueError(f"Flip needs one-way roads; two-way: {two_way}")
    return Edit(weapon, tuple(sorted(ways, key=lambda w: export.way_osm_id[w])))


def edited_mask(export: Export, edit: Edit) -> np.ndarray:
    """Stomp/Meteor deactivate every edge of the ways; Flip swaps forward edges and twins."""
    mask = export.initially_active.copy()
    edges = export.way_edges(edit.ways)
    mask[edges] = ~export.initially_active[edges] if edit.weapon == "flip" else False
    return mask


def restored_mask(export: Export, mask: np.ndarray, ways: Sequence[int]) -> np.ndarray:
    """Return the given ways to their initial state (a restored Flip deactivates its twins)."""
    restored = mask.copy()
    edges = export.way_edges(ways)
    restored[edges] = export.initially_active[edges]
    return restored


# --- Routing ---------------------------------------------------------------------------------


def _csr(export: Export, mask: np.ndarray) -> BaselineCsr:
    return baseline_csr(
        export.vertices, export.edge_source, export.edge_target, export.edge_ms, mask
    )


def _origin_chunks(origins: np.ndarray) -> Iterator[tuple[np.ndarray, np.ndarray]]:
    """(distinct origins of one chunk, positions of the trips starting there)."""
    unique = np.unique(origins)
    position = np.searchsorted(unique, origins)
    for first in range(0, len(unique), CHUNK):
        selected = np.flatnonzero((position >= first) & (position < first + CHUNK))
        yield unique[first : first + CHUNK], selected


def route(export: Export, mask: np.ndarray, trips: Sequence[int]) -> np.ndarray:
    """Integer-ms distance per trip on the masked graph (inf = broken), fixed endpoints."""
    trips = np.asarray(trips, np.int64)
    out = np.full(len(trips), np.inf)
    if not len(trips):
        return out
    matrix = _csr(export, mask).matrix
    origins, destinations = export.trip_origin[trips], export.trip_destination[trips]
    for chunk, selected in _origin_chunks(origins):
        distances = np.atleast_2d(dijkstra(matrix, indices=chunk))
        row = np.searchsorted(chunk, origins[selected])
        out[selected] = distances[row, destinations[selected]]
    return out


def route_paths(export: Export, mask: np.ndarray, trips: Sequence[int]) -> list[list[int]]:
    """After-edit edge path per reachable trip ([] if broken), minimum (ms, id) parallel edge."""
    csr = _csr(export, mask)
    paths: list[list[int]] = []
    for trip in trips:
        origin, target = int(export.trip_origin[trip]), int(export.trip_destination[trip])
        _, pred = dijkstra(csr.matrix, indices=origin, return_predecessors=True)
        path: list[int] = []
        while target != origin and pred[target] >= 0:
            parent = int(pred[target])
            path.append(csr.winner(parent, target))
            target = parent
        paths.append(path[::-1] if target == origin else [])
    return paths


# --- What mattered ---------------------------------------------------------------------------


@dataclass(slots=True)
class Row:
    trip: int
    distance: float
    candidates: list[int]  # dense ways, ascending OSM id
    runs: list[tuple[int, ...]]  # distinct run way-sets with ≥ 2 ways
    confirmed_singles: set[int]
    confirmed_runs: set[tuple[int, ...]]
    tested_runs: int = 0

    @property
    def broken(self) -> bool:
        return not math.isfinite(self.distance)


def path_runs(export: Export, trip: int, changed: np.ndarray) -> list[tuple[int, ...]]:
    """Distinct way-sets of maximal stretches of changed edges on the baseline path (≥ 2 ways)."""
    runs: set[tuple[int, ...]] = set()
    stretch: set[int] = set()
    for edge in [*export.path(trip).tolist(), -1]:
        if edge >= 0 and changed[edge]:
            stretch.add(int(export.edge_way[edge]))
            continue
        if len(stretch) >= 2:
            runs.add(tuple(sorted(stretch, key=lambda w: export.way_osm_id[w])))
        stretch = set()
    return sorted(runs, key=lambda run: [int(export.way_osm_id[w]) for w in run])


def _recovers(export: Export, row: Row, distance: float) -> bool:
    """Pipeline meaning: broken → reachable; slowed → delay below slow_seconds."""
    if not math.isfinite(distance):
        return False
    return row.broken or distance - export.trip_ms[row.trip] < export.slow_ms


def _test_restorations(
    export: Export,
    mask: np.ndarray,
    groups: Mapping[tuple[int, ...], list[Row]],
) -> Iterator[tuple[tuple[int, ...], Row]]:
    """Restore each way-set, reroute only the trips sharing it; yield (set, recovered row)."""
    for ways in sorted(groups, key=lambda s: [int(export.way_osm_id[w]) for w in s]):
        rows = groups[ways]
        distances = route(export, restored_mask(export, mask, ways), [r.trip for r in rows])
        for row, distance in zip(rows, distances, strict=True):
            if _recovers(export, row, float(distance)):
                yield ways, row


def attribute(export: Export, mask: np.ndarray, rows: list[Row]) -> None:
    """Uncapped §5.8: test every candidate way alone, then runs for trips with no single."""
    singles: dict[tuple[int, ...], list[Row]] = defaultdict(list)
    for row in rows:
        for way in row.candidates:
            singles[(way,)].append(row)
    for (way,), row in _test_restorations(export, mask, singles):
        row.confirmed_singles.add(way)
    runs: dict[tuple[int, ...], list[Row]] = defaultdict(list)
    for row in rows:
        if not row.confirmed_singles:
            row.tested_runs = len(row.runs)
            for run in row.runs:
                runs[run].append(row)
    for run, row in _test_restorations(export, mask, runs):
        row.confirmed_runs.add(run)


# --- Evaluation and canonical output ---------------------------------------------------------


@dataclass(slots=True)
class Evaluation:
    edit: Edit
    mask: np.ndarray
    distances: np.ndarray  # full recompute, every trip
    candidate: np.ndarray  # bool per trip: baseline path uses a deactivated edge
    rows: list[Row]


def check_incremental(
    edit: Edit, distances: np.ndarray, baseline: np.ndarray, candidate: np.ndarray
) -> None:
    """§5.4 incremental-vs-full check, two-sided where the weapon allows it.

    Only deleting edges can't make a trip faster, and a trip whose baseline path is intact
    keeps exactly its baseline. A Flip also activates twins, so a non-candidate trip may get
    faster (never slower).
    """
    if edit.weapon != "flip":
        faster = distances < baseline
        if np.any(faster):
            raise OracleError(f"Trips got faster after a deletion: {np.flatnonzero(faster)[:10]}")
        changed = (distances != baseline) & ~candidate
    else:
        changed = (distances > baseline) & ~candidate
    if np.any(changed):
        raise OracleError(f"Non-candidate trips changed: {np.flatnonzero(changed)[:10]}")


def evaluate(export: Export, edit: Edit) -> Evaluation:
    """Full recompute on the edited mask, the incremental-vs-full check, then attribution."""
    mask = edited_mask(export, edit)
    changed = export.initially_active & ~mask
    distances = route(export, mask, range(export.trips))
    path_trip = np.repeat(np.arange(export.trips), np.diff(export.path_offsets))
    candidate = np.bincount(path_trip[changed[export.path_edges]], minlength=export.trips) > 0
    check_incremental(edit, distances, export.trip_ms, candidate)
    delay = distances - export.trip_ms
    affected = candidate & (~np.isfinite(distances) | (delay >= export.slow_ms))
    rows = []
    for trip in np.flatnonzero(affected).tolist():
        path = export.path(trip)
        ways = {int(w) for w in export.edge_way[path[changed[path]]]}
        rows.append(
            Row(
                trip=trip,
                distance=float(distances[trip]),
                candidates=sorted(ways, key=lambda w: export.way_osm_id[w]),
                runs=path_runs(export, trip, changed),
                confirmed_singles=set(),
                confirmed_runs=set(),
            )
        )
    if edit.counterfactuals:
        attribute(export, mask, rows)
    return Evaluation(edit, mask, distances, candidate, rows)


def _osm(export: Export, ways: Iterable[int]) -> list[int]:
    return sorted(int(export.way_osm_id[w]) for w in ways)


def canonical_row(export: Export, edit: Edit, row: Row) -> dict:
    if edit.counterfactuals:
        singles = _osm(export, row.confirmed_singles)
        runs = sorted(_osm(export, run) for run in row.confirmed_runs)
        tested, total_runs, tested_runs = _osm(export, row.candidates), 0, row.tested_runs
        if not singles:
            total_runs = len(row.runs)
    else:
        # A single Stomp or Flip: the cause is that road by construction, untested.
        singles = tested = _osm(export, edit.ways)
        runs, total_runs, tested_runs = [], 0, 0
    label = "single" if singles else "run" if runs else "several_together"
    added = None if row.broken else int(row.distance) - int(export.trip_ms[row.trip])
    return {
        "trip": row.trip,
        "status": "broken" if row.broken else "slowed",
        "distance_ms": None if row.broken else int(row.distance),
        "added_ms": added,
        "candidates": _osm(export, row.candidates),
        "confirmed_singles": singles,
        "confirmed_runs": runs,
        "tested_candidates": tested,
        "unchecked_candidates": [],
        "tested_runs": tested_runs,
        "total_runs": total_runs,
        "label": label,
    }


def canonical(export: Export, evaluation: Evaluation) -> dict:
    """The canonical-v1 output (PLAN P1b field table)."""
    rows = [canonical_row(export, evaluation.edit, row) for row in evaluation.rows]
    for row in rows:  # Uncapped (P1): nothing is left unchecked.
        if row["unchecked_candidates"] or row["tested_candidates"] != row["candidates"]:
            raise OracleError(f"Uncapped invariant failed for trip {row['trip']}")
    return {
        "ways_hit": len(evaluation.edit.ways),
        "candidate_trips": int(evaluation.candidate.sum()),
        "affected_trips": len(rows),
        "broken": sum(row["status"] == "broken" for row in rows),
        "slowed": sum(row["status"] == "slowed" for row in rows),
        "added_ms": sum(row["added_ms"] for row in rows if row["status"] == "slowed"),
        "rows": rows,
    }


def run_case(export: Export, case: Mapping[str, Any]) -> dict:
    return canonical(export, evaluate(export, parse_edit(export, case)))


# --- Stress set and presets ------------------------------------------------------------------


@functools.cache
def cached_export(directory: Path) -> Export:
    """One loaded export per process (the stress pool's initializer warms it)."""
    return load_export(directory)


def _stress_job(job: tuple[Path, dict]) -> tuple[str, dict]:
    directory, case = job
    try:
        return case["id"], run_case(cached_export(directory), case)
    except Exception as error:
        raise OracleError(f"Stress case {case['id']!r} failed: {error}") from error


def run_stress(directory: Path, stress: Mapping[str, Any], *, jobs: int) -> dict:
    """Canonical output per stress case; cases run in separate processes (scipy holds the GIL)."""
    ids = [case["id"] for case in stress["cases"]]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        raise ValueError(f"Duplicate stress case ids: {duplicates}")
    work = [(directory, dict(case)) for case in stress["cases"]]
    if jobs <= 1:
        results = [_stress_job(job) for job in work]
    else:
        with ProcessPoolExecutor(
            max_workers=jobs, initializer=cached_export, initargs=(directory,)
        ) as pool:
            results = list(pool.map(_stress_job, work))
    meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
    return {"snapshot": meta["snapshot"], "seed": stress.get("seed"), "outputs": dict(results)}


def preset_case(preset: Mapping[str, Any]) -> dict:
    """A demo_faults.toml way-id preset (as recorded in meta.json) as an oracle case."""
    weapons = {"delete_way": "stomp", "flip_oneway": "flip"}
    if preset["type"] not in weapons or preset["target"] != "way_id":
        raise ValueError(f"Unsupported preset type {preset['type']!r}")
    missing = set(preset.get("missing_way_ids", []))
    return {
        "weapon": weapons[preset["type"]],
        "way_ids": [w for w in preset["ids"] if w not in missing],
    }


def preset_results(export: Export) -> dict:
    """Canonical output per preset, plus after-edit paths of the first 25 rows (not broken)."""
    results = {}
    for name, preset in sorted(export.meta.get("presets", {}).items()):
        evaluation = evaluate(export, parse_edit(export, preset_case(preset)))
        drawn = [row.trip for row in evaluation.rows[:DRAWN_ROWS] if not row.broken]
        paths = route_paths(export, evaluation.mask, drawn)
        results[name] = {
            **canonical(export, evaluation),
            "drawn": [{"trip": t, "edges": p} for t, p in zip(drawn, paths, strict=True)],
        }
    return results


def write_presets(directory: Path) -> dict:
    """Write presets.json.gz into the export and re-finalize meta.json through write_export."""
    export = load_export(directory)
    if export.meta.get("format_version") != 1:
        raise OracleError(
            f"--write-presets needs a format_version 1 export, got {export.meta.get('format_version')}"
        )
    write_export(directory, {}, {"presets": preset_results(export)}, export.meta)
    return json.loads((directory / "meta.json").read_text(encoding="utf-8"))


def default_jobs() -> int:
    return max(1, min(8, os.cpu_count() or 1))
