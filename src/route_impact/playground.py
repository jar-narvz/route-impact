"""Export the pipeline graph for the browser fault playground (format v1, PLAYGROUND §5.1–5.4).

Ported from the browser-verified spike (`scripts/playground_spike.py`, b8bf17e); the real
snapshot export reproduces the spike's array, order, name, label and exclusion bytes.
"""

import hashlib
import importlib.util
import json
import math
import os
import shutil
import struct
import subprocess
import tomllib
import zlib
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType
from typing import Any, Literal

import duckdb
import numpy as np
import scipy
from numpy.typing import ArrayLike
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra

from route_impact.graph import Edge, build_graph
from route_impact.impact import Snapper, read_trips

FORMAT_VERSION = 1
ROOT = Path(__file__).resolve().parents[2]
ORDER_TOOL = ROOT / "scripts/cch_order/order.py"
ARRAY_DTYPES = ("<u4", "<i4", "<f8", "u1")
PRESET_DEMOS = ("bay_bridge", "university_ramp")
TIE_RULE = (
    "Minimum parallel edge by (integer ms, edge id); scipy CSR Dijkstra strict improvement "
    "in sorted vertex order (deterministic for the recorded scipy version)."
)
OrderMethod = Literal["routingkit", "identity"]


@dataclass(frozen=True, slots=True)
class Box:
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float

    def contains(self, lat: float, lon: float) -> bool:
        return self.min_lat <= lat <= self.max_lat and self.min_lon <= lon <= self.max_lon


@dataclass(frozen=True, slots=True)
class PlaygroundConfig:
    box: Box
    projection_lat: float
    metres_per_degree: float
    earth_radius_m: float
    simplification_tolerance_m: float
    geometry_scale: int


def load_config(path: Path) -> PlaygroundConfig:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    return PlaygroundConfig(Box(**data["box"]), **data["geometry"])


def round_ms(seconds: float) -> int:
    """Round once to whole milliseconds, half up: floor(seconds × 1000 + 0.5) (§5.10)."""
    if not math.isfinite(seconds):
        raise ValueError(f"Invalid edge seconds: {seconds}")
    value = math.floor(seconds * 1000 + 0.5)
    if not 0 <= value <= 2**32 - 1:
        raise ValueError(f"Invalid edge milliseconds: {value}")
    return value


def simplify(
    coords: list[tuple[float, float]], config: PlaygroundConfig
) -> list[tuple[float, float]]:
    """Iterative Douglas–Peucker in a local metre projection; keeps both endpoints."""
    if len(coords) < 3:
        return coords
    mpd = config.metres_per_degree
    points = np.asarray(coords) * np.array([mpd, mpd * np.cos(np.radians(config.projection_lat))])
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
        if distances[index] > config.simplification_tolerance_m:
            split = lo + 1 + index
            keep.add(split)
            stack.extend([(lo, split), (split, hi)])
    return [coords[i] for i in sorted(keep)]


# --- Shared format-v1 writer -------------------------------------------------------------


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def compact_json(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), allow_nan=False).encode()


def gzip_bytes(raw: bytes) -> bytes:
    """Gzip with a fixed header (mtime 0, OS 255) so macOS and Linux write identical bytes.

    `gzip.compress` takes the header's OS byte from zlib (0x13 on macOS, 0x03 on Linux).
    """
    deflate = zlib.compressobj(9, zlib.DEFLATED, -zlib.MAX_WBITS)
    body = deflate.compress(raw) + deflate.flush()
    header = b"\x1f\x8b\x08\x00" + struct.pack("<I", 0) + b"\x02\xff"
    return header + body + struct.pack("<II", zlib.crc32(raw), len(raw) & 0xFFFFFFFF)


def _write_gzip(out: Path, filename: str, raw: bytes, meta: dict) -> None:
    packed = gzip_bytes(raw)
    (out / filename).write_bytes(packed)
    meta["files"] = [row for row in meta["files"] if row["file"] != filename]
    meta["files"].append(
        {
            "file": filename,
            "raw_bytes": len(raw),
            "gzip_bytes": len(packed),
            "sha256": hashlib.sha256(packed).hexdigest(),
        }
    )


def _replace_entry(entries: list[dict], entry: dict) -> None:
    entries[:] = [row for row in entries if row["name"] != entry["name"]]
    entries.append(entry)


