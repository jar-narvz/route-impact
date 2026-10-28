#!/usr/bin/env python3
"""Independent stdlib XML routing oracle for docs/FIXTURES.md.

``edges`` counts directed runs between vertices, before parallel reduction;
``reduced_edges`` counts the winning runs used for routing. All fixture ways
must carry valid explicit maxspeed tags, so no production defaults are needed.
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Way:
    refs: list[int]
    tags: dict[str, str]


@dataclass
class Town:
    nodes: dict[int, tuple[float, float]]
    ways: dict[int, Way]


@dataclass
class Graph:
    vertices: set[int]
    edges: list[tuple[int, int, float, int, int]]
    adjacency: dict[int, dict[int, float]]
    kept: list[int]
    excluded: list[int]


def read_town(path: Path) -> Town:
    root = ET.parse(path).getroot()
    for element in root:
        if element.tag in {"node", "way", "relation"} and element.get("version") != "1":
            raise ValueError(f"{path}: {element.tag} {element.get('id')}: version != 1")
    nodes = {
        int(n.attrib["id"]): (float(n.attrib["lat"]), float(n.attrib["lon"]))
        for n in root.findall("node")
    }
    ways = {
        int(w.attrib["id"]): Way(
            [int(n.attrib["ref"]) for n in w.findall("nd")],
            {t.attrib["k"]: t.attrib["v"] for t in w.findall("tag")},
        )
        for w in root.findall("way")
    }
    return Town(nodes, ways)


def drivable(tags: dict[str, str]) -> bool:
    classes = {"motorway", "trunk", "primary", "secondary", "tertiary"}
    highways = (
        classes | {f"{c}_link" for c in classes} | {"unclassified", "residential", "living_street"}
    )
    ferry = tags.get("route") == "ferry" and any(
        tags.get(key) == "yes" for key in ("motorcar", "motor_vehicle")
    )
    access = next(
        (tags[k] for k in ("motorcar", "motor_vehicle", "vehicle", "access") if k in tags),
        "yes",
    )
    return (tags.get("highway") in highways or ferry) and access not in {"no", "private"}


def direction(tags: dict[str, str]) -> int:
    value = tags.get("oneway")
    if value in {"yes", "true", "1"}:
        return 1
    if value == "-1":
        return -1
    if value is not None:
        return 0
    return int(
        tags.get("highway") == "motorway" or tags.get("junction") in {"roundabout", "circular"}
    )


def speed_mps(tags: dict[str, str]) -> float:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(mph)?\s*", tags.get("maxspeed", ""))
    if match is None or float(match[1]) <= 0:
        raise ValueError("Fixture ways require an explicit positive maxspeed")
    return float(match[1]) * (0.44704 if match[2] else 1 / 3.6)


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6_371_008.8 * math.asin(math.sqrt(min(1.0, h)))


def build_graph(town: Town) -> Graph:
    kept = sorted(i for i, w in town.ways.items() if drivable(w.tags))
    occurrences = Counter(n for i in kept for n in town.ways[i].refs)
    vertices = {n for n, count in occurrences.items() if count >= 2}
    for i in kept:
        refs = town.ways[i].refs
        vertices.update((refs[0], refs[-1]))
    edges = []
    for i in kept:
        way = town.ways[i]
        speed = speed_mps(way.tags)
        start, elapsed, first = way.refs[0], 0.0, 0
        for seq, (a, b) in enumerate(zip(way.refs, way.refs[1:])):
            elapsed += distance(town.nodes[a], town.nodes[b]) / speed
            if b in vertices:
                if direction(way.tags) != -1:
                    edges.append((start, b, elapsed, i, first))
                if direction(way.tags) != 1:
                    edges.append((b, start, elapsed, i, seq))
                start, elapsed, first = b, 0.0, seq + 1
    winners = {}
    for a, b, seconds, way_id, seq in edges:
        candidate = (seconds, way_id, seq)
        if (a, b) not in winners or candidate < winners[a, b]:
            winners[a, b] = candidate
    adjacency: dict[int, dict[int, float]] = {n: {} for n in vertices}
    for (a, b), (seconds, _, _) in winners.items():
        adjacency[a][b] = seconds
    return Graph(vertices, edges, adjacency, kept, sorted(set(town.ways) - set(kept)))


def shortest(graph: Graph, source: int, target: int) -> float | None:
    distances = {source: 0.0}
    queue = [(0.0, source)]
    while queue:
        elapsed, node = heapq.heappop(queue)
        if elapsed > distances[node]:
            continue
        if node == target:
            return elapsed
        for neighbor, seconds in graph.adjacency.get(node, {}).items():
            candidate = elapsed + seconds
            if candidate < distances.get(neighbor, math.inf):
                distances[neighbor] = candidate
                heapq.heappush(queue, (candidate, neighbor))
    return None


def isolated(town: Town, edit: str) -> Town:
    result = deepcopy(town)
    if edit == "E1":
        del result.ways[51]
    elif edit == "E2":
        result.ways[23].tags["oneway"] = "yes"
    elif edit == "E3":
        result.nodes[1220] = result.nodes[122]
        result.ways[22].refs = [1220 if n == 122 else n for n in result.ways[22].refs]
    elif edit == "E4":
        result.ways[41].tags["maxspeed"] = "10 mph"
    elif edit == "E5":
        del result.ways[55]
    else:
        raise ValueError(edit)
    return result


def status(old: float | None, new: float | None) -> str:
    if old is None:
        raise ValueError("All named trips must be reachable on v1")
    if new is None:
        return "broken"
    if new > old + 1e-7:
        return "slowed"
    if new < old - 1e-7:
        return "faster"
    return "unchanged"


def compute(fixtures: Path) -> tuple[dict, list[str]]:
    versions = ("town_v1", "town_v2", "town_v2_split")
    towns = {v: read_town(fixtures / f"{v}.osm") for v in versions}
    graphs = {v: build_graph(towns[v]) for v in versions}
    edits = ("E1", "E2", "E3", "E4", "E5")
    alone = {e: build_graph(isolated(towns["town_v1"], e)) for e in edits}
    # Hand-written endpoints, statuses and culprit labels from FIXTURES.md.
    definitions = [
        (101, 123, "slowed", {"edit": "E1", "way": 51}),
        (133, 113, "slowed", {"edit": "E2", "way": 23}),
        (124, 310, "slowed", {"edit": "E4", "way": 41}),
        (120, 142, "slowed", {"edit": "E3", "node": 122}),
        (100, 401, "broken", {"edit": "E5", "way": 55}),
        (320, 310, "unchanged", None),
        (130, 131, "unchanged", None),
        (114, 702, "unchanged", None),
        (140, 144, "unchanged", None),
    ]
    result = {"versions": {}, "trips": {}, "self_compare": {"broken": 0, "slowed": 0}}
    errors = []
    baseline = graphs["town_v1"]
    if any(a < b for a, b, _, way, _ in baseline.edges if way == 23):
        errors.append("town_v1: way 23 has a northbound edge")
    parallel = min(
        (seconds, way, seq) for a, b, seconds, way, seq in baseline.edges if (a, b) == (130, 131)
    )
    if parallel[1] != 53:
        errors.append("town_v1: way 53 is not the faster parallel road")
    for version, graph in graphs.items():
        result["versions"][version] = {
            "vertices": len(graph.vertices),
            "edges": len(graph.edges),
            "reduced_edges": sum(map(len, graph.adjacency.values())),
            "kept_ways": graph.kept,
            "excluded_ways": graph.excluded,
        }
        if graph.excluded != [60, 61, 62]:
            errors.append(f"{version}: excluded ways differ from [60, 61, 62]")
        if not {800, 300, 301} <= graph.vertices:
            errors.append(f"{version}: missing repeated/closed/spur vertices")
        if {500, 501} & set(towns[version].ways[11].refs):
            errors.append(f"{version}: bridge shares nodes with row 1")
    for number, (source, target, expected_status, culprit) in enumerate(definitions, 1):
        name = f"T{number}"
        times = {v: shortest(g, source, target) for v, g in graphs.items()}
        old = times["town_v1"]
        self_status = status(old, shortest(baseline, source, target))
        if self_status in result["self_compare"]:
            result["self_compare"][self_status] += 1
        actual = status(old, times["town_v2"])
        if actual != expected_status:
            errors.append(f"{name}: v2 status {actual}, expected {expected_status}")
        if status(old, times["town_v2_split"]) != "unchanged":
            errors.append(f"{name}: split version changed travel time")
        changed = [
            e for e, g in alone.items() if status(old, shortest(g, source, target)) != "unchanged"
        ]
        expected_edits = [culprit["edit"]] if culprit else []
        if changed != expected_edits:
            errors.append(f"{name}: isolation changed by {changed}, expected {expected_edits}")
        result["trips"][name] = {
            "from": source,
            "to": target,
            "seconds": {v: round(t, 2) if t is not None else None for v, t in times.items()},
            "v2_status": expected_status,
            "culprit": culprit,
        }
    return result, errors


def differences(expected: object, actual: object, path: str = "expected") -> list[str]:
    if isinstance(expected, dict) and isinstance(actual, dict):
        errors = []
        for key in sorted(expected.keys() | actual.keys()):
            if key not in expected or key not in actual:
                errors.append(f"{path}.{key}: missing or unexpected key")
            else:
                errors.extend(differences(expected[key], actual[key], f"{path}.{key}"))
        return errors
    if expected != actual:
        return [f"{path}: stored {expected!r}, recomputed {actual!r}"]
    return []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    fixtures = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
    try:
        result, errors = compute(fixtures)
        path = fixtures / "expected.json"
        if args.write:
            path.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
            print("Wrote tests/fixtures/expected.json")
        else:
            errors.extend(differences(json.loads(path.read_text()), result))
    except (OSError, ValueError, KeyError, ET.ParseError) as exc:
        print(f"ERROR: {exc}")
        return 1
    if errors:
        print("\n".join(errors))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
