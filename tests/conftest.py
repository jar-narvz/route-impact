"""Shared offline town extraction and impact threshold fixtures."""

import json
from pathlib import Path

import duckdb
import pytest

from route_impact.extract import extract
from route_impact.graph import build_graph
from route_impact.impact import snapshot_nodes
from route_impact.risk import Thresholds


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
