"""Playground exporter (P1a) on the offline town fixtures, with the identity CCH order."""

import csv
import gzip
import hashlib
import heapq
import json
from collections import Counter
from dataclasses import replace
from math import inf
from pathlib import Path

import numpy as np
import pytest
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components

from route_impact.cli import main
from route_impact.playground import (
    Box,
    PlaygroundConfig,
    baseline_csr,
    cut_graph,
    export_playground,
    load_config,
    round_ms,
    route_baselines,
    write_export,
)

ROOT = Path(__file__).resolve().parents[1]
TRIPS = ROOT / "tests/fixtures/town_trips.csv"
CONFIG = load_config(ROOT / "config/playground.toml")
# Cuts the town's east side (lon > -122.28): four trips and some roads fall outside.
WEST_BOX = Box(37.79, 37.83, -122.31, -122.28)


def run_export(db: Path, out: Path, config: PlaygroundConfig = CONFIG) -> dict:
    return export_playground(
        db,
        "000000",
        out,
        trips_path=TRIPS,
        config=config,
        thresholds_path=ROOT / "config/thresholds.toml",
        demo_faults_path=ROOT / "config/demo_faults.toml",
        order="identity",
    )


def load(out: Path) -> tuple[dict, dict[str, np.ndarray], dict]:
    meta = json.loads((out / "meta.json").read_text())
    arrays = {
        a["name"]: np.frombuffer(gzip.decompress((out / a["file"]).read_bytes()), a["dtype"])
        for a in meta["arrays"]
    }
    names = ("way_names", "trip_labels", "excluded_trips", "order_manifest")
    documents = {n: json.loads(gzip.decompress((out / f"{n}.json.gz").read_bytes())) for n in names}
    return meta, arrays, documents


@pytest.fixture(scope="module")
def town(towns: dict, tmp_path_factory: pytest.TempPathFactory) -> dict:
    out = tmp_path_factory.mktemp("playground") / "town"
    run_export(towns["db"]["town_v1"], out)
    meta, arrays, documents = load(out)
    return {"out": out, "meta": meta, "a": arrays, "docs": documents}


@pytest.fixture(scope="module")
def west(towns: dict, tmp_path_factory: pytest.TempPathFactory) -> dict:
    out = tmp_path_factory.mktemp("playground") / "west"
    run_export(towns["db"]["town_v1"], out, replace(CONFIG, box=WEST_BOX))
    meta, arrays, documents = load(out)
    return {"out": out, "meta": meta, "a": arrays, "docs": documents}


def sources(a: dict[str, np.ndarray]) -> np.ndarray:
    return np.repeat(np.arange(len(a["csr_offsets"]) - 1), np.diff(a["csr_offsets"].astype(int)))


def reference_dijkstra(a: dict[str, np.ndarray], origin: int) -> dict[int, int]:
    """Plain heapq Dijkstra relaxing every active edge directly (no parallel collapse)."""
    offsets, target, ms = a["csr_offsets"], a["edge_target"], a["edge_ms"]
    active = a["edge_initially_active"]
    dist, heap, done = {origin: 0}, [(0, origin)], set()
    while heap:
        d, u = heapq.heappop(heap)
        if u in done:
            continue
        done.add(u)
        for e in range(int(offsets[u]), int(offsets[u + 1])):
            if active[e]:
                v, nd = int(target[e]), d + int(ms[e])
                if nd < dist.get(v, inf):
                    dist[v] = nd
                    heapq.heappush(heap, (nd, v))
    return dist


def test_round_ms_exact_pairs() -> None:
    # 2.0005 * 1000 is 2000.5000000000002 in Float64, 0.0025 * 1000 is exactly 2.5.
    pairs = {1.4995: 1500, 2.0005: 2001, 0.0004: 0, 0.0005: 1, 0.0025: 3}
    assert {s: round_ms(s) for s in pairs} == pairs
    assert round_ms((2**32 - 1) / 1000) == 2**32 - 1
    for bad in (-0.001, (2**32 - 1) / 1000 + 0.001, float("nan"), float("inf")):
        with pytest.raises(ValueError):
            round_ms(bad)


def test_counts(town: dict, towns: dict) -> None:
    graph = towns["graphs"]["town_v1"]
    lscc = graph.lscc()
    pipeline = [e for e in graph.edges if e.u in lscc and e.v in lscc]
    counts = town["meta"]["counts"]
    assert counts == {
        "vertices": 38,
        "edges": 116,
        "ways": 25,
        "trips": 9,
        "initially_active_edges": 106,
        "excluded_trips": 0,
    }
    assert counts["vertices"] == len(lscc)
    assert counts["initially_active_edges"] == len(pipeline)
    assert int(town["a"]["edge_initially_active"].sum()) == len(pipeline)
    assert len(town["a"]["trip_ms"]) == len(town["docs"]["trip_labels"]) == 9


