"""Render impact summaries and the small geometry layer used by the static map."""

import json
import os
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import duckdb

# Bound browser geometry while retaining every confirmed culprit.
MAP_MAX_TRIPS = 25


def _date(label: str) -> str:
    if len(label) == 6 and label.isascii() and label.isdigit():
        return datetime.strptime("20" + label, "%Y%m%d").strftime("%Y-%m-%d")
    return _text(label)


def _text(value: object) -> str:
    """Keep OSM text on one Markdown line without introducing HTML or table cells."""
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("|", "&#124;")
        .replace("\n", " ")
        .replace("\r", " ")
    )


def _node_edit(culprit: dict) -> bool:
    return culprit["kind"] in {"node_disconnected", "endpoint_lost"}


def _tags(tags: dict | None) -> str:
    return (
        ", ".join(
            f"{key}={_text(tags[key])}"
            for key in ("highway", "oneway", "maxspeed", "access", "name")
            if tags and key in tags
        )
        or "—"
    )


def render_markdown(payload: dict, geojson_path: Path | None = None) -> str:
    """Render a report using only measurements and edit details in impact.json."""
    metrics = payload["metrics"]
    slow_minutes = payload["thresholds"]["slow_seconds"] / 60
    lines = [
        (
            f"# route-impact · {_date(payload['old'])} → {_date(payload['new'])}"
            f" — RISK: {payload['risk']['level']}"
        ),
        "",
        f"| Trips | Total | Routed | Broken | Slowed ≥{slow_minutes:g} min | Weighted travel affected |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for kind in ("intercity", "local"):
        counts = metrics[kind]
        share = f"{metrics['gravity_share_affected'] * 100:g}%" if kind == "intercity" else "—"
        lines.append(
            f"| {kind.title()} | {counts['trips_total']} | {counts['routed']} |"
            f" {counts['broken']} | {counts['slowed']} | {share} |"
        )
    lines.extend(["", f"Rule that fired: {_text(payload['risk']['rule'])}", "", "## Top culprits"])
    trips = {trip["trip_id"]: trip for trip in payload["trips"]}
    if not payload["culprits"]:
        lines.append("Culprits: none")
    for culprit in payload["culprits"]:
        if culprit["kind"] == "run":
            members = []
            for member in culprit["members"]:
                tags = member["before_tags"]
                tag_sets = tags.values() if _node_edit(member) else [tags]
                names = ", ".join(dict.fromkeys(t["name"] for t in tag_sets if t and t.get("name")))
                members.append(
                    f"{_text(member['kind'])} {member['id']}"
                    + (f' "{_text(names)}"' if names else "")
                    + f" ({member['url']})"
                )
            lines.extend(
                ["", f"- run · Trips affected: {len(culprit['trips'])} · " + "; ".join(members)]
            )
            continue
        node = _node_edit(culprit)
        before, after = culprit["before_tags"], culprit["after_tags"]
        tag_sets = (
            [before, after] if not node else [*(before or {}).values(), *(after or {}).values()]
        )
        names = list(dict.fromkeys(tags["name"] for tags in tag_sets if tags and tags.get("name")))
        name = f' "{_text(", ".join(names))}"' if names else ""
        affected = [trips[trip_id] for trip_id in culprit["trips"]]
        delays = [trip["delay_s"] for trip in affected if trip["delay_s"] is not None]
        worst = (
            "unreachable"
            if any(trip["status"] == "broken" for trip in affected)
            else f"{max(delays) / 60:g} min"
            if delays
            else "—"
        )
        lines.extend(
            [
                "",
                (
                    f"- {'node' if node else 'way'} {culprit['id']}{name} ({_text(culprit['kind'])})"
                    f" · Trips affected: {len(affected)} · Worst delay: {worst}"
                ),
            ]
        )
        if node:
            for way in sorted(set(before or {}) | set(after or {})):
                lines.append(f"  - way {way} before: {_tags((before or {}).get(way))}")
                lines.append(f"    after: {_tags((after or {}).get(way))}")
        else:
            lines.extend([f"  - before: {_tags(before)}", f"    after: {_tags(after)}"])
        lines.append(f"  - {_text(culprit['url'])}")
    unresolved = [_text(t["trip_id"]) for t in payload["trips"] if t["cause"] != "confirmed"]
    label = payload["new"]
    if len(label) == 6 and label.isascii() and label.isdigit():
        map_url = f"https://jar-narvz.github.io/route-impact/site/?date={_date(label)}"
    elif geojson_path is not None:
        site = Path(__file__).resolve().parents[2] / "site"
        source = quote(Path(os.path.relpath(geojson_path.resolve(), site)).as_posix(), safe="/")
        site_link = Path(os.path.relpath(site, geojson_path.resolve().parent)).as_posix()
        map_url = f"{site_link}/?src={source}"
    else:
        map_url = "site/?src=impact.geojson"
    lines.extend(
        [
            "",
            "Joint / unexplained: " + (", ".join(unresolved) or "none"),
            "",
            f"Map: {map_url}",
            "",
        ]
    )
    return "\n".join(lines)


def _connect(path: Path) -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(path), read_only=True, config={"memory_limit": "2GB", "threads": 2})


