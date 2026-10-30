"""P0-only Bay graph export; run from the checkout, no network access required."""

import argparse
import gzip
import json
import random
import subprocess
import tomllib
from collections import defaultdict
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra

from route_impact.extract import extract
from route_impact.graph import build_graph
from route_impact.impact import Snapper, read_trips


def inside(lat: float, lon: float) -> bool:
    return 37.2 <= lat <= 38.1 and -122.6 <= lon <= -121.7


def simplify(coords: list[tuple[float, float]], tolerance: float = 5.0) -> list:
    """Iterative Douglas–Peucker in a local metre projection; retain endpoints."""
    if len(coords) < 3:
        return coords
    points = np.asarray(coords) * np.array([111195.0802, 111195.0802 * np.cos(np.radians(37.65))])
    keep = {0, len(coords) - 1}
    stack = [(0, len(coords) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        delta = points[hi] - points[lo]
        norm = float(delta @ delta)
        middle = points[lo + 1 : hi]
        t = np.clip((middle - points[lo]) @ delta / norm, 0, 1) if norm else np.zeros(len(middle))
        distances = np.linalg.norm(middle - (points[lo] + t[:, None] * delta), axis=1)
        index = int(np.argmax(distances))
        if distances[index] > tolerance:
            split = lo + 1 + index
            keep.add(split)
            stack.extend([(lo, split), (split, hi)])
    return [coords[i] for i in sorted(keep)]


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def stress_set(root: Path, presets: dict, path_ways: set[int]) -> None:
    cases = [
        {
            "id": "bay_bridge",
            "weapon": "stomp",
            "way_ids": presets["bay_bridge"]["ids"],
            "purpose": "Compound deletion of both Bay Bridge spans.",
        },
        {
            "id": "university_ramp",
            "weapon": "flip",
            "way_id": 6320410,
            "purpose": "Reverse the University Avenue one-way off-ramp.",
        },
    ]
    pool = sorted(path_ways)
    if len(pool) < 20:
        raise ValueError("Need at least 20 baseline-path ways to freeze the stress set")
    for i, way in enumerate(random.Random(2027).sample(pool, 20), 1):
        cases.append(
            {
                "id": f"stomp_{i:02d}",
                "weapon": "stomp",
                "way_ids": [way],
                "purpose": "Seeded deletion of a way used by a baseline trip.",
            }
        )
    spots = [
        ("sf_financial", 37.7946, -122.3999, "Dense downtown street network"),
        ("sf_union_square", 37.787936, -122.407520, "Isolate a sampled trip endpoint"),
        ("bay_bridge_toll_plaza", 37.8250, -122.3150, "Bridge approach chokepoint"),
        ("outer_sunset", 37.7530, -122.4930, "Quiet residential street network"),
    ]
    for name, lat, lon, purpose in spots:
        for radius in (150, 300, 500):
            cases.append(
                {
                    "id": f"{name}_{radius}",
                    "weapon": "meteor",
                    "lat": lat,
                    "lon": lon,
                    "radius_m": radius,
                    "purpose": f"{purpose}, {radius} m blast.",
                }
            )
    frozen = root / "results/playground/stress_set.json"
    if not frozen.exists():
        write_json(frozen, {"seed": 2027, "cases": cases})


def export(root: Path, db: Path, snapshot: str, out: Path) -> None:
    print("Building pipeline graph", flush=True)
    graph = build_graph(db, threads=2, memory_limit="2GB")
    with duckdb.connect(str(db), config={"threads": 2, "memory_limit": "2GB"}) as conn:
        nodes = {
            n: (lat, lon)
            for n, lat, lon in conn.execute(
                "SELECT node_id, lat, lon FROM road_nodes ORDER BY node_id"
            ).fetchall()
        }
        box_nodes = {n for n in graph.vertices if inside(*nodes[n])}
        box_edges = [e for e in graph.edges if e.u in box_nodes and e.v in box_nodes]
        vertices = sorted({n for e in box_edges for n in (e.u, e.v)})
        ix = {n: i for i, n in enumerate(vertices)}
        matrix = csr_matrix(
            (np.ones(len(box_edges)), ([ix[e.u] for e in box_edges], [ix[e.v] for e in box_edges])),
            shape=(len(vertices), len(vertices)),
        )
        if not vertices:
            raise ValueError("Box graph is empty")
        _, labels = connected_components(matrix, directed=True, connection="strong")
        counts = np.bincount(labels)
        largest = counts.max()
        label = next(v for v in labels if counts[v] == largest)
        vertices = [n for n, group in zip(vertices, labels, strict=True) if group == label]
        ix = {n: i for i, n in enumerate(vertices)}
        kept = [e for e in box_edges if e.u in ix and e.v in ix]
        ways = sorted({e.segments[0].way_id for e in kept})
        wix = {w: i for i, w in enumerate(ways)}
        conn.execute("CREATE TEMP TABLE exported_ways (way_id BIGINT)")
        conn.executemany("INSERT INTO exported_ways VALUES (?)", [(w,) for w in ways])
        roads = conn.execute(
            "SELECT way_id, oneway, highway, COALESCE(name, ref, ''), node_refs "
            "FROM roads JOIN exported_ways USING (way_id) ORDER BY way_id"
        ).fetchall()
    del graph, matrix, box_edges
    road_info = {r[0]: r for r in roads}
    # Original edge identity survives the subsequent CSR sort and twin insertion.
    records = []
    for e in kept:
        way = e.segments[0].way_id
        original = len(records)
        twin = original + 1 if road_info[way][1] else -1
        records.append((ix[e.u], ix[e.v], e.seconds, wix[way], 1, twin, original))
        if twin != -1:
            records.append((ix[e.v], ix[e.u], e.seconds, wix[way], 0, original, twin))
    records.sort(key=lambda r: (r[0], r[1], r[2], ways[r[3]], r[6]))
    remap = {r[6]: i for i, r in enumerate(records)}
    arrays: dict[str, tuple[str, Any]] = {}

    def add(name: str, dtype: str, values: Any) -> None:
        arrays[name] = (dtype, values)

    add("vertex_lat", "<f8", [nodes[n][0] for n in vertices])
    add("vertex_lon", "<f8", [nodes[n][1] for n in vertices])
    add("vertex_osm_id", "<f8", vertices)
    add(
        "csr_offsets",
        "<u4",
        np.r_[0, np.cumsum(np.bincount([r[0] for r in records], minlength=len(vertices)))],
    )
    for name, dtype, column in [
        ("edge_source", "<u4", 0),
        ("edge_target", "<u4", 1),
        ("edge_seconds", "<f8", 2),
        ("edge_way", "<u4", 3),
        ("edge_initially_active", "u1", 4),
    ]:
        add(name, dtype, [r[column] for r in records])
    add("edge_twin", "<i4", [remap[r[5]] if r[5] >= 0 else -1 for r in records])
    add("way_osm_id", "<f8", ways)
    add("way_oneway", "u1", [bool(r[1]) for r in roads])
    classes = sorted({r[2] or "ferry" for r in roads})
    add("way_highway", "u1", [classes.index(r[2] or "ferry") for r in roads])
    geometry, offsets = [], [0]
    for _, _, _, _, refs in roads:
        # Keep full polylines to avoid inventing connecting segments at box crossings.
        coords = simplify([nodes[n] for n in refs])
        geometry.extend(round(c * 1e6) for point in coords for c in point)
        offsets.append(len(geometry) // 2)
    add("geometry_offsets", "<u4", offsets)
    add("geometry_coords", "<i4", geometry)
    snapper = Snapper((n, *nodes[n]) for n in vertices)
    trips, excluded = [], []
    for trip in read_trips(root / "config/trips.csv"):
        raw = [float(trip[k]) for k in ("o_lat", "o_lon", "d_lat", "d_lon")]
        if not inside(*raw[:2]) or not inside(*raw[2:]):
            excluded.append({"trip_id": trip["trip_id"], "reason": "raw_endpoint_outside_box"})
            continue
        origin, od = snapper.nearest(*raw[:2])
        destination, dd = snapper.nearest(*raw[2:])
        trips.append(
            {
                "trip_id": trip["trip_id"],
                "kind": trip["kind"],
                "weight": float(trip["weight"]),
                "origin": ix[origin],
                "destination": ix[destination],
                "origin_snap_m": od,
                "destination_snap_m": dd,
            }
        )
    winners = {}
    for edge_id, r in enumerate(records):
        if r[4]:
            key = r[0], r[1]
            if key not in winners:
                winners[key] = edge_id
    pairs = list(winners)
    matrix = csr_matrix(
        ([records[winners[p]][2] for p in pairs], ([p[0] for p in pairs], [p[1] for p in pairs])),
        shape=(len(vertices), len(vertices)),
    )
    grouped = defaultdict(list)
    for i, trip in enumerate(trips):
        grouped[trip["origin"]].append(i)
    print(f"Routing {len(trips)} trips from {len(grouped)} origins", flush=True)
    for number, (origin, indices) in enumerate(grouped.items(), 1):
        distances, pred = dijkstra(matrix, indices=origin, return_predecessors=True)
        for i in indices:
            trip = trips[i]
            target = trip["destination"]
            trip["seconds"] = float(distances[target])
            path = []
            while target != origin:
                parent = int(pred[target])
                if parent < 0:
                    raise ValueError("LSCC baseline unexpectedly unreachable")
                path.append(winners[parent, target])
                target = parent
            trip["path"] = list(reversed(path))
        if number % 100 == 0:
            print(f"  {number}/{len(grouped)} origins", flush=True)
    for name, dtype, key in [
        ("trip_origin", "<u4", "origin"),
        ("trip_destination", "<u4", "destination"),
        ("trip_seconds", "<f8", "seconds"),
        ("trip_weight", "<f8", "weight"),
        ("trip_origin_snap_m", "<f8", "origin_snap_m"),
        ("trip_destination_snap_m", "<f8", "destination_snap_m"),
    ]:
        add(name, dtype, [t[key] for t in trips])
    add("trip_path_offsets", "<u4", np.r_[0, np.cumsum([len(t["path"]) for t in trips])])
    add("trip_path_edges", "<u4", [e for t in trips for e in t["path"]])
    presets = tomllib.loads((root / "config/demo_faults.toml").read_text())["demos"]
    presets = {
        k: dict(presets[k], missing_way_ids=[w for w in presets[k]["ids"] if w not in wix])
        for k in ("bay_bridge", "university_ramp")
    }
    meta = {
        "format_version": 0,
        "byte_order": "little",
        "snapshot": snapshot,
        "git_commit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, text=True
        ).strip(),
        "box": {"min_lat": 37.2, "max_lat": 38.1, "min_lon": -122.6, "max_lon": -121.7},
        "counts": {
            "vertices": len(vertices),
            "edges": len(records),
            "ways": len(ways),
            "trips": len(trips),
            "initially_active_edges": len(kept),
            "excluded_trips": len(excluded),
        },
        "simplification_tolerance_m": 5,
        "geometry_coordinate_order": "lat,lon",
        "geometry_scale": 1000000,
        "geometry_scope": "full polylines of exported ways",
        "slow_seconds": tomllib.loads((root / "config/thresholds.toml").read_text())[
            "slow_seconds"
        ],
        "presets": presets,
        "highway_classes": classes,
        "excluded_trips": excluded,
        "arrays": [],
        "files": [],
    }
    out.mkdir(parents=True, exist_ok=True)

    def write_gzip(filename: str, raw: bytes) -> None:
        packed = gzip.compress(raw, mtime=0)
        (out / filename).write_bytes(packed)
        meta["files"].append({"file": filename, "raw_bytes": len(raw), "gzip_bytes": len(packed)})
        print(f"{filename}: raw={len(raw)} gzip={len(packed)}", flush=True)

    for name, (dtype, values) in arrays.items():
        array = np.asarray(values, dtype=dtype)
        filename = f"{name}.bin.gz"
        write_gzip(filename, array.tobytes())
        meta["arrays"].append(
            {"name": name, "dtype": dtype, "length": len(array), "file": filename, "byte_offset": 0}
        )
    for filename, value in [
        ("way_names.json.gz", [r[3] for r in roads]),
        ("trip_labels.json.gz", [{"trip_id": t["trip_id"], "kind": t["kind"]} for t in trips]),
    ]:
        write_gzip(filename, json.dumps(value, separators=(",", ":")).encode())
    meta["json_arrays"] = [
        {
            "name": "way_names",
            "dtype": "json",
            "length": len(roads),
            "file": "way_names.json.gz",
            "byte_offset": 0,
        },
        {
            "name": "trip_labels",
            "dtype": "json",
            "length": len(trips),
            "file": "trip_labels.json.gz",
            "byte_offset": 0,
        },
    ]
    write_json(out / "meta.json", meta)
    meta_size = (out / "meta.json").stat().st_size
    print(f"meta.json: raw={meta_size} stored={meta_size}", flush=True)
    stress_set(root, presets, {ways[records[e][3]] for t in trips for e in t["path"]})
    print(json.dumps(meta["counts"]), flush=True)


def precompute_presets(out: Path) -> None:
    """Independent full rerouting oracle on exactly the shipped arrays and endpoints."""
    meta = json.loads((out / "meta.json").read_text())
    arrays = {
        d["name"]: np.frombuffer(gzip.decompress((out / d["file"]).read_bytes()), dtype=d["dtype"])
        for d in meta["arrays"]
    }
    labels = json.loads(gzip.decompress((out / "trip_labels.json.gz").read_bytes()))
    a = arrays
    source, target, costs = (a[k] for k in ("edge_source", "edge_target", "edge_seconds"))
    initial = a["edge_initially_active"].astype(bool)
    way_edges: dict[int, list[int]] = defaultdict(list)
    for e, w in enumerate(a["edge_way"]):
        way_edges[int(w)].append(e)
    way_index = {int(w): i for i, w in enumerate(a["way_osm_id"])}
    paths = [
        a["trip_path_edges"][a["trip_path_offsets"][t] : a["trip_path_offsets"][t + 1]].tolist()
        for t in range(meta["counts"]["trips"])
    ]

    def route(active: np.ndarray, trips: list[int], paths_needed: bool = False) -> dict:
        # Collapse parallel edges by minimum cost, never scipy's default sum.
        winners: dict[tuple[int, int], int] = {}
        for e in np.flatnonzero(active):
            pair = int(source[e]), int(target[e])
            if pair not in winners or costs[e] < costs[winners[pair]]:
                winners[pair] = int(e)
        pairs = list(winners)
        matrix = csr_matrix(
            ([costs[winners[p]] for p in pairs], ([p[0] for p in pairs], [p[1] for p in pairs])),
            shape=(meta["counts"]["vertices"],) * 2,
        )
        groups: dict[int, list[int]] = defaultdict(list)
        for t in trips:
            groups[int(a["trip_origin"][t])].append(t)
        result = {}
        for origin, group in groups.items():
            distances, pred = dijkstra(matrix, indices=origin, return_predecessors=True)
            for t in group:
                v = int(a["trip_destination"][t])
                seconds = float(distances[v])
                edges = None
                if paths_needed and np.isfinite(seconds):
                    edges = []
                    while v != origin:
                        u = int(pred[v])
                        edges.append(winners[u, v])
                        v = u
                    edges.reverse()
                result[t] = (seconds, edges)
        return result

    def classify(t: int, seconds: float) -> str:
        if not np.isfinite(seconds):
            return "broken"
        return "slowed" if seconds - a["trip_seconds"][t] >= meta["slow_seconds"] else "ok"

    outputs = {}
    for preset_id, preset in meta["presets"].items():
        print(f"Precomputing {preset_id}", flush=True)
        ways = [way_index[w] for w in preset["ids"]]
        active = initial.copy()
        for w in ways:
            active[way_edges[w]] = False
        flip = preset_id == "university_ramp"
        if flip:
            for w in ways:
                for e in way_edges[w]:
                    if initial[e]:
                        active[int(a["edge_twin"][e])] = True
        candidates = [t for t, path in enumerate(paths) if any(not active[e] for e in path)]
        rerouted = route(active, candidates, True)
        affected = {
            t: classify(t, rerouted[t][0])
            for t in candidates
            if classify(t, rerouted[t][0]) != "ok"
        }
        rows = {}
        jobs: dict[int, list[int]] = defaultdict(list)
        for t in affected:
            candidate_ways = list(
                dict.fromkeys(
                    int(a["edge_way"][e]) for e in paths[t] if int(a["edge_way"][e]) in ways
                )
            )
            rows[t] = {
                "trip_id": labels[t]["trip_id"],
                "candidates": candidate_ways,
                "confirmed_singles": [],
                "confirmed_runs": [],
                "runs": [],
            }
            for w in candidate_ways:
                jobs[w].append(t)

        def recover(
            restored: list[int],
            trips: list[int],
            active: np.ndarray = active,
            affected: dict[int, str] = affected,
        ) -> list[int]:
            counterfactual = active.copy()
            for w in restored:
                counterfactual[way_edges[w]] = initial[way_edges[w]]
            result = route(counterfactual, trips)
            return [
                t
                for t in trips
                if np.isfinite(result[t][0])
                and (affected[t] == "broken" or classify(t, result[t][0]) == "ok")
            ]

        if not flip:
            for w, trips in sorted(jobs.items(), key=lambda job: (-len(job[1]), job[0])):
                for t in recover([w], trips):
                    rows[t]["confirmed_singles"].append(w)
            run_jobs: dict[tuple[int, ...], list[int]] = defaultdict(list)
            for t, row in rows.items():
                if row["confirmed_singles"]:
                    continue
                run: set[int] = set()
                for e in [*paths[t], -1]:
                    if e >= 0 and not active[e]:
                        run.add(int(a["edge_way"][e]))
                    else:
                        key = tuple(sorted(run))
                        if len(key) >= 2 and key not in row["runs"]:
                            row["runs"].append(key)
                            run_jobs[key].append(t)
                        run = set()
            for run, trips in sorted(run_jobs.items(), key=lambda job: -len(job[1])):
                for t in recover(list(run), trips):
                    rows[t]["confirmed_runs"].append(list(run))
        attribution = []

        def osm(w: int) -> int:
            return int(a["way_osm_id"][w])

        for t, row in rows.items():
            singles = ways if flip else row["confirmed_singles"]
            attribution.append(
                {
                    "trip_id": row["trip_id"],
                    "candidates": list(map(osm, row["candidates"])),
                    "confirmed_singles": list(map(osm, singles)),
                    "confirmed_runs": [list(map(osm, run)) for run in row["confirmed_runs"]],
                    "tested_candidates": list(map(osm, row["candidates"])),
                    "unchecked_candidates": [],
                    "tested_runs": len(row["runs"]),
                    "total_runs": len(row["runs"]),
                    "label": "single"
                    if singles
                    else "run"
                    if row["confirmed_runs"]
                    else "several_together",
                }
            )
        trip_rows = [
            {
                "trip_index": t,
                "trip_id": labels[t]["trip_id"],
                "status": classify(t, rerouted[t][0]),
                "seconds": rerouted[t][0] if np.isfinite(rerouted[t][0]) else None,
                "baseline_seconds": float(a["trip_seconds"][t]),
            }
            for t in candidates
        ]
        drawn = [
            {**row, "new_path": rerouted[row["trip_index"]][1]}
            for row in trip_rows
            if row["status"] != "ok"
        ][:25]
        outputs[preset_id] = {
            "type": "edited",
            "weapon": "flip" if flip else "stomp",
            "way_ids": preset["ids"],
            "ways_hit": len(ways),
            "candidate_trips": len(candidates),
            "affected_trips": len(affected),
            "affected_origins": len({int(a["trip_origin"][t]) for t in affected}),
            "rerouted_origins": 0,
            "broken": sum(s == "broken" for s in affected.values()),
            "slowed": sum(s == "slowed" for s in affected.values()),
            "added_seconds": sum(
                rerouted[t][0] - float(a["trip_seconds"][t])
                for t, s in affected.items()
                if s == "slowed"
            ),
            "attribution_complete": True,
            "attribution": attribution,
            "trip_statuses": trip_rows,
            "trips": drawn,
        }
    write_json(out / "presets.json", outputs)
    raw = json.dumps(outputs, separators=(",", ":"), allow_nan=False).encode()
    packed = gzip.compress(raw, mtime=0)
    (out / "presets.json.gz").write_bytes(packed)
    meta["files"] = [f for f in meta["files"] if f["file"] != "presets.json.gz"]
    meta["files"].append(
        {"file": "presets.json.gz", "raw_bytes": len(raw), "gzip_bytes": len(packed)}
    )
    write_json(out / "meta.json", meta)
    print(f"presets.json.gz: raw={len(raw)} gzip={len(packed)}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--db", type=Path)
    parser.add_argument(
        "--presets-only", action="store_true", help="Reuse the existing exported graph"
    )
    args = parser.parse_args()
    if len(args.snapshot) != 6 or not args.snapshot.isdigit():
        parser.error("snapshot must be YYMMDD")
    root = Path(__file__).resolve().parents[1]
    out = root / "data/playground-spike"
    if args.presets_only:
        precompute_presets(out)
        return
    db = args.db or out / f"{args.snapshot}.duckdb"
    if args.db is None and not db.exists():
        pbf = root / f"data/norcal-{args.snapshot}.osm.pbf"
        if not pbf.exists():
            parser.error(f"Missing snapshot: {pbf}; no download attempted")
        print(f"Extracting {pbf} into {db}", flush=True)
        extract(pbf, db, threads=2, memory_limit="2GB")
    export(root, db, args.snapshot, out)
    precompute_presets(out)


if __name__ == "__main__":
    main()
