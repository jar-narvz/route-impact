"""Group path changes and confirm edits by restoring OLD edges into NEW."""

from dataclasses import dataclass
from math import inf, isfinite
from pathlib import Path
from typing import Any

import duckdb

from route_impact.graph import Edge, Graph, restored_seconds


@dataclass(frozen=True)
class WayInfo:
    node_refs: tuple[int, ...]
    tags: dict[str, str]


@dataclass
class Edit:
    kind: str
    id: int
    segments: set[tuple[int, int, int]]

    @property
    def key(self) -> str:
        return f"{self.kind}/{self.id}"


def load_way_info(db: Path, *, threads: int = 2, memory_limit: str = "2GB") -> dict[int, WayInfo]:
    """Keep database access separate from candidate grouping and confirmation."""
    with duckdb.connect(
        str(db), config={"threads": threads, "memory_limit": memory_limit}
    ) as connection:
        return {
            way: WayInfo(tuple(nodes), dict(tags))
            for way, nodes, tags in connection.execute(
                "SELECT way_id, node_refs, tags FROM roads ORDER BY way_id"
            ).fetchall()
        }


def candidate_edits(
    record: dict[str, Any], old: dict[int, WayInfo], new: dict[int, WayInfo]
) -> list[Edit]:
    """Group changed directed segments by deleted way, disconnected node or tags."""
    edits: dict[str, Edit] = {}
    for a, b, way in record["changed_segments"]:
        if way not in new:
            kind, identifier = "way_deleted", way
        else:
            removed = set(old[way].node_refs) - set(new[way].node_refs)
            node = next((n for n in (a, b) if n in removed), None)
            kind, identifier = (
                ("node_disconnected", node) if node is not None else ("way_changed", way)
            )
        edit = edits.setdefault(f"{kind}/{identifier}", Edit(kind, identifier, set()))
        edit.segments.add((a, b, way))
    if record["reason"] == "endpoint_lost":
        for side in ("origin", "destination"):
            if record[f"new_{side}"] is None:
                node = record[f"old_{side}"]
                edits[f"endpoint_lost/{node}"] = Edit("endpoint_lost", node, set())
    return [edits[key] for key in sorted(edits)]


def changed_runs(record: dict[str, Any]) -> list[list[tuple[int, int, int]]]:
    """Split changed OLD segments at every unchanged segment in path order."""
    changed = {tuple(s) for s in record["changed_segments"]}
    runs: list[list[tuple[int, int, int]]] = []
    current: list[tuple[int, int, int]] = []
    for segment in record["old_path"]:
        key = tuple(segment)
        if key in changed:
            current.append(key)
        elif current:
            runs.append(current)
            current = []
    if current:
        runs.append(current)
    return runs


def run_candidates(record: dict[str, Any], edits: list[Edit]) -> dict[str, list[str]]:
    """Associate each contiguous stretch with its distinct trip candidate edits."""
    candidates = {}
    for run in changed_runs(record):
        segments = set(run)
        nodes = {n for a, b, _ in run for n in (a, b)}
        members = sorted(
            edit.key
            for edit in edits
            if edit.segments & segments
            or (edit.kind in {"node_disconnected", "endpoint_lost"} and edit.id in nodes)
        )
        if len(members) >= 2:
            candidates["run/" + "+".join(members)] = members
    return candidates


def restoration_edges(old: Graph, edits: dict[str, Edit]) -> dict[str, list[Edge]]:
    """Index all candidates together: one Python scan, never one scan per check."""
    segments: dict[tuple[int, int, int], set[str]] = {}
    nodes: dict[int, set[str]] = {}
    endpoints: dict[int, set[str]] = {}
    for key, edit in edits.items():
        if edit.kind == "node_disconnected":
            nodes.setdefault(edit.id, set()).add(key)
        elif edit.kind == "endpoint_lost":
            endpoints.setdefault(edit.id, set()).add(key)
        else:
            for segment in edit.segments:
                segments.setdefault(segment, set()).add(key)
    result: dict[str, list[Edge]] = {key: [] for key in edits}
    for edge in old.edges:
        keys = endpoints.get(edge.u, set()) | endpoints.get(edge.v, set())
        for s in edge.segments:
            keys |= segments.get((s.a, s.b, s.way_id), set())
            keys |= nodes.get(s.a, set()) | nodes.get(s.b, set())
        for key in keys:
            result[key].append(edge)
    return result


def edit_details(
    edit: Edit, old: dict[int, WayInfo], new: dict[int, WayInfo], shared: dict[int, list[int]]
) -> dict[str, Any]:
    node_edit = edit.kind in {"node_disconnected", "endpoint_lost"}
    ways = shared[edit.id] if node_edit else [edit.id]
    before = {str(w): old[w].tags for w in ways}
    after = {str(w): new[w].tags if w in new else None for w in ways}
    before_nodes = {str(w): len(old[w].node_refs) for w in ways}
    after_nodes = {str(w): len(new[w].node_refs) if w in new else None for w in ways}
    result = {
        "edit": edit.key,
        "kind": edit.kind,
        "id": edit.id,
        "before_tags": before if node_edit else before[str(edit.id)],
        "after_tags": after if node_edit else after[str(edit.id)],
        "before_nodes": before_nodes if node_edit else before_nodes[str(edit.id)],
        "after_nodes": after_nodes if node_edit else after_nodes[str(edit.id)],
        "url": f"https://www.openstreetmap.org/{'node' if node_edit else 'way'}/{edit.id}",
    }
    if edit.kind == "node_disconnected":
        result["description"] = f"node {edit.id} no longer connects " + " and ".join(
            f"way {w}" for w in ways
        )
    return result


