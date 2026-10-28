"""Offline contraction, direction and routing checks against the independent oracle."""

import json
from math import inf
from pathlib import Path

import duckdb
import pytest

from route_impact.extract import extract
from route_impact.graph import Graph, build_graph, shortest


@pytest.fixture(params=["town_v1", "town_v2", "town_v2_split"])
def town(request: pytest.FixtureRequest, tmp_path: Path) -> tuple[Graph, dict, str]:
    fixtures = Path(__file__).parent / "fixtures"
    version = request.param
    db = extract(fixtures / f"{version}.osm.pbf", tmp_path / "town.duckdb")
    return build_graph(db), json.loads((fixtures / "expected.json").read_text()), version


def test_counts_and_trips(town: tuple[Graph, dict, str]) -> None:
    graph, expected, version = town
    counts = expected["versions"][version]
    assert len(graph.vertices) == counts["vertices"]
    assert len(graph.edges) == counts["edges"]
    assert len(graph.winning_edges) == counts["reduced_edges"]
    assert graph.matrix.nnz == counts["reduced_edges"]
    assert graph.fallback_speed_count == 0
    trips = expected["trips"].values()
    sources = [trip["from"] for trip in trips]
    targets = [trip["to"] for trip in trips]
    routes = shortest(graph, sources, targets, batch=2)
    assert routes == shortest(graph, sources, targets, batch=32)
    assert len(routes) == len(set(sources)) * len(set(targets))
    for trip in trips:
        route = routes[trip["from"], trip["to"]]
        seconds = trip["seconds"][version]
        if seconds is None:
            assert route.seconds == inf
            assert route.segments is None
        else:
            assert route.seconds == pytest.approx(seconds, abs=0.05)
            assert route.segments[0].a == trip["from"]
            assert route.segments[-1].b == trip["to"]
            assert sum(s.seconds for s in route.segments) == pytest.approx(route.seconds)
            assert all(a.b == b.a for a, b in zip(route.segments, route.segments[1:]))
    assert shortest(graph, [100], [100])[100, 100].segments == ()
    assert shortest(graph, [100], [100])[100, 100].seconds == 0


def test_structure_and_direction(town: tuple[Graph, dict, str]) -> None:
    graph, _, version = town
    assert {300, 301, 302, 800} <= set(graph.vertices)
    assert {303, 801, 802}.isdisjoint(graph.vertices)
    assert (600 in graph.vertices) == (version == "town_v2_split")
    bridge = [s for e in graph.edges for s in e.segments if s.way_id == 51]
    assert {(s.a, s.b) for s in bridge} == (
        set() if version == "town_v2" else {(500, 501), (501, 500)}
    )
    row = {n for e in graph.edges for s in e.segments if s.way_id == 11 for n in (s.a, s.b)}
    assert {500, 501}.isdisjoint(row)
    # No node is inserted at the geometric crossing; bridge 51 stays one segment.
    if bridge:
        assert {500, 501} <= set(graph.vertices)  # endpoints shared with approaches
    roundabout = [s for e in graph.edges for s in e.segments if s.way_id == 40]
    assert {(s.a, s.b, s.seq) for s in roundabout} == {
        (300, 303, 0),
        (303, 302, 1),
        (302, 301, 2),
        (301, 300, 3),
    }
    assert len(roundabout) == 4
    for edge in graph.edges:
        for segment in edge.segments:
            if segment.way_id in {30, 31, 32}:
                assert (
                    segment.a < segment.b
                    if segment.way_id == 30
                    else (
                        (segment.a, segment.b) == ({31: (140, 201), 32: (203, 143)}[segment.way_id])
                    )
                )
            if segment.way_id == 23:
                assert (segment.a < segment.b) == (version == "town_v2")
    route = shortest(graph, [130], [131])[130, 131]
    assert {s.way_id for s in route.segments} == {53}
    if version != "town_v2_split":
        winner = graph.winning_edges[130, 131]
        assert [s.seq for s in winner.segments] == [0, 1]
        assert graph.matrix[graph.indices[130], graph.indices[131]] == winner.seconds
        assert winner.seconds < next(
            e.seconds
            for e in graph.edges
            if (e.u, e.v) == (130, 131) and e.segments[0].way_id == 13
        )


@pytest.mark.parametrize("speed", [None, 0, -1, float("inf"), float("nan")])
def test_invalid_speed(tmp_path: Path, speed: float | None) -> None:
    db = tmp_path / "invalid.duckdb"
    with duckdb.connect(str(db), config={"threads": 1, "memory_limit": "256MB"}) as connection:
        connection.execute("CREATE TABLE roads (speed_kph DOUBLE)")
        connection.execute("INSERT INTO roads VALUES (?)", [speed])
    with pytest.raises(ValueError, match="1 roads have NULL, non-positive or non-finite speed_kph"):
        build_graph(db)


def test_fallback_count_and_tie_break(tmp_path: Path) -> None:
    db = tmp_path / "tiny.duckdb"
    with duckdb.connect(str(db), config={"threads": 1, "memory_limit": "256MB"}) as connection:
        connection.execute(
            "CREATE TABLE roads (way_id BIGINT, node_refs BIGINT[], "
            "oneway SMALLINT, speed_kph DOUBLE, maxspeed_raw VARCHAR)"
        )
        connection.execute(
            "CREATE TABLE road_nodes AS SELECT * FROM "
            "(VALUES (1, 0.0, 0.0), (2, 0.0, 1.0), (3, 1.0, 0.0)) t(node_id, lat, lon)"
        )
        connection.executemany(
            "INSERT INTO roads VALUES (?, ?, ?, ?, ?)",
            [
                (20, [1, 2], 0, 36, "signals"),
                (10, [1, 2, 1, 2], 0, 36, "0"),
                (30, [3], 0, 36, "-10"),
                (40, [3], 0, 36, None),
                (50, [3], 0, 36, "36"),
                (60, [3], 0, 36, "25 mph"),
                (70, [3], 0, 36, "25mph"),
            ],
        )
    graph = build_graph(db)
    assert graph.fallback_speed_count == 4
    winner = graph.winning_edges[1, 2]
    assert winner.rank[1:] == (10, 0)
    assert winner.seconds == pytest.approx(11119.50802335329)
    assert winner.segments[0].length_m == pytest.approx(111195.0802335329)
    assert graph.winning_edges[2, 1].rank[1:] == (10, 0)
    assert graph.lscc() == {1, 2}
    assert shortest(graph, [1], [3])[1, 3].segments is None
    with pytest.raises(ValueError, match="batch must be positive"):
        shortest(graph, [1], [2], batch=0)
    with pytest.raises(ValueError, match="not a graph vertex"):
        shortest(graph, [999], [2])
    assert shortest(graph, [], [2]) == {}
    assert shortest(graph, [1], []) == {}


def test_empty_graph(tmp_path: Path) -> None:
    db = tmp_path / "empty.duckdb"
    fixtures = Path(__file__).parent / "fixtures"
    extract(fixtures / "town_v1.osm.pbf", db)
    with duckdb.connect(str(db), config={"threads": 1, "memory_limit": "256MB"}) as connection:
        connection.execute("DELETE FROM roads")
    graph = build_graph(db)
    assert graph.vertices == ()
    assert graph.matrix.shape == (0, 0)
    assert graph.lscc() == set()
    assert shortest(graph, [], []) == {}
