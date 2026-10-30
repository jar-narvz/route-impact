"""P0-only Bay graph export; run from the checkout, no network access required."""

import argparse
import gzip
import hashlib
import json
import math
import subprocess
import tomllib
from collections import defaultdict
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
from cch_order.order import canonical_input, compute_order
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra

from route_impact.extract import extract
from route_impact.graph import build_graph
from route_impact.impact import Snapper, read_trips


def round_ms(seconds: float) -> int:
    value = math.floor(seconds * 1000 + 0.5)
    if not isinstance(value, int) or not 0 <= value <= 2**32 - 1:
        raise ValueError(f"Invalid edge milliseconds: {value}")
    return value


def finalize_sizes(out: Path, meta: dict) -> None:
    """Include meta itself in the transfer total; stabilize its self-referential size."""
    meta["files"] = [row for row in meta["files"] if row["file"] != "meta.json"]
    entry = {"file": "meta.json", "raw_bytes": 0, "gzip_bytes": 0}
    meta["files"].append(entry)
    for _ in range(10):
        meta["total_shipped_bytes"] = sum(row["gzip_bytes"] for row in meta["files"])
        write_json(out / "meta.json", meta)
        size = (out / "meta.json").stat().st_size
        if entry["raw_bytes"] == size:
            break
        entry.update(raw_bytes=size, gzip_bytes=size)
    for row in meta["files"]:
        print(f"{row['file']}: raw={row['raw_bytes']} gzip={row['gzip_bytes']}")
    print(
        f"TOTAL shipped: {meta['total_shipped_bytes']} B; <= 10,000,000: {meta['total_shipped_bytes'] <= 10_000_000}"
    )


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