def test_one_active_row_per_pipeline_edge(town: dict, towns: dict) -> None:
    graph = towns["graphs"]["town_v1"]
    vertices = sorted(graph.lscc())  # The default box holds the whole town.
    a = town["a"]
    source = sources(a)
    active = np.flatnonzero(a["edge_initially_active"])
    exported = Counter(
        (
            vertices[source[e]],
            vertices[a["edge_target"][e]],
            int(a["edge_ms"][e]),
            int(a["way_osm_id"][a["edge_way"][e]]),
        )
        for e in active
    )
    lscc = set(vertices)
    expected = Counter(
        (e.u, e.v, round_ms(e.seconds), e.segments[0].way_id)
        for e in graph.edges
        if e.u in lscc and e.v in lscc
    )
    assert exported == expected
    pairs = Counter((source[e], a["edge_target"][e]) for e in active)
    assert max(pairs.values()) >= 2, "the town fixture should contain parallel edges"


def test_oneway_reverse_twins(town: dict) -> None:
    a = town["a"]
    source, twin, active = sources(a), a["edge_twin"], a["edge_initially_active"]
    oneway = a["way_oneway"][a["edge_way"]].astype(bool)
    assert oneway.any() and (~oneway).any()
    for e in range(len(twin)):
        if not oneway[e]:
            assert twin[e] == -1 and active[e] == 1
            continue
        t = int(twin[e])
        assert t >= 0 and twin[t] == e and active[e] + active[t] == 1
        assert (source[t], a["edge_target"][t]) == (a["edge_target"][e], source[e])
        assert a["edge_ms"][t] == a["edge_ms"][e] and a["edge_way"][t] == a["edge_way"][e]
    assert (active == 0).sum() == (oneway & (active == 1)).sum()


@pytest.mark.parametrize("name", ["town", "west"])
def test_baselines_match_reference_dijkstra(name: str, request: pytest.FixtureRequest) -> None:
    a = request.getfixturevalue(name)["a"]
    source, offsets = sources(a), a["trip_path_offsets"]
    for t, (o, d) in enumerate(zip(a["trip_origin"], a["trip_destination"], strict=True)):
        assert a["trip_ms"][t] == reference_dijkstra(a, int(o))[int(d)]
        path = a["trip_path_edges"][offsets[t] : offsets[t + 1]]
        at = int(o)
        for e in path:
            assert source[e] == at and a["edge_initially_active"][e] == 1
            at = int(a["edge_target"][e])
        assert at == d
        assert int(a["edge_ms"][path].sum()) == a["trip_ms"][t]


def test_box_override_cuts_graph_and_excludes_trips(west: dict, towns: dict) -> None:
    meta, docs = west["meta"], west["docs"]
    with TRIPS.open(newline="") as source:
        rows = list(csv.DictReader(source))
    outside = [
        r["trip_id"]
        for r in rows
        if not (
            WEST_BOX.contains(float(r["o_lat"]), float(r["o_lon"]))
            and WEST_BOX.contains(float(r["d_lat"]), float(r["d_lon"]))
        )
    ]
    assert outside and docs["excluded_trips"] == [
        {"trip_id": t, "reason": "raw_endpoint_outside_box"} for t in outside
    ]
    assert [t["trip_id"] for t in docs["trip_labels"]] == [
        r["trip_id"] for r in rows if r["trip_id"] not in outside
    ]
    assert meta["counts"]["excluded_trips"] == len(outside)
    assert meta["box"] == {
        "min_lat": 37.79,
        "max_lat": 37.83,
        "min_lon": -122.31,
        "max_lon": -122.28,
    }
    # Independent LSCC of the box subgraph, straight from the pipeline graph.
    graph = towns["graphs"]["town_v1"]
    inside = {n for n, lat, lon in towns["nodes"]["town_v1"] if WEST_BOX.contains(lat, lon)}
    edges = [e for e in graph.edges if e.u in inside and e.v in inside]
    nodes = sorted({n for e in edges for n in (e.u, e.v)})
    ix = {n: i for i, n in enumerate(nodes)}
    matrix = csr_matrix(
        ([1] * len(edges), ([ix[e.u] for e in edges], [ix[e.v] for e in edges])),
        shape=(len(nodes),) * 2,
    )
    _, labels = connected_components(matrix, directed=True, connection="strong")
    sizes = np.bincount(labels)
    assert (sizes == sizes.max()).sum() == 1
    lscc = {n for n, label in zip(nodes, labels, strict=True) if sizes[label] == sizes.max()}
    cut = cut_graph(towns["db"]["town_v1"], WEST_BOX, threads=2, memory_limit="2GB")
    assert set(cut.vertices) == lscc
    assert meta["counts"]["vertices"] == len(lscc) < 38
    kept = [e for e in edges if e.u in lscc and e.v in lscc]
    assert meta["counts"]["initially_active_edges"] == len(kept)


