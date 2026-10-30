"""Canonical CCH order input, the RoutingKit order tool run, validation and a hash manifest.

Usage (after `make -C scripts/cch_order`):
  python scripts/cch_order/order.py --spike data/playground-spike
writes cch_order.bin.gz (u32 order[rank] = vertex) and order_manifest.json next to the spike data.
"""

import argparse
import gzip
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "scripts/cch_order"
BIN = ROOT / "data/cch_order/cch_order"


def canonical_input(lat: np.ndarray, lon: np.ndarray, tail: np.ndarray, head: np.ndarray) -> bytes:
    """Undirected, deduplicated, loop-free pairs sorted by (min, max); coordinates in microdegrees."""
    a, b = np.minimum(tail, head), np.maximum(tail, head)
    keep = a != b
    pairs = np.unique(np.stack([a[keep], b[keep]], axis=1).astype(np.uint32), axis=0)
    lat_micro = np.rint(np.asarray(lat, dtype=np.float64) * 1e6).astype("<i4")
    lon_micro = np.rint(np.asarray(lon, dtype=np.float64) * 1e6).astype("<i4")
    header = b"CCHIN1\0\0" + np.array([len(lat), len(pairs)], dtype="<u4").tobytes()
    return (
        header
        + lat_micro.tobytes()
        + lon_micro.tobytes()
        + pairs[:, 0].astype("<u4").tobytes()
        + pairs[:, 1].astype("<u4").tobytes()
    )


def tool_info() -> dict:
    def make(target: str) -> str:
        return subprocess.run(
            ["make", "-s", "-C", str(TOOL_DIR), target], check=True, capture_output=True, text=True
        ).stdout.strip()

    compiler = subprocess.run(
        ["c++", "--version"], check=True, capture_output=True, text=True
    ).stdout.splitlines()[0]
    return {
        "routingkit_commit": make("commit"),
        "compiler": compiler,
        "flags": make("flags").replace(str(ROOT) + "/", ""),
        "tool_source_sha256": sha256((TOOL_DIR / "main.cpp").read_bytes()),
    }


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compute_order(input_bytes: bytes, workdir: Path) -> tuple[np.ndarray, dict]:
    if not BIN.exists():
        raise SystemExit(f"Missing {BIN}; run `make -C scripts/cch_order` first")
    workdir.mkdir(parents=True, exist_ok=True)
    src, dst = workdir / "cch_order_input.bin", workdir / "cch_order_output.bin"
    src.write_bytes(input_bytes)
    subprocess.run([str(BIN), str(src), str(dst)], check=True)
    output = dst.read_bytes()
    n = int(np.frombuffer(input_bytes[8:12], dtype="<u4")[0])
    order = np.frombuffer(output, dtype="<u4")
    if len(order) != n or not np.array_equal(np.sort(order), np.arange(n, dtype=np.uint32)):
        raise ValueError("order is not a permutation of 0..n-1")
    manifest = {
        **tool_info(),
        "orientation": "order[rank] = vertex; rank = inverse permutation",
        "nodes": n,
        "undirected_edges": int(np.frombuffer(input_bytes[12:16], dtype="<u4")[0]),
        "input_sha256": sha256(input_bytes),
        "output_sha256": sha256(output),
    }
    return order, manifest


def read_spike(spike: Path, name: str) -> np.ndarray:
    meta = json.loads((spike / "meta.json").read_text())
    entry = next(a for a in meta["arrays"] if a["name"] == name)
    raw = gzip.decompress((spike / entry["file"]).read_bytes())
    return np.frombuffer(raw, dtype=entry["dtype"])


def fixture_grid(size: int = 6) -> dict:
    """A small road-like test graph: a grid plus two diagonals, with real-looking coordinates."""
    lat = [37.80 - 0.002 * (i // size) for i in range(size * size)]
    lon = [-122.42 + 0.0025 * (i % size) for i in range(size * size)]
    edges = []
    for i in range(size * size):
        r, c = divmod(i, size)
        if c + 1 < size:
            edges.append([i, i + 1])
        if r + 1 < size:
            edges.append([i, i + size])
    edges += [[0, size + 1], [size * size - 1, size * size - size - 2]]
    return {"name": f"grid{size}", "lat": lat, "lon": lon, "edges": edges}


def write_fixture(path: Path) -> None:
    graph = fixture_grid()
    tail, head = np.array(graph["edges"], dtype=np.uint32).T
    order, manifest = compute_order(
        canonical_input(np.array(graph["lat"]), np.array(graph["lon"]), tail, head),
        ROOT / "data/cch_order",
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({**graph, "order": order.tolist(), "manifest": manifest}, indent=1) + "\n"
    )
    print(f"wrote {path}: {len(order)} nodes, order sha256 {manifest['output_sha256']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spike", type=Path)
    parser.add_argument(
        "--fixture", type=Path, help="write the committed test fixture to this path"
    )
    args = parser.parse_args()
    if args.fixture:
        write_fixture(args.fixture)
        return
    if not args.spike:
        parser.error("--spike or --fixture is required")
    lat, lon = read_spike(args.spike, "vertex_lat"), read_spike(args.spike, "vertex_lon")
    target, offsets = read_spike(args.spike, "edge_target"), read_spike(args.spike, "csr_offsets")
    tail = np.repeat(
        np.arange(len(offsets) - 1, dtype=np.uint32), np.diff(offsets.astype(np.int64))
    )
    order, manifest = compute_order(canonical_input(lat, lon, tail, target), args.spike)
    (args.spike / "cch_order.bin.gz").write_bytes(
        gzip.compress(order.astype("<u4").tobytes(), mtime=0)
    )
    (args.spike / "order_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
