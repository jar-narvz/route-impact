"""Offline report and geometry checks using the same town oracle as impact."""

import json
import math
import os
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

import duckdb
import pytest

from route_impact.cli import main
from route_impact.impact import compute_impact
from route_impact.report import render_markdown, write_geojson, write_report
from route_impact.risk import Thresholds


@pytest.fixture
def payload(towns: dict, thresholds: Thresholds) -> dict:
    return compute_impact(
        towns["db"]["town_v1"],
        towns["db"]["town_v2"],
        towns["rows"],
        thresholds,
        old_label="261001",
        new_label="261002",
    )


def _dump_geojson(path: Path) -> None:
    """Opt in to a stable local map fixture without writing generated repo files."""
    if directory := os.environ.get("ROUTE_IMPACT_DUMP_DIR"):
        target = Path(directory)
        target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target / "impact.geojson")


def test_fixture_report(towns: dict, payload: dict, tmp_path: Path) -> None:
    write_report(payload, tmp_path, towns["db"]["town_v1"], towns["db"]["town_v2"])
    report = (tmp_path / "report.md").read_text()
    assert payload["risk"]["level"] == "HIGH"
    assert "RISK: HIGH" in report
    assert "2026-10-01 → 2026-10-02" in report
    assert (
        "Map: https://jar-narvz.github.io/route-impact/site/?date=2026-10-02" in report.splitlines()
    )
    assert "| Intercity | 9 | 9 | 1 | 4 | 56% |" in report
    assert "| Local | 0 | 0 | 0 | 0 | — |" in report
    expected = towns["expected"]["trips"].values()
    culprits = {
        (key, t["culprit"][key])
        for t in expected
        if t["culprit"]
        for key in ("way", "node")
        if key in t["culprit"]
    }
    for kind, identifier in culprits:
        assert f"{kind} {identifier}" in report
    affected = [t for t in expected if t["v2_status"] in {"slowed", "broken"}]
    geojson = json.loads((tmp_path / "impact.geojson").read_text())
    assert geojson["type"] == "FeatureCollection"
    assert len(geojson["features"]) == (
        len(affected) + sum(t["seconds"]["town_v2"] is not None for t in affected) + len(culprits)
    )
    fixture_dir = Path(__file__).parent / "fixtures"
    nodes = [
        n.attrib
        for version in ("town_v1", "town_v2")
        for n in ET.parse(fixture_dir / f"{version}.osm").getroot().findall("node")
    ]
    min_lon, max_lon = min(float(n["lon"]) for n in nodes), max(float(n["lon"]) for n in nodes)
    min_lat, max_lat = min(float(n["lat"]) for n in nodes), max(float(n["lat"]) for n in nodes)
    for feature in geojson["features"]:
        geometry = feature["geometry"]
        coords = (
            [geometry["coordinates"]] if geometry["type"] == "Point" else geometry["coordinates"]
        )
        for lon, lat in coords:
            assert math.isfinite(lon) and math.isfinite(lat)
            assert min_lon <= lon <= max_lon
            assert min_lat <= lat <= max_lat
    assert {f["properties"]["role"] for f in geojson["features"]} == {
        "old_path",
        "new_path",
        "culprit",
    }
    assert {
        f["properties"]["id"] for f in geojson["features"] if f["properties"]["role"] == "culprit"
    } == {identifier for _, identifier in culprits}
    _dump_geojson(tmp_path / "impact.geojson")