def test_synthetic_zero_ms_and_equal_parallel_edges() -> None:
    # 0→1 has two equal 5 ms parallels (ids 0, 1) and an inactive 1 ms one (id 2);
    # 1→2 is a zero-ms edge; 0→2 direct costs 9 ms, so 0→2 goes 0→1→2 at 5 ms.
    source = [0, 0, 0, 0, 1, 2]
    target = [1, 1, 1, 2, 2, 0]
    ms = [5, 5, 1, 9, 0, 7]
    active = [1, 1, 0, 1, 1, 1]
    csr = baseline_csr(3, source, target, ms, active)
    assert csr.matrix.nnz == 4 and csr.winner(0, 1) == 0
    assert csr.winner(0, 2) == 3 and csr.winner(1, 2) == 4 and csr.winner(2, 0) == 5
    row = slice(csr.matrix.indptr[1], csr.matrix.indptr[2])
    assert csr.matrix.indices[row].tolist() == [2] and csr.matrix.data[row].tolist() == [0.0]
    assert csr.winners.tolist() == [0, 3, 4, 5]
    distances, paths = route_baselines(csr, [0, 0, 2, 1], [2, 1, 1, 1])
    assert distances == [5, 5, 12, 0]
    assert paths == [[0, 4], [0], [5, 0], []]
    a = {
        "csr_offsets": np.array([0, 4, 5, 6]),
        "edge_target": np.array(target),
        "edge_ms": np.array(ms),
        "edge_initially_active": np.array(active),
    }
    assert reference_dijkstra(a, 0) == {0: 0, 1: 5, 2: 5}


def test_export_is_deterministic(town: dict, towns: dict, tmp_path: Path) -> None:
    again = tmp_path / "again"
    run_export(towns["db"]["town_v1"], again)
    first = sorted(p.name for p in town["out"].iterdir())
    assert first == sorted(p.name for p in again.iterdir())
    for name in first:
        assert (town["out"] / name).read_bytes() == (again / name).read_bytes(), name


def test_meta_sizes_and_hashes_match_files(town: dict) -> None:
    out, meta = town["out"], town["meta"]
    assert meta["format_version"] == 1
    for row in meta["files"]:
        data = (out / row["file"]).read_bytes()
        assert row["gzip_bytes"] == len(data)
        if row["file"] == "meta.json":
            assert row["raw_bytes"] == len(data) and "sha256" not in row
            continue
        assert row["sha256"] == hashlib.sha256(data).hexdigest()
        assert row["raw_bytes"] == len(gzip.decompress(data))
        assert data[4:8] == b"\0\0\0\0"  # gzip mtime 0
    assert meta["total_shipped_bytes"] == sum(row["gzip_bytes"] for row in meta["files"])
    shipped = {row["file"] for row in meta["files"]}
    assert {f"{a['name']}.bin.gz" for a in meta["arrays"]} < shipped
    assert {"cch_order.bin.gz", "order_manifest.json.gz", "excluded_trips.json.gz"} < shipped
    assert "presets.json.gz" not in shipped
    local = meta["local_files"]
    assert [row["file"] for row in local] == ["cch_order_input.bin"] and not local[0]["shipped"]
    assert (
        local[0]["sha256"] == hashlib.sha256((out / "cch_order_input.bin").read_bytes()).hexdigest()
    )
    assert sorted(p.name for p in out.iterdir()) == sorted(shipped | {"cch_order_input.bin"})


def test_meta_records_config_order_and_presets(town: dict) -> None:
    meta = town["meta"]
    for key in ("projection_lat", "metres_per_degree", "earth_radius_m"):
        assert meta[key] == getattr(CONFIG, key)
    assert meta["geometry_scale"] == 1000000 and meta["simplification_tolerance_m"] == 5
    assert meta["slow_seconds"] == 120
    assert meta["cch_order"]["method"] == "identity"
    order = np.frombuffer(gzip.decompress((town["out"] / "cch_order.bin.gz").read_bytes()), "<u4")
    assert order.tolist() == list(range(meta["counts"]["vertices"]))
    assert town["docs"]["order_manifest"]["method"] == "identity"
    presets = meta["presets"]
    assert sorted(presets) == ["bay_bridge", "university_ramp"]
    # No real Bay way is in the town, so every preset way is reported missing.
    assert all(p["missing_way_ids"] == p["ids"] for p in presets.values())