def finalize_meta(out: Path, meta: dict) -> None:
    """Write meta.json, listing itself in `files`; iterate until its own size is stable."""
    meta["files"] = [row for row in meta["files"] if row["file"] != "meta.json"]
    entry = {"file": "meta.json", "raw_bytes": 0, "gzip_bytes": 0}
    meta["files"].append(entry)
    for _ in range(10):
        meta["total_shipped_bytes"] = sum(row["gzip_bytes"] for row in meta["files"])
        write_json(out / "meta.json", meta)
        size = (out / "meta.json").stat().st_size
        if entry["raw_bytes"] == size:
            return
        entry.update(raw_bytes=size, gzip_bytes=size)
    raise RuntimeError("meta.json size did not stabilise")


def write_export(
    out: Path,
    arrays: Mapping[str, tuple[str, ArrayLike]],
    json_files: Mapping[str, Any],
    meta: Mapping[str, Any],
    *,
    blobs: Mapping[str, bytes] | None = None,
    json_arrays: Sequence[str] = (),
) -> dict:
    """Write format-v1 files into `out` and finalize `meta.json`; return the written meta.

    - `arrays`: name → (dtype, values), stored raw little-endian as `<name>.bin.gz` and listed
      in `meta["arrays"]`. dtype is one of `ARRAY_DTYPES`.
    - `json_files`: name → value, stored as compact JSON in `<name>.json.gz`; the names in
      `json_arrays` are also listed in `meta["json_arrays"]` with their length.
    - `blobs`: filename → raw bytes, gzipped as is (e.g. `cch_order.bin.gz`).
    Existing entries with the same file or name are replaced, so a caller can add a file to a
    finished export (P1b's presets) by passing its meta back in. Every gzip has mtime 0.
    """
    out.mkdir(parents=True, exist_ok=True)
    meta = json.loads(json.dumps(dict(meta)))
    meta.setdefault("files", [])
    meta.setdefault("arrays", [])
    for filename, raw in (blobs or {}).items():
        _write_gzip(out, filename, raw, meta)
    for name, (dtype, values) in arrays.items():
        if dtype not in ARRAY_DTYPES:
            raise ValueError(f"Unsupported dtype for {name}: {dtype}")
        array = np.asarray(values, dtype=dtype)
        if array.ndim != 1:
            raise ValueError(f"Array {name} must be one-dimensional")
        filename = f"{name}.bin.gz"
        _write_gzip(out, filename, array.tobytes(), meta)
        entry = {"name": name, "dtype": dtype, "length": len(array), "file": filename}
        _replace_entry(meta["arrays"], {**entry, "byte_offset": 0})
    for name, value in json_files.items():
        filename = f"{name}.json.gz"
        _write_gzip(out, filename, compact_json(value), meta)
        if name in json_arrays:
            meta.setdefault("json_arrays", [])
            entry = {"name": name, "dtype": "json", "length": len(value), "file": filename}
            _replace_entry(meta["json_arrays"], {**entry, "byte_offset": 0})
    finalize_meta(out, meta)
    return meta


# --- Graph cut, edge rows and baselines ----------------------------------------------------


@dataclass(slots=True)
class BoxGraph:
    """The LSCC of the box-cut pipeline graph, with OSM-id vertex order."""

    vertices: list[int]
    edges: list[Edge]
    coords: dict[int, tuple[float, float]]
    roads: list[tuple]
    index: dict[int, int] = field(init=False)

    def __post_init__(self) -> None:
        self.index = {n: i for i, n in enumerate(self.vertices)}


