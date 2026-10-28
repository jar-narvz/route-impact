"""Offline extraction checks against the checked-in town and tiny generated inputs."""

import json
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import duckdb
import pytest

from route_impact.extract import extract


@pytest.fixture
def fixtures() -> Path:
    return Path(__file__).parent / "fixtures"


@pytest.fixture
def town_db(tmp_path: Path, fixtures: Path) -> Path:
    return extract(fixtures / "town_v1.osm.pbf", tmp_path / "town.duckdb")


def _read(db: Path, sql: str) -> list[tuple]:
    with duckdb.connect(str(db), read_only=True) as connection:
        return connection.execute(sql).fetchall()


def _pbf(tmp_path: Path, name: str, xml: str) -> Path:
    source = tmp_path / f"{name}.osm"
    source.write_text(xml)
    output = tmp_path / f"{name}.osm.pbf"
    subprocess.run(
        ["osmium", "cat", str(source), "-o", str(output)], check=True, capture_output=True
    )
    return output


def _xml(ways: list[tuple[int, dict[str, str], list[int]]]) -> str:
    root = ET.Element("osm", version="0.6")
    for node_id in (1, 2, 3):
        ET.SubElement(root, "node", id=str(node_id), lat="37.0", lon=str(-122 + node_id / 100))
    for way_id, tags, refs in ways:
        way = ET.SubElement(root, "way", id=str(way_id))
        for ref in refs:
            ET.SubElement(way, "nd", ref=str(ref))
        for key, value in tags.items():
            ET.SubElement(way, "tag", k=key, v=value)
    return ET.tostring(root, encoding="unicode")


def test_town_tables(town_db: Path, fixtures: Path) -> None:
    expected = json.loads((fixtures / "expected.json").read_text())["versions"]["town_v1"]
    kept = [row[0] for row in _read(town_db, "SELECT way_id FROM roads ORDER BY way_id")]
    assert kept == expected["kept_ways"]
    assert set(kept).isdisjoint(expected["excluded_ways"])
    assert _read(town_db, "SELECT COUNT(*) FROM roads") == [(len(expected["kept_ways"]),)]
    assert 63 in kept
    assert set(kept).isdisjoint({60, 61, 62})

    source = ET.parse(fixtures / "town_v1.osm").getroot()
    refs = {
        int(ref.attrib["ref"])
        for way in source.findall("way")
        if int(way.attrib["id"]) in kept
        for ref in way.findall("nd")
    }
    assert _read(town_db, "SELECT COUNT(*) FROM road_nodes") == [(len(refs),)]
    expected_nodes = sorted(
        (int(node.attrib["id"]), float(node.attrib["lat"]), float(node.attrib["lon"]))
        for node in source.findall("node")
        if int(node.attrib["id"]) in refs
    )
    actual_nodes = _read(town_db, "SELECT * FROM road_nodes ORDER BY node_id")
    for actual, expected_node in zip(actual_nodes, expected_nodes, strict=True):
        assert actual[0] == expected_node[0]
        assert actual[1:] == pytest.approx(expected_node[1:], abs=1e-10, rel=0)
    expected_places = []
    for node in source.findall("node"):
        tags = {tag.attrib["k"]: tag.attrib["v"] for tag in node.findall("tag")}
        if tags.get("place") in {"city", "town", "village"}:
            expected_places.append(
                (
                    int(node.attrib["id"]),
                    tags.get("name"),
                    tags["place"],
                    int(tags["population"]) if "population" in tags else None,
                    float(node.attrib["lat"]),
                    float(node.attrib["lon"]),
                )
            )
    assert _read(town_db, "SELECT COUNT(*) FROM places") == [(len(expected_places),)]
    actual_places = _read(town_db, "SELECT * FROM places ORDER BY node_id")
    for actual, expected_place in zip(actual_places, sorted(expected_places), strict=True):
        assert actual[:4] == expected_place[:4]
        assert actual[4:] == pytest.approx(expected_place[4:], abs=1e-10, rel=0)
    assert [row[0] for row in _read(town_db, "DESCRIBE roads")] == [
        "way_id",
        "highway",
        "tags",
        "name",
        "ref",
        "maxspeed_raw",
        "speed_kph",
        "oneway",
        "node_refs",
        "content_hash",
    ]
    for way in source.findall("way"):
        if int(way.attrib["id"]) in kept:
            tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
            node_refs = [int(ref.attrib["ref"]) for ref in way.findall("nd")]
            assert _read(
                town_db, f"SELECT tags, node_refs FROM roads WHERE way_id = {way.attrib['id']}"
            ) == [(tags, node_refs)]


