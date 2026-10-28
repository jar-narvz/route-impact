#!/usr/bin/env python3
"""Measure extraction, contraction and batched routing on a supplied PBF.

City places are snapped to the nearest graph vertex on the unit sphere. Local
origins and destinations are sampled reproducibly; no reachability cutoff is used.
"""

import argparse
import resource
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

import duckdb
import numpy as np
from scipy.spatial import cKDTree

from route_impact.extract import extract
from route_impact.graph import build_graph, shortest


def _sphere(coordinates: np.ndarray) -> np.ndarray:
    lat, lon = np.radians(coordinates).T
    return np.column_stack((np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)))


def _city_origins(db: Path, vertices: tuple[int, ...]) -> tuple[int, list[int]]:
    with duckdb.connect(str(db), config={"threads": 2, "memory_limit": "2GB"}) as connection:
        cities = connection.execute(
            "SELECT lat, lon FROM places WHERE population >= 50000 "
            "AND lat BETWEEN 36.2 AND 41.7 AND lon < -120.3 ORDER BY node_id"
        ).fetchall()
        if not cities or not vertices:
            return len(cities), []
        nodes = connection.execute(
            "SELECT node_id, lat, lon FROM road_nodes "
            "WHERE node_id IN (SELECT UNNEST(?)) ORDER BY node_id",
            [list(vertices)],
        ).fetchall()
    tree = cKDTree(_sphere(np.array([(lat, lon) for _, lat, lon in nodes])))
    _, nearest = tree.query(_sphere(np.asarray(cities)))
    return len(cities), [nodes[int(index)][0] for index in nearest]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pbf", type=Path)
    parser.add_argument("--local-origins", type=int, default=2000)
    parser.add_argument("--targets", type=int, default=32)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--seed", type=int, default=2027)
    args = parser.parse_args()
    if args.local_origins < 0 or args.targets <= 0 or args.batch <= 0:
        parser.error("local-origins must be nonnegative; targets and batch must be positive")
    with TemporaryDirectory(prefix="route-impact-feasibility-") as directory:
        started = perf_counter()
        db = extract(args.pbf, Path(directory) / "snapshot.duckdb")
        print(f"extract_seconds={perf_counter() - started:.3f}", flush=True)
        started = perf_counter()
        graph = build_graph(db)
        print(
            f"vertices={len(graph.vertices)} edges={len(graph.edges)} "
            f"reduced_edges={len(graph.winning_edges)} "
            f"fallback_speed_roads={graph.fallback_speed_count} "
            f"graph_seconds={perf_counter() - started:.3f}",
            flush=True,
        )
        started = perf_counter()
        city_count, city_origins = _city_origins(db, graph.vertices)
        rng = np.random.default_rng(args.seed)
        local = rng.choice(
            graph.vertices, size=min(args.local_origins, len(graph.vertices)), replace=False
        ).tolist()
        targets = rng.choice(
            graph.vertices, size=min(args.targets, len(graph.vertices)), replace=False
        ).tolist()
        origins = list(dict.fromkeys(city_origins + local))
        print(
            f"city_places={city_count} city_origins={len(set(city_origins))} "
            f"local_origins={len(local)} targets={len(targets)} seed={args.seed} "
            f"prepare_seconds={perf_counter() - started:.3f}",
            flush=True,
        )
        started = perf_counter()
        routes = unreachable = 0
        for offset in range(0, len(origins), args.batch):
            result = shortest(
                graph, origins[offset : offset + args.batch], targets, batch=args.batch
            )
            routes += len(result)
            unreachable += sum(route.segments is None for route in result.values())
            del result
        print(
            f"routes={routes} unreachable={unreachable} "
            f"routing_seconds={perf_counter() - started:.3f}",
            flush=True,
        )
    # macOS reports bytes; Linux reports KiB. Display decimal GB for the 12 GB budget.
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    rss_bytes = rss if sys.platform == "darwin" else rss * 1024
    print(f"peak_rss_bytes={rss_bytes} peak_rss_gb={rss_bytes / 1e9:.6f}")


if __name__ == "__main__":
    main()
