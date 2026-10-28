"""Offline impact checks exercise coordinate snapping against the town oracle."""

import csv
import json
import shutil
from math import inf
from pathlib import Path

import duckdb
import pytest
from scipy.sparse import csr_matrix

from route_impact.cli import main
from route_impact.extract import extract
from route_impact.graph import Edge, Graph, Segment, build_graph, route_pairs, shortest
from route_impact.impact import (
    Snapper,
    compare_trips,
    compute_impact,
    segment_costs,
    snapshot_nodes,
    summarize,
)
from route_impact.risk import Thresholds, exit_code, load_thresholds, risk_level


@pytest.fixture
def thresholds() -> Thresholds:
    # Fixture delays are only 25–92 seconds, below the provisional default 120.
    return Thresholds(10, 300, 0.005, 10, 200)


@pytest.fixture(scope="module")
def towns(tmp_path_factory: pytest.TempPathFactory) -> dict:
    folder = tmp_path_factory.mktemp("impact")
    fixtures = Path(__file__).parent / "fixtures"
    expected = json.loads((fixtures / "expected.json").read_text())
    databases = {
        name: extract(fixtures / f"{name}.osm.pbf", folder / f"{name}.duckdb")
        for name in expected["versions"]
    }
    graphs = {name: build_graph(db) for name, db in databases.items()}
    nodes = {name: snapshot_nodes(db, graphs[name], 2, "2GB") for name, db in databases.items()}
    with duckdb.connect(
        str(databases["town_v1"]), config={"threads": 2, "memory_limit": "2GB"}
    ) as connection:
        coords = {
            n: (lat, lon)
            for n, lat, lon in connection.execute(
                "SELECT node_id, lat, lon FROM road_nodes"
            ).fetchall()
        }
    rows = [
        {
            "trip_id": name,
            "kind": "intercity",
            "weight": 1,
            "o_lat": coords[t["from"]][0],
            "o_lon": coords[t["from"]][1],
            "d_lat": coords[t["to"]][0],
            "d_lon": coords[t["to"]][1],
        }
        for name, t in expected["trips"].items()
    ]
    return {"db": databases, "graphs": graphs, "nodes": nodes, "rows": rows, "expected": expected}


def comparison(
    towns: dict, version: str, thresholds: Thresholds, *, full: bool = False
) -> tuple[list[dict], list[dict]]:
    return compare_trips(
        towns["graphs"]["town_v1"],
        towns["graphs"][version],
        towns["nodes"]["town_v1"],
        towns["nodes"][version],
        towns["rows"],
        thresholds,
        full=full,
        batch=2,
    )


@pytest.mark.parametrize("version", ["town_v1", "town_v2", "town_v2_split"])
def test_fixture_impact(towns: dict, version: str, thresholds: Thresholds) -> None:
    records, excluded = comparison(towns, version, thresholds)
    full, full_excluded = comparison(towns, version, thresholds, full=True)
    assert excluded == full_excluded == []
    assert [(r["trip_id"], r["status"], r["new_seconds"]) for r in records] == [
        (r["trip_id"], r["status"], r["new_seconds"]) for r in full
    ]
    payload = compute_impact(
        towns["db"]["town_v1"], towns["db"][version], towns["rows"], thresholds
    )
    affected = {r["trip_id"]: r for r in payload["trips"]}
    for record in records:
        oracle = towns["expected"]["trips"][record["trip_id"]]
        expected_status = oracle["v2_status"] if version == "town_v2" else "unchanged"
        assert record["status"] == ("ok" if expected_status == "unchanged" else expected_status)
        seconds = oracle["seconds"][version]
        assert (
            None if record["new_seconds"] == inf else round(record["new_seconds"], 2)
        ) == seconds
    if version == "town_v2":
        assert set(affected) == {"T1", "T2", "T3", "T4", "T5"}
        assert affected["T5"]["new_destination"] == 401
        assert affected["T5"]["reason"] == "unreachable"
        assert affected["T5"]["fallback_snap"] is False
        assert affected["T5"]["new_path"] is None
        assert affected["T5"]["new_seconds"] is None
        assert payload["metrics"]["broken"] == 1
        assert payload["metrics"]["slowed"] == 4
        assert payload["risk"]["level"] == "HIGH"
        assert payload["metrics"]["gravity_share_affected"] == 0.56
    else:
        assert payload["metrics"]["changed_segments"] == 0
        assert payload["metrics"]["broken"] == payload["metrics"]["slowed"] == 0
        assert payload["risk"]["level"] == "LOW"
        assert payload["exit_code"] == 0
        assert payload["trips"] == []
    first = json.dumps(payload, sort_keys=True, allow_nan=False).encode()
    second = json.dumps(
        compute_impact(towns["db"]["town_v1"], towns["db"][version], towns["rows"], thresholds),
        sort_keys=True,
        allow_nan=False,
    ).encode()
    assert first == second


