"""Offline counterfactual checks, including compressed junction attachment."""

from math import inf

import pytest
from scipy.sparse import csr_matrix

from route_impact.graph import Edge, Graph, Segment, restored_seconds, route_pairs
from route_impact.impact import compute_impact
from route_impact.rootcause import (
    WayInfo,
    candidate_edits,
    changed_runs,
    explain_trips,
    load_way_info,
)


def graph(runs: list[tuple[int, list[int], list[float]]]) -> Graph:
    edges = [
        Edge(
            nodes[0],
            nodes[-1],
            sum(costs),
            tuple(
                Segment(a, b, way, i, 1, seconds)
                for i, (a, b, seconds) in enumerate(zip(nodes, nodes[1:], costs, strict=False))
            ),
        )
        for way, nodes, costs in runs
    ]
    vertices = tuple(sorted({n for e in edges for n in (e.u, e.v)}))
    indices = {n: i for i, n in enumerate(vertices)}
    winners = {}
    for e in edges:
        if (e.u, e.v) not in winners or e.rank < winners[e.u, e.v].rank:
            winners[e.u, e.v] = e
    matrix = csr_matrix(
        (
            [e.seconds for e in winners.values()],
            ([indices[e.u] for e in winners.values()], [indices[e.v] for e in winners.values()]),
        ),
        shape=(len(vertices), len(vertices)),
    )
    return Graph(vertices, indices, edges, winners, matrix, 0)


def info(g: Graph) -> dict[int, WayInfo]:
    nodes: dict[int, set[int]] = {}
    for edge in g.edges:
        for s in edge.segments:
            nodes.setdefault(s.way_id, set()).update((s.a, s.b))
    return {w: WayInfo(tuple(sorted(ns)), {"highway": "residential"}) for w, ns in nodes.items()}


def record(
    old: Graph, new: Graph, origin: int, destination: int, name: str = "test", weight: int = 1
) -> dict:
    before = route_pairs(old, [(origin, destination)])[origin, destination]
    after = route_pairs(new, [(origin, destination)])[origin, destination]
    costs = {(s.a, s.b): s.seconds for e in new.edges for s in e.segments}
    return {
        "trip_id": name,
        "weight": weight,
        "old_origin": origin,
        "old_destination": destination,
        "new_origin": origin,
        "new_destination": destination,
        "old_seconds": before.seconds,
        "status": "broken" if after.seconds == inf else "slowed",
        "reason": "unreachable" if after.seconds == inf else "slower",
        "old_path": [[s.a, s.b, s.way_id] for s in before.segments],
        "changed_segments": [
            [s.a, s.b, s.way_id] for s in before.segments if costs.get((s.a, s.b), inf) > s.seconds
        ],
    }


def test_town_culprits(towns: dict, thresholds) -> None:
    payload = compute_impact(
        towns["db"]["town_v1"],
        towns["db"]["town_v2"],
        towns["rows"],
        thresholds,
        old_label="v1",
        new_label="v2",
    )
    assert len(payload["trips"]) == 5
    for trip in payload["trips"]:
        culprit = towns["expected"]["trips"][trip["trip_id"]]["culprit"]
        key = (
            f"node_disconnected/{culprit['node']}"
            if "node" in culprit
            else f"{'way_deleted' if culprit['way'] in (51, 55) else 'way_changed'}/{culprit['way']}"
        )
        assert trip["cause"] == "confirmed"
        assert trip["edits"] == [{"edit": key, "label": "confirmed"}]
    assert [s["edit"] for s in payload["culprits"]] == sorted(
        s["edit"] for s in payload["culprits"]
    )
    assert payload["candidates"] == []
    for summary in payload["culprits"]:
        assert summary["weight"] == 1
        assert len(summary["trips"]) == 1
        assert summary["candidate_trips"] == []
        kind = "node" if summary["kind"] == "node_disconnected" else "way"
        assert summary["url"] == f"https://www.openstreetmap.org/{kind}/{summary['id']}"
    node = next(s for s in payload["culprits"] if s["id"] == 122)
    assert node["description"] == "node 122 no longer connects way 12 and way 22"
    assert node["before_nodes"] == node["after_nodes"] == {"12": 5, "22": 5}
    assert node["before_tags"].keys() == node["after_tags"].keys() == {"12", "22"}
    deleted = next(s for s in payload["culprits"] if s["id"] == 55)
    assert deleted["before_nodes"] == 2
    assert deleted["after_nodes"] is deleted["after_tags"] is None