def test_town_direction_and_speed(town_db: Path) -> None:
    values = dict(_read(town_db, "SELECT way_id, oneway FROM roads"))
    assert {way: values[way] for way in [10, 11, 12, 13, 14, 20, 21, 22, 24]} == {
        10: 0,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        20: 0,
        21: 0,
        22: 0,
        24: 0,
    }
    assert {way: values[way] for way in [23, 30, 40]} == {23: -1, 30: 1, 40: 1}
    assert _read(town_db, "SELECT maxspeed_raw, speed_kph FROM roads WHERE way_id = 10") == [
        ("25 mph", 25 * 1.609344)
    ]


def test_missing_node_reference(tmp_path: Path) -> None:
    pbf = _pbf(tmp_path, "missing", _xml([(1, {"highway": "residential"}, [1, 999])]))
    output = tmp_path / "missing.duckdb"
    with pytest.raises(ValueError, match=r"1 missing node references; example ids: \[999\]"):
        extract(pbf, output)
    assert _read(output, "SHOW TABLES") == []


def test_hash_stable(town_db: Path, fixtures: Path, tmp_path: Path) -> None:
    again = extract(fixtures / "town_v1.osm.pbf", tmp_path / "again.duckdb")
    query = "SELECT way_id, content_hash FROM roads ORDER BY way_id"
    assert _read(town_db, query) == _read(again, query)


def test_normalization_rules(tmp_path: Path) -> None:
    tags = [
        {"highway": "motorway"},
        {"highway": "residential", "junction": "circular"},
        {"highway": "motorway", "oneway": "no"},
        {"highway": "motorway", "oneway": "alternating"},
        {"highway": "motorway", "oneway": "reversible"},
        {"highway": "residential", "oneway": "true"},
        {"highway": "residential", "oneway": "1"},
        {"highway": "residential", "maxspeed": "50"},
        {"highway": "residential", "maxspeed": "0"},
        {"highway": "residential", "maxspeed": "-10"},
        {"highway": "residential", "maxspeed": "signals"},
        {"route": "ferry", "motor_vehicle": "yes"},
        {"route": "ferry", "motorcar": "yes", "access": "no"},
        {"route": "ferry"},
        {"route": "ferry", "motor_vehicle": "yes", "motorcar": "no"},
        {"highway": "residential", "access": "no", "vehicle": "yes"},
        {"highway": "residential", "vehicle": "no", "motor_vehicle": "yes"},
        {"highway": "residential", "motor_vehicle": "no", "motorcar": "yes"},
        {"highway": "residential", "motorcar": "private", "motor_vehicle": "yes"},
        {"highway": "residential", "maxspeed": "12.5 mph"},
    ]
    pbf = _pbf(tmp_path, "rules", _xml([(i, tag, [1, 2]) for i, tag in enumerate(tags, 1)]))
    db = extract(
        pbf,
        tmp_path / "rules.duckdb",
        threads=1,
        memory_limit="256MB",
        temp_directory=tmp_path / "spill",
    )
    assert _read(db, "SELECT way_id, oneway, speed_kph FROM roads ORDER BY way_id") == [
        (1, 1, 65 * 1.609344),
        (2, 1, 25 * 1.609344),
        (3, 0, 65 * 1.609344),
        (4, 0, 65 * 1.609344),
        (5, 0, 65 * 1.609344),
        (6, 1, 25 * 1.609344),
        (7, 1, 25 * 1.609344),
        (8, 0, 50.0),
        (9, 0, 25 * 1.609344),
        (10, 0, 25 * 1.609344),
        (11, 0, 25 * 1.609344),
        (12, 0, 10 * 1.609344),
        (13, 0, 10 * 1.609344),
        (16, 0, 25 * 1.609344),
        (17, 0, 25 * 1.609344),
        (18, 0, 25 * 1.609344),
        (20, 0, 12.5 * 1.609344),
    ]


def test_hash_canonical_tags_and_ordered_refs(tmp_path: Path) -> None:
    pbf = _pbf(
        tmp_path,
        "hashes",
        _xml(
            [
                (1, {"highway": "residential", "name": "Street"}, [1, 2, 1]),
                (2, {"name": "Street", "highway": "residential"}, [1, 2, 1]),
                (3, {"name": "Street", "highway": "residential"}, [1, 1, 2]),
                (4, {"name": "Other", "highway": "residential"}, [1, 2, 1]),
            ]
        ),
    )
    db = extract(pbf, tmp_path / "hashes.duckdb")
    hashes = dict(_read(db, "SELECT way_id, content_hash FROM roads"))
    assert hashes[1] == hashes[2]
    assert hashes[1] != hashes[3]
    assert hashes[1] != hashes[4]
    assert _read(db, "SELECT node_refs FROM roads WHERE way_id = 1") == [([1, 2, 1],)]