@pytest.mark.parametrize("version", ["town_v1", "town_v2", "town_v2_split"])
def test_route_pairs(towns: dict, version: str) -> None:
    graph = towns["graphs"][version]
    pairs = [(t["from"], t["to"]) for t in towns["expected"]["trips"].values()] + [(100, 100)]
    cartesian = shortest(graph, (a for a, _ in pairs), (b for _, b in pairs), batch=2)
    assert route_pairs(graph, iter(pairs + pairs), batch=2) == {p: cartesian[p] for p in pairs}
    assert route_pairs(graph, pairs, batch=1) == route_pairs(graph, pairs)
    assert route_pairs(graph, [(100, 100)])[100, 100].seconds == 0.0
    assert route_pairs(graph, [(100, 100)])[100, 100].segments == ()
    assert route_pairs(graph, []) == {}
    with pytest.raises(ValueError, match="batch must be positive"):
        route_pairs(graph, [], batch=0)
    for pair in [(99999, 100), (100, 99999)]:
        with pytest.raises(ValueError, match="not a graph vertex"):
            route_pairs(graph, [pair])
    if version == "town_v2":
        assert route_pairs(graph, [(100, 401)])[100, 401].seconds == inf
        assert route_pairs(graph, [(100, 401)])[100, 401].segments is None


@pytest.mark.parametrize(
    "ic_broken,share,local_broken,ic_slowed,level,rule",
    [
        (1, 0.005, 10, 1, "HIGH", "HIGH: 1 intercity trip broken"),
        (
            0,
            0.005,
            10,
            1,
            "HIGH",
            "HIGH: gravity share of broken or severely slowed intercity trips",
        ),
        (0, 0.0049, 10, 1, "HIGH", "HIGH: 10 local trips broken"),
        (0, 0, 9, 1, "MEDIUM", "MEDIUM: trip broken"),
        (0, 0, 0, 1, "MEDIUM", "MEDIUM: intercity trip slowed"),
        (0, 0, 0, 0, "LOW", "LOW: no rule fired"),
    ],
)
def test_risk(
    thresholds: Thresholds,
    ic_broken: int,
    share: float,
    local_broken: int,
    ic_slowed: int,
    level: str,
    rule: str,
) -> None:
    metrics = {
        "intercity": {"broken": ic_broken, "slowed": ic_slowed},
        "local": {"broken": local_broken},
        "broken": ic_broken + local_broken,
        "gravity_share_high": share,
    }
    assert risk_level(metrics, thresholds) == (level, rule)
    assert exit_code(level) == (1 if level == "HIGH" else 0)


def test_threshold_loading(tmp_path: Path) -> None:
    path = Path("config/thresholds.toml")
    assert load_thresholds(path) == Thresholds(120, 300, 0.005, 10, 200)
    original = path.read_text()
    invalid = tmp_path / "thresholds.toml"
    for bad in (
        "slow_seconds = 0",
        "slow_seconds = -1",
        "slow_seconds = nan",
        "slow_seconds = inf",
        "slow_seconds = true",
        "slow_seconds = 'bad'",
        "",
    ):
        invalid.write_text(original.replace("slow_seconds = 120", bad, 1))
        with pytest.raises(ValueError, match="slow_seconds"):
            load_thresholds(invalid)


def synthetic_graph(a: int, b: int, seconds: float) -> Graph:
    forward = Segment(a, b, 1, 0, 100, seconds)
    reverse = Segment(b, a, 1, 0, 100, seconds)
    edges = [Edge(a, b, seconds, (forward,)), Edge(b, a, seconds, (reverse,))]
    return Graph(
        (a, b),
        {a: 0, b: 1},
        edges,
        {(e.u, e.v): e for e in edges},
        csr_matrix([[0, seconds], [seconds, 0]]),
        0,
    )


@pytest.mark.parametrize("replacement_lon,expected", [(0.001, "ok"), (0.003, "broken")])
def test_fallback(thresholds: Thresholds, replacement_lon: float, expected: str) -> None:
    rows = [
        {
            "trip_id": "fallback",
            "kind": "local",
            "weight": 1,
            "o_lat": 0,
            "o_lon": 0,
            "d_lat": 0,
            "d_lon": 0.02,
        }
    ]
    records, excluded = compare_trips(
        synthetic_graph(1, 2, 20),
        synthetic_graph(3, 2, 20),
        [(1, 0, 0), (2, 0, 0.02)],
        [(3, 0, replacement_lon), (2, 0, 0.02)],
        rows,
        thresholds,
    )
    assert excluded == []
    record = records[0]
    assert record["fallback_snap"] is True
    assert record["rerouted"] is True
    assert record["status"] == expected
    assert record["new_origin"] == (3 if expected == "ok" else None)
    assert record["reason"] == (None if expected == "ok" else "endpoint_lost")
    assert record["new_seconds"] == (20 if expected == "ok" else inf)