def explain_trips(
    records: list[dict[str, Any]],
    old_graph: Graph,
    new_graph: Graph,
    old: dict[int, WayInfo],
    new: dict[int, WayInfo],
    slow_seconds: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Mutate affected records and return ranked confirmed and candidate edits."""
    grouped = {r["trip_id"]: candidate_edits(r, old, new) for r in records}
    edits: dict[str, Edit] = {}
    for candidates in grouped.values():
        for edit in candidates:
            edits.setdefault(edit.key, Edit(edit.kind, edit.id, set())).segments.update(
                edit.segments
            )
    if not edits:
        for record in records:
            record.update(cause="unexplained", edits=[])
        return [], []
    shared: dict[int, list[int]] = {
        edit.id: []
        for edit in edits.values()
        if edit.kind in {"node_disconnected", "endpoint_lost"}
    }
    if shared:
        for way, details in sorted(old.items()):
            for node in set(details.node_refs) & shared.keys():
                shared[node].append(way)
    restores = restoration_edges(old_graph, edits)
    # Only NEW runs touching a potential attachment need examination per check.
    attachments = {
        n
        for edges in restores.values()
        for e in edges
        for n in (e.u, e.v)
        if n not in new_graph.indices
    }
    touching: dict[int, list[Edge]] = {n: [] for n in attachments}
    if attachments:
        for edge in new_graph.edges:
            for node in {n for s in edge.segments for n in (s.a, s.b)} & attachments:
                touching[node].append(edge)
    summaries = {
        key: {
            **edit_details(edit, old, new, shared),
            "trips": [],
            "candidate_trips": [],
            "weight": 0,
        }
        for key, edit in edits.items()
    }
    for record in records:
        labels = []
        for edit in grouped[record["trip_id"]]:
            origin, destination = record["new_origin"], record["new_destination"]
            if edit.kind == "endpoint_lost":
                if record["old_origin"] == edit.id:
                    origin = edit.id
                if record["old_destination"] == edit.id:
                    destination = edit.id
            limit = record["old_seconds"] + slow_seconds if record["status"] == "slowed" else inf
            seconds = restored_seconds(
                new_graph, restores[edit.key], touching, origin, destination, limit=limit
            )
            recovered = isfinite(seconds) and (
                record["status"] == "broken" or seconds - record["old_seconds"] < slow_seconds
            )
            label = "confirmed" if recovered else "candidate"
            labels.append({"edit": edit.key, "label": label})
            summary = summaries[edit.key]
            summary["trips" if recovered else "candidate_trips"].append(record["trip_id"])
            if recovered:
                summary["weight"] += record["weight"]
        if not any(label["label"] == "confirmed" for label in labels):
            for key, members in run_candidates(record, grouped[record["trip_id"]]).items():
                # Union the already indexed restoration edges; never rescan OLD.
                edges = list({id(edge): edge for m in members for edge in restores[m]}.values())
                origin, destination = record["new_origin"], record["new_destination"]
                for member in members:
                    edit = edits[member]
                    if edit.kind == "endpoint_lost":
                        if record["old_origin"] == edit.id:
                            origin = edit.id
                        if record["old_destination"] == edit.id:
                            destination = edit.id
                limit = (
                    record["old_seconds"] + slow_seconds if record["status"] == "slowed" else inf
                )
                seconds = restored_seconds(
                    new_graph, edges, touching, origin, destination, limit=limit
                )
                recovered = isfinite(seconds) and (
                    record["status"] == "broken" or seconds - record["old_seconds"] < slow_seconds
                )
                if recovered:
                    labels.append({"edit": key, "label": "confirmed", "members": members})
                    summary = summaries.setdefault(
                        key,
                        {
                            "edit": key,
                            "kind": "run",
                            "url": None,
                            "members": [edit_details(edits[m], old, new, shared) for m in members],
                            "trips": [],
                            "candidate_trips": [],
                            "weight": 0,
                        },
                    )
                    summary["trips"].append(record["trip_id"])
                    summary["weight"] += record["weight"]
        record["edits"] = sorted(
            labels, key=lambda item: (item["label"] != "confirmed", item["edit"])
        )
        record["cause"] = (
            "confirmed"
            if any(e["label"] == "confirmed" for e in labels)
            else "joint"
            if labels
            else "unexplained"
        )
    ranked = sorted(summaries.values(), key=lambda s: (-s["weight"], -len(s["trips"]), s["edit"]))
    for summary in ranked:
        summary["trips"].sort()
        summary["candidate_trips"].sort()
    return [s for s in ranked if s["trips"]], [s for s in ranked if not s["trips"]]
