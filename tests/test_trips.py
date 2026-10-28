"""Offline fixed-trip rules and fixture generation checks."""

import csv
import math
from pathlib import Path

import duckdb
import pytest

from route_impact.cli import main
from route_impact.extract import extract
from route_impact.graph import build_graph
from route_impact.trips import (
    BOX,
    MIN_POPULATION,
    Trip,
    filter_places,
    generate,
    intercity_trips,
    local_trips,
)

FIXTURE = Path(__file__).parent / "fixtures/berkeley_sample.osm.pbf"


def test_intercity() -> None:
    places = [(3, 38.0, -122.0, 300), (1, 37.0, -123.0, 100), (2, 39.0, -124.0, 200)]
    trips = intercity_trips(places)
    nodes = {p[0]: p[:3] for p in places}
    assert trips == [
        Trip(nodes[1], nodes[2], 20_000),
        Trip(nodes[1], nodes[3], 30_000),
        Trip(nodes[2], nodes[1], 20_000),
        Trip(nodes[2], nodes[3], 60_000),
        Trip(nodes[3], nodes[1], 30_000),
        Trip(nodes[3], nodes[2], 60_000),
    ]


def _distance(trip: Trip) -> float:
    _, lat1, lon1 = trip.origin
    _, lat2, lon2 = trip.destination
    a, b = math.radians(lat1), math.radians(lat2)
    hav = math.sin((b - a) / 2) ** 2 + (
        math.cos(a) * math.cos(b) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371.0088 * math.asin(math.sqrt(hav))


def test_local() -> None:
    nodes = [(i * 10 + j, 37 + i * 0.01, -122 + j * 0.01) for i in range(10) for j in range(10)]
    kwargs = {"count": 50, "min_km": 2.0, "max_km": 5.0}
    trips = local_trips(nodes, seed=2027, **kwargs)
    assert len(trips) == 50
    assert len({(t.origin[0], t.destination[0]) for t in trips}) == 50
    assert all(t.origin[0] != t.destination[0] and t.weight == 1 for t in trips)
    assert all(2.0 <= _distance(t) <= 5.0 for t in trips)
    assert local_trips(list(reversed(nodes)), seed=2027, **kwargs) == trips
    assert local_trips(nodes, seed=2028, **kwargs) != trips


def test_local_impossible() -> None:
    assert local_trips([], seed=1, count=0) == []
    with pytest.raises(ValueError, match="Not enough distinct"):
        local_trips([(1, 37.0, -122.0)], seed=1, count=1)
    with pytest.raises(ValueError, match="after 100 batches"):
        local_trips([(1, 37.0, -122.0), (2, 37.0, -122.0)], seed=1, count=1)
    with pytest.raises(ValueError, match="count must be"):
        local_trips([], seed=1, count=-1)


def test_city_filter() -> None:
    low_lat, high_lat, max_lon = BOX
    places = [
        (8, low_lat, max_lon - 1, MIN_POPULATION),
        (2, high_lat, max_lon - 1, MIN_POPULATION + 1),
        (3, 38.0, -122.0, MIN_POPULATION - 1),
        (4, low_lat - 0.001, -122.0, MIN_POPULATION),
        (5, high_lat + 0.001, -122.0, MIN_POPULATION),
        (6, 38.0, max_lon, MIN_POPULATION),
        (7, 38.0, -122.0, None),
    ]
    assert filter_places(places) == [places[1], places[0]]


def test_generate(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    box = (37.8, 38.0, -122.0)
    kwargs = {
        "seed": 2027,
        "min_population": 1,
        "box": box,
        "local_count": 20,
        "min_km": 0.05,
        "max_km": 3.0,
    }
    first, second = tmp_path / "first.csv", tmp_path / "second.csv"
    generate(FIXTURE, first, **kwargs)
    generate(FIXTURE, second, **kwargs)
    assert first.read_bytes() == second.read_bytes()
    assert b"\r" not in first.read_bytes()
    with first.open(newline="") as source:
        reader = csv.DictReader(source)
        assert reader.fieldnames == [
            "trip_id",
            "kind",
            "o_lat",
            "o_lon",
            "d_lat",
            "d_lon",
            "weight",
        ]
        rows = list(reader)
    db = extract(FIXTURE, tmp_path / "check.duckdb")
    lscc = build_graph(db).lscc()
    with duckdb.connect(str(db), config={"threads": 2, "memory_limit": "2GB"}) as connection:
        places = filter_places(
            connection.execute("SELECT node_id, lat, lon, population FROM places").fetchall(),
            min_population=1,
            box=box,
        )
        endpoints = {
            (f"{lat:.6f}", f"{lon:.6f}")
            for node, lat, lon in connection.execute(
                "SELECT node_id, lat, lon FROM road_nodes"
            ).fetchall()
            if node in lscc and box[0] <= lat <= box[1] and lon < box[2]
        }
    city_trips = intercity_trips(places)
    assert len(city_trips) == 0  # This fixture has no place nodes.
    assert len(rows) == len(city_trips) + 20
    for index, row in enumerate(rows, 1):
        assert row["trip_id"] == f"lo-{index:05d}"
        assert row["kind"] == "local"
        assert row["weight"] == "1"
        assert (row["o_lat"], row["o_lon"]) in endpoints
        assert (row["d_lat"], row["d_lon"]) in endpoints
    summary = capsys.readouterr().out.splitlines()
    assert len(summary) == 2
    assert summary[0] == summary[1]
    assert "seed=2027 n_places=0 intercity=0 local=20 lscc_vertices_in_box=41" in summary[0]


def test_cli_missing_snapshot(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir(tmp_path)
    assert main(["trips", "--snapshot", "latest", "--seed", "2027"]) == 2
    assert capsys.readouterr().out == "Snapshot file not found: data/norcal-latest.osm.pbf\n"