def largest_strong_component(vertices: list[int], edges: list[Edge]) -> list[int]:
    """Vertices of the largest strong component; size ties go to the earliest vertex."""
    if not vertices:
        raise ValueError("Box graph is empty")
    ix = {n: i for i, n in enumerate(vertices)}
    pairs = np.unique(np.array([(ix[e.u], ix[e.v]) for e in edges], dtype=np.int64), axis=0)
    matrix = csr_matrix(
        (np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(len(vertices),) * 2
    )
    _, labels = connected_components(matrix, directed=True, connection="strong")
    counts = np.bincount(labels)
    label = next(v for v in labels if counts[v] == counts.max())
    return [n for n, group in zip(vertices, labels, strict=True) if group == label]


def cut_graph(db: Path, box: Box, *, threads: int, memory_limit: str) -> BoxGraph:
    """Build the pipeline graph, keep edges with both ends in the box, then its LSCC (§5.1)."""
    graph = build_graph(db, threads=threads, memory_limit=memory_limit)
    with duckdb.connect(
        str(db), read_only=True, config={"threads": threads, "memory_limit": memory_limit}
    ) as conn:
        coords = {
            n: (lat, lon)
            for n, lat, lon in conn.execute(
                "SELECT node_id, lat, lon FROM road_nodes ORDER BY node_id"
            ).fetchall()
        }
        box_nodes = {n for n in graph.vertices if box.contains(*coords[n])}
        box_edges = [e for e in graph.edges if e.u in box_nodes and e.v in box_nodes]
        vertices = largest_strong_component(
            sorted({n for e in box_edges for n in (e.u, e.v)}), box_edges
        )
        members = set(vertices)
        kept = [e for e in box_edges if e.u in members and e.v in members]
        ways = sorted({e.segments[0].way_id for e in kept})
        conn.execute("CREATE TEMP TABLE exported_ways (way_id BIGINT)")
        conn.executemany("INSERT INTO exported_ways VALUES (?)", [(w,) for w in ways])
        roads = conn.execute(
            "SELECT way_id, oneway, highway, COALESCE(name, ref, ''), node_refs "
            "FROM roads JOIN exported_ways USING (way_id) ORDER BY way_id"
        ).fetchall()
    if [r[0] for r in roads] != ways:
        raise ValueError("Every exported way must have exactly one roads row")
    return BoxGraph(vertices, kept, coords, roads)


@dataclass(frozen=True, slots=True)
class EdgeRow:
    source: int
    target: int
    ms: int
    way: int
    active: int
    twin: int  # pre-sort id of the twin row, or -1
    original: int  # pre-sort id, stable across the sort
    seconds: float


def edge_rows(box_graph: BoxGraph) -> list[EdgeRow]:
    """One active row per pipeline Edge plus an inactive reverse twin for one-way ways (§5.2).

    Sorted by (source, target, Float64 seconds, way OSM id, pre-sort id), the spike's key, so
    equal-ms parallel edges keep the order their exact seconds give them.
    """
    ix = box_graph.index
    way_index = {r[0]: i for i, r in enumerate(box_graph.roads)}
    oneway = {r[0]: bool(r[1]) for r in box_graph.roads}
    rows: list[EdgeRow] = []
    for e in box_graph.edges:
        way = e.segments[0].way_id
        ms = round_ms(e.seconds)
        original = len(rows)
        twin = original + 1 if oneway[way] else -1
        rows.append(EdgeRow(ix[e.u], ix[e.v], ms, way_index[way], 1, twin, original, e.seconds))
        if twin != -1:
            rows.append(EdgeRow(ix[e.v], ix[e.u], ms, way_index[way], 0, original, twin, e.seconds))
    ways = [r[0] for r in box_graph.roads]
    rows.sort(key=lambda r: (r.source, r.target, r.seconds, ways[r.way], r.original))
    return rows


@dataclass(frozen=True, slots=True)
class BaselineCsr:
    """CSR of active edges collapsed to the minimum (ms, edge id) per (u, v)."""

    matrix: csr_matrix
    winners: np.ndarray  # edge id per stored matrix entry

    def winner(self, u: int, v: int) -> int:
        lo, hi = self.matrix.indptr[u], self.matrix.indptr[u + 1]
        slot = lo + int(np.searchsorted(self.matrix.indices[lo:hi], v))
        if slot >= hi or self.matrix.indices[slot] != v:
            raise KeyError((u, v))
        return int(self.winners[slot])


def baseline_csr(
    vertices: int, source: ArrayLike, target: ArrayLike, ms: ArrayLike, active: ArrayLike
) -> BaselineCsr:
    """Build the CSR with numpy (lexsort, first per (u, v)); never coo→csr duplicate sums."""
    source, target = np.asarray(source, np.int64), np.asarray(target, np.int64)
    ms = np.asarray(ms, np.int64)
    ids = np.flatnonzero(np.asarray(active, bool))
    order = ids[np.lexsort((ids, ms[ids], target[ids], source[ids]))]
    first = np.ones(len(order), bool)
    first[1:] = (source[order][1:] != source[order][:-1]) | (
        target[order][1:] != target[order][:-1]
    )
    winners = order[first]
    indptr = np.r_[0, np.cumsum(np.bincount(source[winners], minlength=vertices))]
    matrix = csr_matrix(
        (ms[winners].astype(np.float64), target[winners].astype(np.int32), indptr),
        shape=(vertices, vertices),
    )
    return BaselineCsr(matrix, winners)


def route_baselines(
    csr: BaselineCsr, origins: Sequence[int], destinations: Sequence[int]
) -> tuple[list[float], list[list[int]]]:
    """Integer-ms baseline and edge path per trip; one scipy Dijkstra per distinct origin."""
    grouped: dict[int, list[int]] = defaultdict(list)
    for i, origin in enumerate(origins):
        grouped[origin].append(i)
    distances_ms: list[float] = [math.nan] * len(origins)
    paths: list[list[int]] = [[] for _ in origins]
    for origin, indices in grouped.items():
        distances, pred = dijkstra(csr.matrix, indices=origin, return_predecessors=True)
        for i in indices:
            target = destinations[i]
            value = float(distances[target])
            if not math.isfinite(value) or not value.is_integer():
                raise ValueError("Integer baseline must be finite and integral")
            path = []
            while target != origin:
                parent = int(pred[target])
                if parent < 0:
                    raise ValueError("LSCC baseline unexpectedly unreachable")
                path.append(csr.winner(parent, target))
                target = parent
            distances_ms[i], paths[i] = value, path[::-1]
    return distances_ms, paths


# --- Trips, geometry, order and presets -------------------------------------------------------


def snap_trips(
    rows: Iterable[Mapping[str, Any]], box_graph: BoxGraph, box: Box
) -> tuple[list[dict], list[dict]]:
    """Keep trips with both raw endpoints in the box, snapped into the LSCC; record exclusions."""
    snapper = Snapper((n, *box_graph.coords[n]) for n in box_graph.vertices)
    trips, excluded = [], []
    for trip in rows:
        raw = [float(trip[k]) for k in ("o_lat", "o_lon", "d_lat", "d_lon")]
        if not box.contains(*raw[:2]) or not box.contains(*raw[2:]):
            excluded.append({"trip_id": trip["trip_id"], "reason": "raw_endpoint_outside_box"})
            continue
        origin, _ = snapper.nearest(*raw[:2])
        destination, _ = snapper.nearest(*raw[2:])
        trips.append(
            {
                "trip_id": trip["trip_id"],
                "kind": trip["kind"],
                "weight": float(trip["weight"]),
                "origin": box_graph.index[origin],
                "destination": box_graph.index[destination],
            }
        )
    return trips, excluded


def geometry_arrays(box_graph: BoxGraph, config: PlaygroundConfig) -> tuple[list[int], list[int]]:
    """Full simplified polylines per way (lat, lon pairs), quantized to Int32."""
    coords, offsets = [], [0]
    for *_, refs in box_graph.roads:
        # Full polylines, so no connecting segment is invented where a way crosses the box.
        points = simplify([box_graph.coords[n] for n in refs], config)
        coords.extend(round(c * config.geometry_scale) for point in points for c in point)
        offsets.append(len(coords) // 2)
    return offsets, coords


def load_order_tool() -> ModuleType:
    """Import scripts/cch_order/order.py by path: it is a script, not part of the package."""
    spec = importlib.util.spec_from_file_location("route_impact_cch_order", ORDER_TOOL)
    if spec is None or spec.loader is None:
        raise FileNotFoundError(ORDER_TOOL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cch_order(
    order_input: bytes, method: OrderMethod, out: Path, tool: ModuleType
) -> tuple[np.ndarray, dict, list[str]]:
    """Return (order[rank] = vertex, manifest, local files left in `out`)."""
    if method == "routingkit":
        order, manifest = tool.compute_order(order_input, out)
        return order, manifest, ["cch_order_input.bin", "cch_order_output.bin"]
    if method != "identity":
        raise ValueError(f"Unknown order method: {method}")
    (out / "cch_order_input.bin").write_bytes(order_input)
    nodes, pairs = np.frombuffer(order_input[8:16], dtype="<u4").tolist()
    order = np.arange(nodes, dtype="<u4")
    manifest = {
        "method": "identity",
        "orientation": "order[rank] = vertex; rank = inverse permutation",
        "nodes": nodes,
        "undirected_edges": pairs,
        "input_sha256": hashlib.sha256(order_input).hexdigest(),
        "output_sha256": hashlib.sha256(order.tobytes()).hexdigest(),
    }
    return order, manifest, ["cch_order_input.bin"]


def preset_definitions(demo_faults: Path, way_osm_ids: Sequence[int]) -> dict:
    """The way-id presets from demo_faults.toml, each with the ids missing from the export."""
    demos = tomllib.loads(demo_faults.read_text(encoding="utf-8"))["demos"]
    exported = set(way_osm_ids)
    return {
        k: dict(demos[k], missing_way_ids=[w for w in demos[k]["ids"] if w not in exported])
        for k in PRESET_DEMOS
    }


def git_state() -> tuple[str, bool]:
    """HEAD commit and whether the checkout has uncommitted or untracked changes."""

    def git(*args: str) -> str:
        return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()

    return git("rev-parse", "HEAD"), bool(git("status", "--porcelain"))


def preflight(order: OrderMethod) -> tuple[ModuleType, str, bool]:
    """Fail before the slow graph build: order method, RoutingKit binary, git state."""
    if order not in ("routingkit", "identity"):
        raise ValueError(f"Unknown order method: {order}")
    tool = load_order_tool()
    if order == "routingkit" and not tool.BIN.exists():
        # order.py would raise SystemExit later, after the graph build.
        raise FileNotFoundError(f"Missing {tool.BIN}; run `make -C scripts/cch_order` first")
    commit, dirty = git_state()
    return tool, commit, dirty


def check_replaceable(out: Path) -> None:
    """Only an earlier export (it has meta.json) or an empty directory may be replaced."""
    if not out.exists():
        return
    if not out.is_dir():
        raise FileExistsError(f"Output exists and is not a directory: {out}")
    if any(out.iterdir()) and not (out / "meta.json").is_file():
        raise FileExistsError(f"Refusing to replace non-empty {out}: it has no meta.json")


def local_files(out: Path, names: Iterable[str]) -> list[dict]:
    return [
        {
            "file": name,
            "bytes": (out / name).stat().st_size,
            "sha256": hashlib.sha256((out / name).read_bytes()).hexdigest(),
            "shipped": False,
        }
        for name in names
    ]


# --- Export -------------------------------------------------------------------------------


def export_playground(
    db: Path,
    snapshot: str,
    out: Path,
    *,
    trips_path: Path,
    config: PlaygroundConfig,
    thresholds_path: Path,
    demo_faults_path: Path,
    order: OrderMethod = "routingkit",
    threads: int = 2,
    memory_limit: str = "2GB",
) -> dict:
    """Export one snapshot to `out` in format v1 and return the finalized meta.

    The export is written to a fresh sibling temp directory and replaces `out` only on
    success, so a failed run leaves the previous export untouched.
    """
    tool, commit, dirty = preflight(order)
    check_replaceable(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    temp = out.parent / f".{out.resolve().name}.tmp-{os.getpid()}"
    shutil.rmtree(temp, ignore_errors=True)
    try:
        meta = _export_into(
            temp,
            db,
            snapshot,
            trips_path=trips_path,
            config=config,
            thresholds_path=thresholds_path,
            demo_faults_path=demo_faults_path,
            order=order,
            tool=tool,
            git=(commit, dirty),
            threads=threads,
            memory_limit=memory_limit,
        )
    except BaseException:
        shutil.rmtree(temp, ignore_errors=True)
        raise
    if out.exists():
        shutil.rmtree(out)
    temp.rename(out)
    return meta


def _export_into(
    out: Path,
    db: Path,
    snapshot: str,
    *,
    trips_path: Path,
    config: PlaygroundConfig,
    thresholds_path: Path,
    demo_faults_path: Path,
    order: OrderMethod,
    tool: ModuleType,
    git: tuple[str, bool],
    threads: int,
    memory_limit: str,
) -> dict:
    box_graph = cut_graph(db, config.box, threads=threads, memory_limit=memory_limit)
    rows = edge_rows(box_graph)
    remap = {r.original: i for i, r in enumerate(rows)}
    vertices = len(box_graph.vertices)
    way_ids = [r[0] for r in box_graph.roads]
    classes = sorted({r[2] or "ferry" for r in box_graph.roads})
    trips, excluded = snap_trips(read_trips(trips_path), box_graph, config.box)
    csr = baseline_csr(
        vertices,
        [r.source for r in rows],
        [r.target for r in rows],
        [r.ms for r in rows],
        [r.active for r in rows],
    )
    trip_ms, paths = route_baselines(
        csr, [t["origin"] for t in trips], [t["destination"] for t in trips]
    )
    geometry_offsets, geometry_coords = geometry_arrays(box_graph, config)
    arrays: dict[str, tuple[str, ArrayLike]] = {
        "csr_offsets": (
            "<u4",
            np.r_[0, np.cumsum(np.bincount([r.source for r in rows], minlength=vertices))],
        ),
        "edge_target": ("<u4", [r.target for r in rows]),
        "edge_ms": ("<u4", [r.ms for r in rows]),
        "edge_way": ("<u4", [r.way for r in rows]),
        "edge_initially_active": ("u1", [r.active for r in rows]),
        "edge_twin": ("<i4", [remap[r.twin] if r.twin >= 0 else -1 for r in rows]),
        "way_osm_id": ("<f8", way_ids),
        "way_oneway": ("u1", [bool(r[1]) for r in box_graph.roads]),
        "way_highway": ("u1", [classes.index(r[2] or "ferry") for r in box_graph.roads]),
        "geometry_offsets": ("<u4", geometry_offsets),
        "geometry_coords": ("<i4", geometry_coords),
        "trip_origin": ("<u4", [t["origin"] for t in trips]),
        "trip_destination": ("<u4", [t["destination"] for t in trips]),
        "trip_ms": ("<f8", trip_ms),
        "trip_weight": ("<f8", [t["weight"] for t in trips]),
        "trip_path_offsets": ("<u4", np.r_[0, np.cumsum([len(p) for p in paths])]),
        "trip_path_edges": ("<u4", [e for p in paths for e in p]),
    }
    out.mkdir(parents=True)
    order_input = tool.canonical_input(
        np.array([box_graph.coords[n][0] for n in box_graph.vertices]),
        np.array([box_graph.coords[n][1] for n in box_graph.vertices]),
        np.array([r.source for r in rows]),
        np.array([r.target for r in rows]),
    )
    permutation, manifest, local = cch_order(order_input, order, out, tool)
    box = config.box
    meta = {
        "format_version": FORMAT_VERSION,
        "byte_order": "little",
        "snapshot": snapshot,
        "git_commit": git[0],
        "git_dirty": git[1],
        "box": {
            "min_lat": box.min_lat,
            "max_lat": box.max_lat,
            "min_lon": box.min_lon,
            "max_lon": box.max_lon,
        },
        "counts": {
            "vertices": vertices,
            "edges": len(rows),
            "ways": len(way_ids),
            "trips": len(trips),
            "initially_active_edges": len(box_graph.edges),
            "excluded_trips": len(excluded),
        },
        "projection_lat": config.projection_lat,
        "metres_per_degree": config.metres_per_degree,
        "earth_radius_m": config.earth_radius_m,
        "simplification_tolerance_m": config.simplification_tolerance_m,
        "geometry_coordinate_order": "lat,lon",
        "geometry_scale": config.geometry_scale,
        "geometry_scope": "full polylines of exported ways",
        "slow_seconds": tomllib.loads(thresholds_path.read_text(encoding="utf-8"))["slow_seconds"],
        "presets": preset_definitions(demo_faults_path, way_ids),
        "highway_classes": classes,
        "baseline_tie_rule": TIE_RULE,
        "scipy_version": scipy.__version__,
        "cch_order": {
            "method": order,
            "file": "cch_order.bin.gz",
            "manifest_file": "order_manifest.json.gz",
        },
        "local_files": local_files(out, local),
        "arrays": [],
        "files": [],
    }
    return write_export(
        out,
        arrays,
        {
            "order_manifest": manifest,
            "excluded_trips": excluded,
            "way_names": [r[3] for r in box_graph.roads],
            "trip_labels": [{"trip_id": t["trip_id"], "kind": t["kind"]} for t in trips],
        },
        meta,
        blobs={"cch_order.bin.gz": permutation.astype("<u4").tobytes()},
        json_arrays=("way_names", "trip_labels"),
    )