@pytest.mark.parametrize(
    "delay,status", [(9.999, "ok"), (10, "slowed"), (300, "slowed"), (-5, "ok")]
)
def test_delay_boundaries(thresholds: Thresholds, delay: float, status: str) -> None:
    rows = [
        {
            "trip_id": "delay",
            "kind": "intercity",
            "weight": 1,
            "o_lat": 0,
            "o_lon": 0,
            "d_lat": 0,
            "d_lon": 0.02,
        }
    ]
    nodes = [(1, 0, 0), (2, 0, 0.02)]
    records, excluded = compare_trips(
        synthetic_graph(1, 2, 20),
        synthetic_graph(1, 2, 20 + delay),
        nodes,
        nodes,
        rows,
        thresholds,
        full=True,
    )
    assert records[0]["status"] == status
    assert records[0]["improved"] == (delay < 0)
    metrics = summarize(records, excluded, thresholds)
    assert metrics["gravity_share_high"] == (1 if delay >= 300 else 0)
    assert metrics["gravity_share_affected"] == (1 if delay >= 10 else 0)
    assert metrics["delay_median_s"] == (delay if status == "slowed" else None)
    assert metrics["delay_p95_s"] == (delay if status == "slowed" else None)


def test_snapping_exclusion_and_metrics(thresholds: Thresholds) -> None:
    snapper = Snapper([(8, 0, 0.001), (3, 0, -0.001)])
    assert snapper.nearest(0, 0)[0] == 3
    assert snapper.nearest(0, 0)[1] == pytest.approx(111.1950802335329)
    assert Snapper([]).nearest(0, 0) == (None, inf)
    rows = [
        {
            "trip_id": "self",
            "kind": "local",
            "weight": 1,
            "o_lat": 0,
            "o_lon": 0,
            "d_lat": 0,
            "d_lon": 0,
        }
    ]
    graph = synthetic_graph(1, 2, 20)
    records, excluded = compare_trips(graph, graph, [(1, 0, 0), (2, 0, 0.02)], [], rows, thresholds)
    assert records == []
    assert [r["trip_id"] for r in excluded] == ["self"]
    metrics = summarize(records, excluded, thresholds)
    assert metrics["trips_total"] == metrics["excluded_old"] == 1
    assert metrics["local"]["excluded_old"] == 1
    assert metrics["gravity_share_affected"] == metrics["gravity_share_high"] == 0
    assert metrics["delay_median_s"] is None
    # Distinct pairs counted once even when shared by multiple paths/trips.
    records = [
        {
            "status": "slowed",
            "delay_s": delay,
            "kind": kind,
            "weight": weight,
            "rerouted": True,
            "improved": False,
            "changed_segments": [[1, 2, 1], [1, 2, 2]],
        }
        for delay, kind, weight in [(10, "intercity", 2), (30, "local", 1)]
    ]
    metrics = summarize(records, [], thresholds)
    assert metrics["changed_segments"] == 1
    assert metrics["delay_median_s"] == 20
    assert metrics["delay_p95_s"] == 29
    assert metrics["intercity"]["slowed"] == metrics["local"]["slowed"] == 1
    assert metrics["gravity_share_affected"] == 1
    assert metrics["gravity_share_high"] == 0
    assert risk_level(summarize([records[1]], [], thresholds), thresholds)[0] == "LOW"


def test_parallel_segment_costs() -> None:
    graph = synthetic_graph(1, 2, 20)
    extra = Segment(1, 2, 99, 0, 100, 5)
    graph.edges.append(Edge(1, 2, 5, (extra,)))
    assert segment_costs(graph) == {(1, 2): 5, (2, 1): 20}


def test_cli(
    towns: dict, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    data = tmp_path / "data"
    data.mkdir()
    fixtures = Path(__file__).parent / "fixtures"
    for date, version in [("261001", "town_v1"), ("261002", "town_v2")]:
        shutil.copyfile(fixtures / f"{version}.osm.pbf", data / f"norcal-{date}.osm.pbf")
    trips = tmp_path / "trips.csv"
    with trips.open("w", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=list(towns["rows"][0]))
        writer.writeheader()
        writer.writerows(towns["rows"])
    results = tmp_path / "results"
    common = ["--data-dir", str(data), "--results-dir", str(results), "--trips", str(trips)]
    assert main(["impact", "--old", "261001", "--new", "261002", *common]) == 1
    output = results / "2026-10-02/impact.json"
    payload = json.loads(output.read_text())
    assert payload["old"] == "261001"
    assert payload["new"] == "261002"
    assert payload["risk"]["level"] == "HIGH"
    assert "broken=1 slowed=0" in capsys.readouterr().out
    assert main(["impact", "--old", "261001", "--new", "261001", *common]) == 0
    assert json.loads((results / "2026-10-01/impact.json").read_text())["trips"] == []
    assert main(["impact", "--old", "261001", "--new", "261003", *common]) == 2
    assert "Snapshot file not found" in capsys.readouterr().err
    for date in ("latest", "261332", "26102", "26ab02"):
        assert main(["impact", "--old", date, "--new", "261002", *common]) == 2

    def crash(*args: object, **kwargs: object) -> None:
        raise RuntimeError("injected impact error")

    monkeypatch.setattr("route_impact.cli.compute_impact", crash)
    assert main(["impact", "--old", "261001", "--new", "261002", *common]) == 2
    assert "injected impact error" in capsys.readouterr().err