def test_write_export_replaces_entries_and_refinalizes(town: dict, tmp_path: Path) -> None:
    out = tmp_path / "copy"
    out.mkdir()
    for path in town["out"].iterdir():
        (out / path.name).write_bytes(path.read_bytes())
    meta = write_export(out, {}, {"presets": {"demo": [1, 2]}}, town["meta"])
    meta = write_export(out, {"trip_weight": ("<f8", [1.0])}, {"presets": {"x": 1}}, meta)
    names = [row["file"] for row in meta["files"]]
    assert len(names) == len(set(names)) and names[-1] == "meta.json"
    assert [a["name"] for a in meta["arrays"]].count("trip_weight") == 1
    on_disk = json.loads((out / "meta.json").read_text())
    assert on_disk == meta
    assert on_disk["files"][-1]["raw_bytes"] == (out / "meta.json").stat().st_size
    with pytest.raises(ValueError):
        write_export(out, {"bad": ("<i8", [1])}, {}, meta)


def test_export_replaces_only_on_success(towns: dict, tmp_path: Path) -> None:
    out = tmp_path / "out"
    run_export(towns["db"]["town_v1"], out)
    before = {p.name: p.read_bytes() for p in out.iterdir()}
    with pytest.raises(FileNotFoundError):
        export_playground(
            towns["db"]["town_v1"],
            "000000",
            out,
            trips_path=tmp_path / "missing.csv",
            config=CONFIG,
            thresholds_path=ROOT / "config/thresholds.toml",
            demo_faults_path=ROOT / "config/demo_faults.toml",
            order="identity",
        )
    assert {p.name: p.read_bytes() for p in out.iterdir()} == before
    assert sorted(p.name for p in tmp_path.iterdir()) == ["out"]  # temp dir cleaned
    (out / "stale.txt").write_text("x")
    run_export(towns["db"]["town_v1"], out)  # an earlier export is replaced whole
    assert not (out / "stale.txt").exists()
    other = tmp_path / "other"
    other.mkdir()
    (other / "keep.txt").write_text("x")
    with pytest.raises(FileExistsError):
        run_export(towns["db"]["town_v1"], other)
    assert [p.name for p in other.iterdir()] == ["keep.txt"]


def test_meta_records_git_state(town: dict) -> None:
    meta = town["meta"]
    assert len(meta["git_commit"]) == 40 and isinstance(meta["git_dirty"], bool)


def test_cli_export_playground(towns: dict, tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    db = str(towns["db"]["town_v1"])
    common = ["--db", db, "--trips", str(TRIPS), "--order", "identity"]
    out = tmp_path / "default"
    assert main(["export-playground", "--snapshot", "261027", "--out", str(out), *common]) == 0
    assert json.loads((out / "meta.json").read_text())["snapshot"] == "261027"
    assert "TOTAL shipped" in capsys.readouterr().out
    bad = ["export-playground", "--snapshot", "latest", "--out", str(tmp_path / "y"), *common]
    assert main(bad) == 2
    missing = ["--db", str(tmp_path / "missing.duckdb"), "--out", str(tmp_path / "x")]
    assert main(["export-playground", "--snapshot", "261027", *missing]) == 2
    with pytest.raises(SystemExit):  # --db is required
        main(["export-playground", "--snapshot", "261027", "--out", str(tmp_path / "z")])


def test_cli_config_box_override(towns: dict, tmp_path: Path) -> None:
    config = tmp_path / "playground.toml"
    text = (ROOT / "config/playground.toml").read_text()
    config.write_text(text.replace("max_lon = -121.7", "max_lon = -122.28"))
    out = tmp_path / "west"
    args = ["--db", str(towns["db"]["town_v1"]), "--trips", str(TRIPS), "--order", "identity"]
    assert (
        main(
            [
                "export-playground",
                "--snapshot",
                "261027",
                "--out",
                str(out),
                *args,
                "--config",
                str(config),
            ]
        )
        == 0
    )
    meta = json.loads((out / "meta.json").read_text())
    assert meta["box"]["max_lon"] == -122.28
    assert meta["counts"]["excluded_trips"] == 4 and meta["counts"]["trips"] == 5