def test_tag_shapes() -> None:
    payload = {
        "old": "261001",
        "new": "261002",
        "thresholds": {"slow_seconds": 120},
        "risk": {"level": "HIGH", "rule": "HIGH: 1 intercity trip broken"},
        "metrics": {
            "intercity": {"trips_total": 3, "routed": 3, "broken": 1, "slowed": 2},
            "local": {"trips_total": 0, "routed": 0, "broken": 0, "slowed": 0},
            "gravity_share_affected": 1,
        },
    }
    payload["trips"] = [
        {"trip_id": "node-trip", "status": "slowed", "delay_s": 120, "cause": "confirmed"},
        {"trip_id": "joint-trip", "status": "slowed", "delay_s": 60, "cause": "joint"},
        {"trip_id": "unknown-trip", "status": "broken", "delay_s": None, "cause": "unexplained"},
    ]
    payload["culprits"] = [
        {
            "id": 122,
            "kind": "node_disconnected",
            "trips": ["node-trip"],
            "before_tags": {
                "10": {"highway": "primary", "name": "A", "surface": "gravel"},
                "11": {"oneway": "yes"},
            },
            "after_tags": {"10": {"highway": "primary"}, "11": None},
            "url": "https://www.openstreetmap.org/node/122",
        },
        {
            "id": 23,
            "kind": "oneway",
            "trips": ["node-trip"],
            "before_tags": {"oneway": "no"},
            "after_tags": {"oneway": "yes"},
            "url": "https://www.openstreetmap.org/way/23",
        },
        {
            "id": 55,
            "kind": "deleted",
            "trips": ["unknown-trip"],
            "before_tags": {"highway": "primary"},
            "after_tags": None,
            "url": "https://www.openstreetmap.org/way/55",
        },
    ]
    result = render_markdown(payload)
    assert 'node 122 "A" (node_disconnected)' in result
    assert "way 10 before: highway=primary, name=A" in result
    assert "way 11 before: oneway=yes\n    after: —" in result
    assert "before: oneway=no\n    after: oneway=yes" in result
    assert "before: highway=primary\n    after: —" in result
    assert "surface" not in result
    assert "Worst delay: 2 min" in result
    assert "Worst delay: unreachable" in result
    assert "Joint / unexplained: joint-trip, unknown-trip" in result


def test_cli_report(payload: dict, tmp_path: Path) -> None:
    directory = tmp_path / "2026-10-02"
    directory.mkdir()
    source = json.dumps(payload)
    (directory / "impact.json").write_text(source)
    (directory / "impact.geojson").write_bytes(b"preserve map bytes\n")
    (directory / "report.md").write_text("old wording")
    assert main(["report", "--date", "2026-10-02", "--results-dir", str(tmp_path)]) == 0
    assert (directory / "report.md").read_text() == render_markdown(payload)
    assert (directory / "impact.json").read_text() == source
    assert (directory / "impact.geojson").read_bytes() == b"preserve map bytes\n"
    for date in ("2026-10-03", "2026-1-02", "../elsewhere", "2026-02-30"):
        assert main(["report", "--date", date, "--results-dir", str(tmp_path)]) == 2


@pytest.mark.parametrize("empty_old_path", [False, True])
def test_geometry_uses_each_snapshot_and_way_fallback(tmp_path: Path, empty_old_path: bool) -> None:
    databases = []
    for name, longitude, way in (("old", 1, 10), ("new", 10, 20)):
        database = tmp_path / f"{name}.duckdb"
        with duckdb.connect(str(database), config={"threads": 2, "memory_limit": "2GB"}) as c:
            c.execute("CREATE TABLE road_nodes(node_id BIGINT, lat DOUBLE, lon DOUBLE)")
            c.execute(
                "INSERT INTO road_nodes VALUES (1, 2, ?), (2, 3, ?)", [longitude, longitude + 1]
            )
            c.execute("CREATE TABLE roads(way_id BIGINT, node_refs BIGINT[])")
            c.execute("INSERT INTO roads VALUES (?, [1, 2])", [way])
        databases.append(database)
    culprit = {
        "edit": "way:20",
        "kind": "access",
        "id": 20,
        "url": "url",
        "before_tags": None,
        "after_tags": {"access": "no"},
        "trips": ["T"],
    }
    payload = {
        "trips": [
            {
                "trip_id": "T",
                "status": "slowed",
                "delay_s": 120,
                "old_path": [] if empty_old_path else [[1, 2, 10]],
                "new_path": [[2, 1, 20]],
            }
        ],
        "culprits": [culprit],
        "candidates": [{**culprit, "id": 999}],
    }
    out = tmp_path / "map.json"
    assert write_geojson(payload, *databases, out) == (2 if empty_old_path else 3)
    features = json.loads(out.read_text())["features"]
    expected_coordinates = [
        [[1, 2], [2, 3]],
        [[11, 3], [10, 2]],
        [[10, 2], [11, 3]],
    ]
    assert [f["geometry"]["coordinates"] for f in features] == (
        expected_coordinates[1:] if empty_old_path else expected_coordinates
    )
    assert [f["properties"]["role"] for f in features] == (
        ["new_path", "culprit"] if empty_old_path else ["old_path", "new_path", "culprit"]
    )
    assert features[-1]["properties"] == {"role": "culprit", **culprit}
    with duckdb.connect(str(databases[1])) as connection:
        connection.execute("UPDATE roads SET node_refs = [1] WHERE way_id = 20")
    with pytest.raises(ValueError, match="A LineString needs at least two coordinates"):
        write_geojson(payload, *databases, out)