def export(root: Path, db: Path, snapshot: str, out: Path) -> None:
    # Preserve the original Float64 baseline paths for the required drift audit.
    # These local backups are never listed in meta.files or fetched by the page.
    old_meta = out / "meta.json"
    if old_meta.exists() and any(
        item["name"] == "edge_seconds" for item in json.loads(old_meta.read_text())["arrays"]
    ):
        for name in ("trip_path_offsets", "trip_path_edges"):
            backup = out / f"float64-{name}.bin.gz"
            if not backup.exists():
                backup.write_bytes((out / f"{name}.bin.gz").read_bytes())
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
        edge_ms = round_ms(e.seconds)
        original = len(records)
        twin = original + 1 if road_info[way][1] else -1
        records.append((ix[e.u], ix[e.v], edge_ms, wix[way], 1, twin, original, e.seconds))
        if twin != -1:
            records.append((ix[e.v], ix[e.u], edge_ms, wix[way], 0, original, twin, e.seconds))
    # Keep P0 edge ids stable across quantization, including parallel equal-ms edges.
    records.sort(key=lambda r: (r[0], r[1], r[7], ways[r[3]], r[6]))
    remap = {r[6]: i for i, r in enumerate(records)}
    arrays: dict[str, tuple[str, Any]] = {}

    def add(name: str, dtype: str, values: Any) -> None:
        arrays[name] = (dtype, values)

    add(
        "csr_offsets",
        "<u4",
        np.r_[0, np.cumsum(np.bincount([r[0] for r in records], minlength=len(vertices)))],
    )
    for name, dtype, column in [
        ("edge_target", "<u4", 1),
        ("edge_ms", "<u4", 2),
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
        origin, _od = snapper.nearest(*raw[:2])
        destination, _dd = snapper.nearest(*raw[2:])
        trips.append(
            {
                "trip_id": trip["trip_id"],
                "kind": trip["kind"],
                "weight": float(trip["weight"]),
                "origin": ix[origin],
                "destination": ix[destination],
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
            if not math.isfinite(trip["seconds"]) or not trip["seconds"].is_integer():
                raise ValueError("Integer baseline must be finite and integral")
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
        ("trip_ms", "<f8", "seconds"),
        ("trip_weight", "<f8", "weight"),
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
        "baseline_tie_rule": "Minimum parallel edge by (integer ms, edge id); scipy CSR Dijkstra strict improvement in sorted vertex order (deterministic for the recorded scipy version).",
        "scipy_version": __import__("scipy").__version__,
        "arrays": [],
        "files": [],
    }
    out.mkdir(parents=True, exist_ok=True)
    order, manifest = compute_order(
        canonical_input(
            np.array([nodes[n][0] for n in vertices]),
            np.array([nodes[n][1] for n in vertices]),
            np.array([r[0] for r in records]),
            np.array([r[1] for r in records]),
        ),
        out,
    )
    write_json(out / "order_manifest.json", manifest)

    def write_gzip(filename: str, raw: bytes) -> None:
        packed = gzip.compress(raw, mtime=0)
        (out / filename).write_bytes(packed)
        meta["files"].append(
            {
                "file": filename,
                "raw_bytes": len(raw),
                "gzip_bytes": len(packed),
                "sha256": hashlib.sha256(packed).hexdigest(),
            }
        )
        print(f"{filename}: raw={len(raw)} gzip={len(packed)}", flush=True)

    write_gzip("cch_order.bin.gz", order.astype("<u4").tobytes())
    write_gzip("order_manifest.json.gz", json.dumps(manifest, separators=(",", ":")).encode())
    write_gzip("excluded_trips.json.gz", json.dumps(excluded, separators=(",", ":")).encode())
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
    # The stress set is frozen in results/ and must never be regenerated here.
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
    source = np.repeat(
        np.arange(meta["counts"]["vertices"]), np.diff(a["csr_offsets"].astype(np.int64))
    )
    target, costs = a["edge_target"], a["edge_ms"]
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
        return "slowed" if seconds - a["trip_ms"][t] >= meta["slow_seconds"] * 1000 else "ok"

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
                "baseline_seconds": float(a["trip_ms"][t]),
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
                rerouted[t][0] - float(a["trip_ms"][t])
                for t, s in affected.items()
                if s == "slowed"
            ),
            "attribution_complete": True,
            "attribution": attribution,
            "trip_statuses": trip_rows,
            "trips": drawn,
        }
    # Common integer schema shared by Python presets and the JS live procedure.
    for output in outputs.values():
        statuses = {row["trip_id"]: row for row in output["trip_statuses"]}
        rows = []
        for attribution in output["attribution"]:
            status = statuses[attribution["trip_id"]]
            distance = status["seconds"]
            rows.append(
                {
                    "trip": status["trip_index"],
                    "status": status["status"],
                    "distance_ms": distance,
                    "added_ms": None if distance is None else distance - status["baseline_seconds"],
                    **{k: v for k, v in attribution.items() if k != "trip_id"},
                }
            )
        drawn = [
            {"trip": row["trip_index"], "edges": row["new_path"]}
            for row in output["trips"]
            if row["new_path"] is not None
        ]
        output.clear()
        output.update(
            ways_hit=len(ways),
            candidate_trips=len(statuses),
            affected_trips=len(rows),
            broken=sum(r["status"] == "broken" for r in rows),
            slowed=sum(r["status"] == "slowed" for r in rows),
            added_ms=sum(r["added_ms"] or 0 for r in rows),
            rows=rows,
            drawn=drawn,
        )
        # Each preset's way count comes from its own configured ids.
    for preset_id, output in outputs.items():
        output["ways_hit"] = len(meta["presets"][preset_id]["ids"])
    write_json(out / "presets.json", outputs)  # Local inspection only; only gzip is shipped.
    raw = json.dumps(outputs, separators=(",", ":"), allow_nan=False).encode()
    packed = gzip.compress(raw, mtime=0)
    (out / "presets.json.gz").write_bytes(packed)
    meta["files"] = [f for f in meta["files"] if f["file"] != "presets.json.gz"]
    meta["files"].append(
        {
            "file": "presets.json.gz",
            "raw_bytes": len(raw),
            "gzip_bytes": len(packed),
            "sha256": hashlib.sha256(packed).hexdigest(),
        }
    )
    write_json(out / "meta.json", meta)
    finalize_sizes(out, meta)


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
