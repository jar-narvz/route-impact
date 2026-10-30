"""Build the tiny playground oracle fixtures (PLAN P1b) through the shared format-v1 writer.

Each `tests/fixtures/playground/<case>/` holds a format-v1 export, `case.json` (the edit) and
`expected.json` (the oracle's canonical output). The graphs are hand-made so every expected
answer can be derived by hand; `tests/test_playground_oracle.py` asserts those answers.
Regenerate with `python tests/build_playground_fixtures.py`; the output is deterministic.

Coordinates are integer microdegrees (lat, lon). Meteor fixtures tap (37.8, −122.27): the hit
ways get explicit geometry through the blast, every other vertex sits ≥ 1.7 km east.
"""

import math
import shutil
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from route_impact.playground import (
    FORMAT_VERSION,
    TIE_RULE,
    baseline_csr,
    load_config,
    route_baselines,
    write_export,
    write_json,
)
from route_impact.playground_oracle import load_export, run_case

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = ROOT / "tests/fixtures/playground"
CONFIG = load_config(ROOT / "config/playground.toml")
SCALE = 1_000_000
TAP = (37_800_000, -122_270_000)  # Meteor tap, microdegrees
Point = tuple[int, int]


@dataclass(frozen=True)
class Way:
    osm_id: int
    nodes: list[int]
    ms: list[int]  # one per consecutive node pair
    oneway: bool = False
    geometry: list[Point] | None = None  # default: the nodes' coordinates


@dataclass(frozen=True)
class Fixture:
    name: str
    vertices: int
    ways: list[Way]
    trips: list[tuple[int, int]]
    case: dict[str, Any]
    presets: dict[str, Any] = field(default_factory=dict)


def far_coords(vertices: int) -> list[Point]:
    """Vertex i at (37.80 + i × 0.001, −122.25 + i × 0.0005): east of every Meteor tap."""
    return [(37_800_000 + 1000 * i, -122_250_000 + 500 * i) for i in range(vertices)]


def through_tap(dlat: int) -> list[Point]:
    """An 88 m east–west line `dlat` microdegrees north of the tap."""
    return [(TAP[0] + dlat, TAP[1] - 500), (TAP[0] + dlat, TAP[1] + 500)]


def meteor(radius_m: float, lat: float = TAP[0] / SCALE) -> dict:
    return {"weapon": "meteor", "lat": lat, "lon": TAP[1] / SCALE, "radius_m": radius_m}


def ring_case() -> tuple[dict, float]:
    """Tap so that way 903's vertex is exactly 1e-6 m farther than 902's (which sits at r).

    Uses the oracle's documented formula: y = (lat − lat0) × (R × π / 180).
    """
    k = CONFIG.earth_radius_m * math.pi / 180
    lat0 = TAP[0] / SCALE + 0.5e-6 / k
    radius = (37_800_900 / SCALE - lat0) * k
    beyond = (lat0 - 37_799_100 / SCALE) * k - radius
    if not 0.9e-6 < beyond < 1.1e-6:
        raise AssertionError(f"Ring offset is {beyond} m, not 1e-6 m")
    return meteor(radius, lat0), radius


def two_way_pairs(osm_ids: list[int], geometries: list[list[Point]]) -> list[Way]:
    """Way i joins vertices 2i ↔ 2i+1 at 10 s, with the given geometry."""
    return [
        Way(w, [2 * i, 2 * i + 1], [10_000], geometry=g)
        for i, (w, g) in enumerate(zip(osm_ids, geometries, strict=True))
    ]