def test_split_names_nothing(towns: dict, thresholds) -> None:
    payload = compute_impact(
        towns["db"]["town_v1"],
        towns["db"]["town_v2_split"],
        towns["rows"],
        thresholds,
        old_label="v1",
        new_label="split",
    )
    assert payload["trips"] == payload["culprits"] == payload["candidates"] == []


def test_mixed_cause(towns: dict) -> None:
    old, new = towns["graphs"]["town_v1"], towns["graphs"]["town_v2"]
    routes = route_pairs(old, [(n, 401) for n in old.vertices])
    origins = [
        n for n in old.vertices if any(s.way_id == 41 for s in (routes[n, 401].segments or ()))
    ]
    assert origins
    row = record(old, new, origins[0], 401)
    before, after = (load_way_info(towns["db"][v]) for v in ("town_v1", "town_v2"))
    culprits, candidates = explain_trips([row], old, new, before, after, 10)
    assert row["cause"] == "confirmed"
    assert row["edits"] == [
        {"edit": "way_deleted/55", "label": "confirmed"},
        {"edit": "way_changed/41", "label": "candidate"},
    ]
    assert [s["edit"] for s in culprits] == ["way_deleted/55"]
    assert [s["edit"] for s in candidates] == ["way_changed/41"]
    assert candidates[0]["candidate_trips"] == ["test"]


def test_midway_attachment() -> None:
    old = graph([(1, [1, 2], [3]), (1, [2, 3], [4]), (55, [2, 4], [5]), (56, [4, 5], [1])])
    new = graph([(1, [1, 2, 3], [3, 4]), (56, [4, 5], [1])])
    row = record(old, new, 1, 5)
    culprits, candidates = explain_trips([row], old, new, info(old), info(new), 10)
    assert row["edits"] == [{"edit": "way_deleted/55", "label": "confirmed"}]
    assert row["cause"] == "confirmed"
    assert [s["id"] for s in culprits] == [55]
    assert candidates == []


def test_independent_slowdowns_are_joint() -> None:
    # Each residual slowdown alone meets the threshold, so neither restore recovers.
    old = graph([(1, [1, 2], [1]), (3, [2, 4], [1]), (2, [4, 3], [1])])
    new = graph([(1, [1, 2], [11]), (3, [2, 4], [1]), (2, [4, 3], [11])])
    row = record(old, new, 1, 3)
    culprits, candidates = explain_trips([row], old, new, info(old), info(new), 10)
    assert row["cause"] == "joint"
    assert row["edits"] == [
        {"edit": "way_changed/1", "label": "candidate"},
        {"edit": "way_changed/2", "label": "candidate"},
    ]
    assert culprits == []
    assert [s["weight"] for s in candidates] == [0, 0]


@pytest.mark.parametrize("with_candidate", [False, True])
def test_no_candidate_is_unexplained(with_candidate: bool) -> None:
    old = graph([(1, [1, 2], [1])])
    new = graph([(1, [1, 2], [20])])
    unexplained = {
        **record(old, new, 1, 2, "unexplained"),
        "changed_segments": [],
    }
    rows = [unexplained]
    if with_candidate:
        rows.append(record(old, new, 1, 2))
    culprits, candidates = explain_trips(rows, old, new, info(old), info(new), 10)
    assert unexplained["cause"] == "unexplained"
    assert unexplained["edits"] == []
    assert candidates == []
    assert [s["edit"] for s in culprits] == (["way_changed/1"] if with_candidate else [])


@pytest.mark.parametrize("delay,label", [(9, "confirmed"), (10, "candidate"), (11, "candidate")])
def test_restored_delay_boundary(delay: float, label: str, monkeypatch: pytest.MonkeyPatch) -> None:
    old = graph([(1, [1, 2], [1]), (3, [2, 4], [0]), (2, [4, 3], [1])])
    new = graph([(1, [1, 2], [11]), (3, [2, 4], [0]), (2, [4, 3], [1 + delay])])
    limits = []

    def bounded_restore(*args, limit: float = inf) -> float:
        limits.append(limit)
        return restored_seconds(*args, limit=limit)

    monkeypatch.setattr("route_impact.rootcause.restored_seconds", bounded_restore)
    row = record(old, new, 1, 3)
    culprits, candidates = explain_trips([row], old, new, info(old), info(new), 10)
    assert limits == [12, 12]
    assert row["edits"] == [
        {"edit": "way_changed/1", "label": label},
        {"edit": "way_changed/2", "label": "candidate"},
    ]
    assert row["cause"] == ("confirmed" if label == "confirmed" else "joint")
    assert [s["edit"] for s in culprits] == (["way_changed/1"] if label == "confirmed" else [])
    assert [s["edit"] for s in candidates] == (
        ["way_changed/2"] if label == "confirmed" else ["way_changed/1", "way_changed/2"]
    )