def _way_nodes(connection: duckdb.DuckDBPyConnection, ids: set[int]) -> dict[int, list[int]]:
    return dict(
        connection.execute(
            "SELECT way_id, node_refs FROM roads WHERE way_id IN (SELECT unnest(?))", [sorted(ids)]
        ).fetchall()
    )


def _coordinates(connection: duckdb.DuckDBPyConnection, ids: set[int]) -> dict[int, list[float]]:
    # One batched coordinate query per snapshot; never scan coordinates into Python.
    return {
        node: [round(lon, 6), round(lat, 6)]
        for node, lat, lon in connection.execute(
            "SELECT node_id, lat, lon FROM road_nodes WHERE node_id IN (SELECT unnest(?))",
            [sorted(ids)],
        ).fetchall()
    }


def write_geojson(payload: dict, old_db: Path, new_db: Path, out: Path) -> int:
    """Write affected routes and confirmed culprits, returning the feature count."""
    paths = []
    needed: dict[str, set[int]] = {"old": set(), "new": set()}
    selected = sorted(
        payload["trips"],
        key=lambda t: (t["status"] != "broken", -t.get("weight", 0), t["trip_id"]),
    )[:MAP_MAX_TRIPS]
    for trip in selected:
        for snapshot in ("old", "new"):
            segments = trip[f"{snapshot}_path"]
            if not segments:
                continue
            nodes = [segments[0][0], *(s[1] for s in segments)]
            needed[snapshot].update(nodes)
            paths.append(
                (
                    snapshot,
                    nodes,
                    {
                        "role": f"{snapshot}_path",
                        **{key: trip[key] for key in ("trip_id", "status", "delay_s")},
                    },
                )
            )
    culprits = [
        {**member, "trips": culprit["trips"]}
        for culprit in payload["culprits"]
        for member in (culprit["members"] if culprit["kind"] == "run" else [culprit])
    ]
    way_ids = {c["id"] for c in culprits if not _node_edit(c)}
    with _connect(old_db) as old, _connect(new_db) as new:
        old_ways = _way_nodes(old, way_ids)
        new_ways = _way_nodes(new, way_ids - old_ways.keys())
        ways = old_ways | new_ways
        for culprit in culprits:
            node = _node_edit(culprit)
            snapshot = "old" if node or culprit["id"] in old_ways else "new"
            nodes = [culprit["id"]] if node else ways[culprit["id"]]
            needed[snapshot].update(nodes)
            paths.append(
                (
                    snapshot,
                    nodes,
                    {
                        "role": "culprit",
                        **{
                            key: culprit[key]
                            for key in (
                                "edit",
                                "kind",
                                "id",
                                "url",
                                "before_tags",
                                "after_tags",
                                "trips",
                            )
                        },
                    },
                )
            )
        coords = {"old": _coordinates(old, needed["old"]), "new": _coordinates(new, needed["new"])}
    features = []
    for snapshot, nodes, properties in paths:
        coordinates = [coords[snapshot][node] for node in nodes]
        point = properties["role"] == "culprit" and _node_edit(properties)
        if not point and len(coordinates) < 2:
            raise ValueError("A LineString needs at least two coordinates")
        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": {
                    "type": "Point" if point else "LineString",
                    "coordinates": coordinates[0] if point else coordinates,
                },
            }
        )
    out.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "snapshots": {"old": payload.get("old"), "new": payload.get("new")},
                "trips_shown": len(selected),
                "trips_total": len(payload["trips"]),
                "features": features,
            },
            allow_nan=False,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    return len(features)


def write_report(payload: dict, out_dir: Path, old_db: Path, new_db: Path) -> None:
    """Write the Markdown summary and map layer while snapshot databases exist."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.md").write_text(
        render_markdown(payload, out_dir / "impact.geojson"), encoding="utf-8"
    )
    write_geojson(payload, old_db, new_db, out_dir / "impact.geojson")