def fixtures() -> list[Fixture]:
    ring, _ = ring_case()
    a, b, c, d, e, f, g, h, k = range(9)
    return [
        Fixture(
            "stomp",
            5,
            [
                Way(101, [a, b], [10_000]),
                Way(102, [b, c], [10_000]),
                Way(103, [a, d, c], [100_000, 50_000]),
                Way(104, [b, e, c], [70_000, 70_000]),
            ],
            [(a, c), (b, c), (a, b), (d, b)],
            {"weapon": "stomp", "way_ids": [102]},
        ),
        Fixture(
            "flip",
            4,
            [
                Way(201, [a, b, c], [10_000, 10_000], oneway=True),
                Way(202, [a, d, c], [100_000, 100_000]),
                Way(203, [a, c], [150_000]),
            ],
            [(a, c), (a, b), (c, a), (b, a)],
            {"weapon": "flip", "way_id": 201},
            presets={
                "flip_201": {"type": "flip_oneway", "target": "way_id", "ids": [201]},
                "stomp_pair": {
                    "type": "delete_way",
                    "target": "way_id",
                    "ids": [202, 203, 999],
                    "missing_way_ids": [999],
                },
            },
        ),
        Fixture(
            "parallel_flip",
            2,
            [
                Way(301, [a, b], [10_000], oneway=True),
                Way(302, [a, b], [140_000], oneway=True),
                Way(303, [b, a], [50_000], oneway=True),
            ],
            [(a, b), (b, a)],
            {"weapon": "flip", "way_id": 301},
        ),
        Fixture(
            "meteor_single",
            7,
            [
                Way(401, [a, b], [10_000], geometry=through_tap(0)),
                Way(402, [b, c], [10_000], geometry=through_tap(200)),
                Way(403, [b, d, c], [20_000, 20_000]),
                Way(404, [a, e, b], [100_000, 100_000]),
                Way(405, [f, g], [10_000], geometry=through_tap(-200)),
            ],
            [(a, c), (b, c)],
            meteor(100.0),
        ),
        Fixture(
            "meteor_run",
            9,
            [
                Way(501, [a, b], [10_000], geometry=through_tap(0)),
                Way(502, [b, c], [10_000], geometry=through_tap(200)),
                Way(503, [c, d], [5_000]),
                Way(504, [d, e], [10_000], geometry=through_tap(-200)),
                Way(505, [a, g, b], [100_000, 100_000]),
                Way(506, [b, f, c], [100_000, 100_000]),
                Way(507, [a, h, c], [150_000, 150_000]),
                Way(508, [d, k, e], [25_000, 25_000]),
            ],
            [(a, c), (a, e), (d, e)],
            meteor(100.0),
        ),
        Fixture(
            "several_together",
            6,
            [
                Way(601, [a, b], [10_000]),
                Way(602, [b, c], [10_000]),
                Way(603, [c, d], [10_000]),
                Way(604, [a, e, b], [70_000, 70_000]),
                Way(605, [c, f, d], [70_000, 70_000]),
            ],
            [(a, d), (a, c)],
            {"weapon": "stomp", "way_ids": [601, 603]},
        ),
        Fixture(
            "threshold",
            4,
            [
                Way(701, [a, b], [10_000]),
                Way(702, [a, c, b], [60_000, 69_999], oneway=True),
                Way(703, [b, d, a], [65_000, 65_000], oneway=True),
            ],
            [(a, b), (b, a)],
            {"weapon": "stomp", "way_id": 701},
        ),
        Fixture(
            "broken_detour",
            4,
            [
                Way(801, [a, b], [10_000], geometry=through_tap(0)),
                Way(802, [b, c], [10_000], geometry=through_tap(200)),
                Way(803, [a, d, b], [150_000, 150_000]),
            ],
            [(a, c), (a, b)],
            meteor(100.0),
        ),
        Fixture(
            "meteor_ring",
            10,
            two_way_pairs(
                [901, 902, 903, 904, 905],
                [
                    # Crosses the circle ~56 m north; both endpoints ~184 m away.
                    [(37_800_500, -122_272_000), (37_800_500, -122_268_000)],
                    # Nearest point is the vertex exactly r north of the tap.
                    [(37_800_900, TAP[1]), (37_801_500, TAP[1])],
                    # Nearest point is the vertex r + 1e-6 m south of the tap.
                    [(37_799_100, TAP[1]), (37_798_500, TAP[1])],
                    # First segment ~333 m north; only the last one reaches the blast.
                    [
                        (37_803_000, -122_275_000),
                        (37_803_000, -122_265_000),
                        (37_800_200, -122_270_200),
                    ],
                    # A single point on the tap: fewer than 2 points is never hit.
                    [TAP],
                ],
            ),
            [(2 * i, 2 * i + 1) for i in range(5)],
            ring,
        ),
        Fixture(
            "zero_ms",
            5,
            [
                Way(1001, [a, b], [0]),
                Way(1002, [b, c], [10_000]),
                Way(1003, [a, e, b], [130_000, 0]),
            ],
            [(a, b), (a, c), (b, b), (c, a)],
            {"weapon": "stomp", "way_id": 1001},
        ),
        Fixture(
            "flip_pair",
            4,
            [
                Way(1001, [a, b], [10_000], oneway=True),
                Way(1002, [b, c], [10_000], oneway=True),
                Way(1003, [a, d, c], [150_000, 150_000]),
            ],
            [(a, c), (c, a)],
            {"weapon": "flip", "way_ids": [1001, 1002]},
        ),
        Fixture(
            # Path a–b (1201) b–c (1202) c–d (1203) d–e (1202) e–f (1201): two runs, one set.
            "repeated_run",
            9,
            [
                Way(1201, [a, b, g, e, f], [10_000, 100_000, 100_000, 10_000]),
                Way(1202, [b, c, h, d, e], [10_000, 100_000, 100_000, 10_000]),
                Way(1203, [c, d], [10_000]),
                Way(1204, [a, k, f], [200_000, 200_000]),
            ],
            [(a, f)],
            {"weapon": "stomp", "way_ids": [1201, 1202]},
        ),
    ]