def test_ranking_weight_then_count_then_key() -> None:
    old = graph([(w, [w * 10, w * 10 + 1], [1]) for w in range(1, 5)])
    new = graph([(w, [w * 10, w * 10 + 1], [20]) for w in range(1, 5)])
    rows = [
        record(old, new, w * 10, w * 10 + 1, name, weight)
        for w, name, weight in [(1, "a", 3), (2, "b", 1), (2, "c", 2), (3, "d", 1), (4, "e", 1)]
    ]
    culprits, _ = explain_trips(rows, old, new, info(old), info(new), 10)
    assert [s["edit"] for s in culprits] == [
        "way_changed/2",
        "way_changed/1",
        "way_changed/3",
        "way_changed/4",
    ]
    assert [s["weight"] for s in culprits] == [3, 3, 1, 1]
    assert culprits[0]["trips"] == ["b", "c"]


def test_lost_endpoint() -> None:
    old = graph([(1, [1, 2], [1]), (2, [2, 3], [1])])
    new = graph([(2, [2, 3], [1])])
    row = {
        "trip_id": "lost",
        "weight": 1,
        "old_origin": 1,
        "old_destination": 3,
        "new_origin": None,
        "new_destination": 3,
        "old_seconds": 2,
        "status": "broken",
        "reason": "endpoint_lost",
        "changed_segments": [[1, 2, 1]],
    }
    assert [e.key for e in candidate_edits(row, info(old), info(new))] == [
        "endpoint_lost/1",
        "way_deleted/1",
    ]
    culprits, _ = explain_trips([row], old, new, info(old), info(new), 10)
    assert row["cause"] == "confirmed"
    assert culprits[0]["edit"] == "endpoint_lost/1"
    assert culprits[0]["url"] == "https://www.openstreetmap.org/node/1"


def test_union_minimum_zero_cost_and_unchanged_new() -> None:
    new = graph([(1, [1, 2], [5]), (2, [2, 3], [0])])
    old = graph([(1, [1, 2], [10]), (3, [3, 4], [0])])
    before = new.matrix.copy()
    assert restored_seconds(new, old.edges, {}, 1, 4) == 5
    assert restored_seconds(new, old.edges, {}, 1, 4, limit=5) == 5
    assert restored_seconds(new, old.edges, {}, 1, 4, limit=4) == inf
    assert (new.matrix != before).nnz == 0
    assert new.vertices == (1, 2, 3)
    faster = graph([(1, [1, 2], [2])])
    assert restored_seconds(new, faster.edges, {}, 1, 3) == 2


def test_multiple_attachments_and_reverse_direction() -> None:
    old = graph([(10, [4, 2], [2]), (11, [3, 5], [3])])
    new = graph([(1, [9, 3, 2, 1], [4, 5, 6])])
    touching = {2: new.edges, 3: new.edges}
    assert restored_seconds(new, old.edges, touching, 4, 1) == 8
    assert restored_seconds(new, old.edges, touching, 9, 5) == 7
    assert restored_seconds(new, old.edges, touching, 4, 5) == inf


def test_changed_runs_split_on_unchanged():
    path = [[1, 2, 10], [2, 3, 11], [3, 4, 12], [4, 5, 13]]
    assert changed_runs({"old_path": path, "changed_segments": [path[0], path[1], path[3]]}) == [
        [(1, 2, 10), (2, 3, 11)],
        [(4, 5, 13)],
    ]


def test_run_aggregates_and_ranks():
    old = graph([(1, [1, 2], [1]), (2, [2, 3], [1]), (4, [4, 5], [1])])
    new = graph([(1, [1, 2], [11]), (2, [2, 3], [11]), (4, [4, 5], [20])])
    rows = [
        record(old, new, 1, 3, "a", 2),
        record(old, new, 1, 3, "b", 3),
        record(old, new, 4, 5, "c", 1),
    ]
    culprits, _ = explain_trips(rows, old, new, info(old), info(new), 10)
    assert [c["edit"] for c in culprits] == ["run/way_changed/1+way_changed/2", "way_changed/4"]
    assert culprits[0]["trips"] == ["a", "b"]
    assert culprits[0]["weight"] == 5
    assert culprits[0]["kind"] == "run"
    assert culprits[0]["url"] is None
    assert [m["edit"] for m in culprits[0]["members"]] == ["way_changed/1", "way_changed/2"]