def edge_rows(fixture: Fixture) -> list[tuple[int, int, int, int, int, int]]:
    """(source, target, ms, way index, active, twin) sorted as the exporter sorts them."""
    ways = sorted(fixture.ways, key=lambda w: w.osm_id)
    raw = []  # (source, target, ms, way index, active, twin original id, original id)
    for index, way in enumerate(ways):
        for (u, v), ms in zip(zip(way.nodes, way.nodes[1:]), way.ms, strict=True):
            # A one-way edge gets an inactive reverse twin; a two-way way has both directions.
            forward, reverse = len(raw), len(raw) + 1
            raw.append((u, v, ms, index, 1, reverse if way.oneway else -1, forward))
            raw.append(
                (v, u, ms, index, int(not way.oneway), forward if way.oneway else -1, reverse)
            )
    raw.sort(key=lambda r: (r[0], r[1], r[2], ways[r[3]].osm_id, r[6]))
    remap = {r[6]: i for i, r in enumerate(raw)}
    return [(s, t, ms, w, act, remap[tw] if tw >= 0 else -1) for s, t, ms, w, act, tw, _ in raw]


def geometry(fixture: Fixture) -> tuple[list[int], list[int]]:
    coords = far_coords(fixture.vertices)
    offsets, flat = [0], []
    for way in sorted(fixture.ways, key=lambda w: w.osm_id):
        points = way.geometry if way.geometry is not None else [coords[n] for n in way.nodes]
        flat.extend(c for point in points for c in point)
        offsets.append(len(flat) // 2)
    return offsets, flat


def build_fixture(fixture: Fixture, out: Path) -> None:
    """Write one fixture export, its case.json and the oracle's expected.json into `out`."""
    rows = edge_rows(fixture)
    source, target, ms, way, active, twin = (list(column) for column in zip(*rows, strict=True))
    csr = baseline_csr(fixture.vertices, source, target, ms, active)
    origins, destinations = zip(*fixture.trips, strict=True)
    trip_ms, paths = route_baselines(csr, origins, destinations)
    ways = sorted(fixture.ways, key=lambda w: w.osm_id)
    geometry_offsets, geometry_coords = geometry(fixture)
    arrays = {
        "csr_offsets": (
            "<u4",
            np.r_[0, np.cumsum(np.bincount(source, minlength=fixture.vertices))],
        ),
        "edge_target": ("<u4", target),
        "edge_ms": ("<u4", ms),
        "edge_way": ("<u4", way),
        "edge_initially_active": ("u1", active),
        "edge_twin": ("<i4", twin),
        "way_osm_id": ("<f8", [w.osm_id for w in ways]),
        "way_oneway": ("u1", [w.oneway for w in ways]),
        "way_highway": ("u1", [0] * len(ways)),
        "geometry_offsets": ("<u4", geometry_offsets),
        "geometry_coords": ("<i4", geometry_coords),
        "trip_origin": ("<u4", origins),
        "trip_destination": ("<u4", destinations),
        "trip_ms": ("<f8", trip_ms),
        "trip_weight": ("<f8", [1.0] * len(fixture.trips)),
        "trip_path_offsets": ("<u4", np.r_[0, np.cumsum([len(p) for p in paths])]),
        "trip_path_edges": ("<u4", [e for p in paths for e in p]),
    }
    exported = {w.osm_id for w in ways}
    presets = {
        name: {**p, "missing_way_ids": [w for w in p["ids"] if w not in exported]}
        for name, p in fixture.presets.items()
    }
    meta = {
        "format_version": FORMAT_VERSION,
        "byte_order": "little",
        "snapshot": f"fixture-{fixture.name}",
        "counts": {
            "vertices": fixture.vertices,
            "edges": len(rows),
            "ways": len(ways),
            "trips": len(fixture.trips),
            "initially_active_edges": sum(active),
            "excluded_trips": 0,
        },
        "box": {
            "min_lat": CONFIG.box.min_lat,
            "max_lat": CONFIG.box.max_lat,
            "min_lon": CONFIG.box.min_lon,
            "max_lon": CONFIG.box.max_lon,
        },
        "projection_lat": CONFIG.projection_lat,
        "metres_per_degree": CONFIG.metres_per_degree,
        "earth_radius_m": CONFIG.earth_radius_m,
        "simplification_tolerance_m": 0,
        "geometry_coordinate_order": "lat,lon",
        "geometry_scale": SCALE,
        "geometry_scope": "hand-made fixture polylines (unsimplified)",
        "slow_seconds": tomllib.loads((ROOT / "config/thresholds.toml").read_text())[
            "slow_seconds"
        ],
        "presets": presets,
        "highway_classes": ["residential"],
        "baseline_tie_rule": TIE_RULE,
        "cch_order": {
            "method": "identity",
            "file": "cch_order.bin.gz",
            "manifest_file": "order_manifest.json.gz",
        },
        "local_files": [],
        "arrays": [],
        "files": [],
    }
    manifest = {
        "method": "identity",
        "orientation": "order[rank] = vertex; rank = inverse permutation",
        "nodes": fixture.vertices,
    }
    if out.exists():
        shutil.rmtree(out)
    write_export(
        out,
        arrays,
        {
            "order_manifest": manifest,
            "excluded_trips": [],
            "way_names": [f"Way {w.osm_id}" for w in ways],
            "trip_labels": [{"trip_id": i, "kind": "local"} for i in range(len(fixture.trips))],
        },
        meta,
        blobs={"cch_order.bin.gz": np.arange(fixture.vertices, dtype="<u4").tobytes()},
        json_arrays=("way_names", "trip_labels"),
    )
    write_json(out / "case.json", fixture.case)
    write_json(out / "expected.json", run_case(load_export(out), fixture.case))


def build_all(root: Path = FIXTURE_ROOT) -> list[str]:
    names = []
    for fixture in fixtures():
        build_fixture(fixture, root / fixture.name)
        names.append(fixture.name)
    return names


if __name__ == "__main__":
    print("\n".join(build_all()))
