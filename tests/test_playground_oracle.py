"""Python playground oracle (P1b) on hand-made fixtures with hand-derived answers.

Expected values below are worked out by hand from each fixture's graph in
`tests/build_playground_fixtures.py`, not read from `expected.json`.
"""

import gzip
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import pytest
from build_playground_fixtures import FIXTURE_ROOT, TAP, build_all, fixtures, ring_case

from route_impact.cli import main
from route_impact.playground_oracle import (
    Edit,
    OracleError,
    check_incremental,
    check_twins,
    edited_mask,
    evaluate,
    load_export,
    meteor_hits,
    parse_edit,
    path_runs,
    restored_mask,
    route,
    run_case,
    run_stress,
    segment_distances2,
    write_presets,
)

NAMES = [f.name for f in fixtures()]


def load(name: str):
    return load_export(FIXTURE_ROOT / name)


def case(name: str) -> dict:
    return json.loads((FIXTURE_ROOT / name / "case.json").read_text())


def row(
    trip: int,
    distance: int | None,
    added: int | None,
    candidates: list[int],
    singles: list[int],
    runs: list[list[int]] = (),
    *,
    tested_runs: int = 0,
    total_runs: int = 0,
    label: str = "single",
) -> dict:
    return {
        "trip": trip,
        "status": "broken" if distance is None else "slowed",
        "distance_ms": distance,
        "added_ms": added,
        "candidates": candidates,
        "confirmed_singles": singles,
        "confirmed_runs": list(runs),
        "tested_candidates": candidates,
        "unchecked_candidates": [],
        "tested_runs": tested_runs,
        "total_runs": total_runs,
        "label": label,
    }


def summary(ways_hit: int, candidate_trips: int, rows: list[dict]) -> dict:
    return {
        "ways_hit": ways_hit,
        "candidate_trips": candidate_trips,
        "affected_trips": len(rows),
        "broken": sum(r["status"] == "broken" for r in rows),
        "slowed": sum(r["status"] == "slowed" for r in rows),
        "added_ms": sum(r["added_ms"] for r in rows if r["status"] == "slowed"),
        "rows": rows,
    }


HAND = {
    # Stomp 102 (B–C): A→C detours at 150 s (two tied routes), B→C via E at 140 s;
    # D→B uses 102 but its D–A–B detour is only 50 s slower; A→B never used 102.
    "stomp": summary(
        1,
        3,
        [row(0, 150_000, 130_000, [102], [102]), row(1, 140_000, 130_000, [102], [102])],
    ),
    # Flip 201 (A→B→C): A→C falls back to the 150 s road; A→B goes A→C→B (twin) at 160 s.
    "flip": summary(
        1,
        3,
        [row(0, 150_000, 130_000, [201], [201]), row(1, 160_000, 150_000, [201], [201])],
    ),
    # Flip 301 (the 10 s U→V winner): the 140 s parallel 302 is exposed, not a break.
    "parallel_flip": summary(1, 1, [row(0, 140_000, 130_000, [301], [301])]),
    # Meteor hits 401, 402, 405 (vertices a b c d e = 0..4). A→C: 240 s via A–E–B–D–C;
    # restoring 401 gives A–B–D–C at 50 s (recovers), restoring 402 gives A–E–B–C at 210 s
    # (doesn't). B→C detours by 30 s only. Its path 401 402 is also a run, but with a
    # confirmed single, runs are not counted (total_runs == tested_runs == 0).
    "meteor_single": summary(3, 2, [row(0, 240_000, 220_000, [401, 402], [401])]),
    # Meteor hits 501, 502, 504. No single recovers; the run {501, 502} does for both trips.
    # A→E's path is 501 502 | 503 | 504, so {504} is a one-way run and is dropped.
    "meteor_run": summary(
        3,
        3,
        [
            row(
                0,
                300_000,
                280_000,
                [501, 502],
                [],
                [[501, 502]],
                tested_runs=1,
                total_runs=1,
                label="run",
            ),
            row(
                1,
                355_000,
                320_000,
                [501, 502, 504],
                [],
                [[501, 502]],
                tested_runs=1,
                total_runs=1,
                label="run",
            ),
        ],
    ),
    # Compound Stomp 601 + 603, split by the intact 602: each detour adds 130 s, so no single
    # road and no run (each run has one way) recovers A→D. A→C needs only 601.
    "several_together": summary(
        2,
        2,
        [
            row(0, 290_000, 260_000, [601, 603], [], label="several_together"),
            row(1, 150_000, 130_000, [601], [601]),
        ],
    ),
    # Stomp 701: A→B detour is 119,999 ms slower (not slowed); B→A is 120,000 ms (slowed).
    "threshold": summary(1, 2, [row(1, 130_000, 120_000, [701], [701])]),
    # Meteor hits 801, 802. A→C is broken; restoring 802 makes it reachable via A–D–B–C at
    # 310 s (a 290 s delay), which still counts. A→B is slowed 290 s; only restoring 801 recovers it.
    "broken_detour": summary(
        2,
        2,
        [row(0, None, None, [801, 802], [802]), row(1, 300_000, 290_000, [801], [801])],
    ),
    # Hit: 901 (crossing), 902 (exactly r), 904 (last segment). Not: 903 (r + 1e-6), 905.
    "meteor_ring": summary(
        3,
        3,
        [
            row(0, None, None, [901], [901]),
            row(1, None, None, [902], [902]),
            row(3, None, None, [904], [904]),
        ],
    ),
    # Stomp the zero-ms 1001: every detour goes A–E–B (130 s + 0 s); B→B has an empty path.
    "zero_ms": summary(
        1,
        3,
        [
            row(0, 130_000, 130_000, [1001], [1001]),
            row(1, 140_000, 130_000, [1001], [1001]),
            row(3, 140_000, 130_000, [1001], [1001]),
        ],
    ),
    # Compound Flip 1001 (a→b) + 1002 (b→c): a→c falls back to the 300 s a–d–c road.
    # Restoring 1001 alone: b→c is still off. Restoring 1002 alone: a→b is off, and 1002's
    # c→b twin is off again, so neither recovers; the run {1001, 1002} does.
    "flip_pair": summary(
        2,
        1,
        [
            row(
                0,
                300_000,
                280_000,
                [1001, 1002],
                [],
                [[1001, 1002]],
                tested_runs=1,
                total_runs=1,
                label="run",
            )
        ],
    ),
    # Stomp 1201 + 1202: the 50 s path a–b–c–d–e–f has runs {1201, 1202} | 1203 | {1202, 1201},
    # one distinct set. Detour a–k–f is 400 s; restoring 1201 alone gives a–b–g–e–f at 220 s.
    "repeated_run": summary(
        2,
        1,
        [
            row(
                0,
                400_000,
                350_000,
                [1201, 1202],
                [],
                [[1201, 1202]],
                tested_runs=1,
                total_runs=1,
                label="run",
            )
        ],
    ),
}

BASELINES = {
    "stomp": [20_000, 10_000, 10_000, 60_000],
    "flip": [20_000, 10_000, 150_000, 160_000],
    "parallel_flip": [10_000, 50_000],
    "meteor_single": [20_000, 10_000],
    "meteor_run": [20_000, 35_000, 10_000],
    "several_together": [30_000, 20_000],
    "threshold": [10_000, 10_000],
    "broken_detour": [20_000, 10_000],
    "meteor_ring": [10_000] * 5,
    "zero_ms": [0, 10_000, 0, 10_000],
    "flip_pair": [20_000, 300_000],
    "repeated_run": [50_000],
}


def test_every_fixture_has_hand_derived_answers() -> None:
    assert sorted(HAND) == sorted(NAMES) == sorted(p.name for p in FIXTURE_ROOT.iterdir())


@pytest.mark.parametrize("name", NAMES)
def test_baselines_are_hand_derived(name: str) -> None:
    assert load(name).trip_ms.tolist() == BASELINES[name]


@pytest.mark.parametrize("name", NAMES)
def test_oracle_matches_hand_derived_answer(name: str) -> None:
    assert run_case(load(name), case(name)) == HAND[name]


@pytest.mark.parametrize("name", NAMES)
def test_committed_expected_equals_fresh_oracle_run(name: str) -> None:
    expected = json.loads((FIXTURE_ROOT / name / "expected.json").read_text())
    assert expected == run_case(load(name), case(name))


@pytest.mark.parametrize("name", NAMES)
def test_uncapped_invariants(name: str) -> None:
    for r in run_case(load(name), case(name))["rows"]:
        assert r["unchecked_candidates"] == []
        assert r["tested_candidates"] == r["candidates"]
        assert r["tested_runs"] == r["total_runs"]


def test_fixture_builder_is_deterministic_and_committed(tmp_path: Path) -> None:
    build_all(tmp_path)
    for name in NAMES:
        committed = sorted(p.name for p in (FIXTURE_ROOT / name).iterdir())
        assert sorted(p.name for p in (tmp_path / name).iterdir()) == committed
        for file in committed:
            fresh = (tmp_path / name / file).read_bytes()
            assert fresh == (FIXTURE_ROOT / name / file).read_bytes(), (name, file)


def test_fixture_meta_hashes_match_files() -> None:
    for name in NAMES:
        meta = json.loads((FIXTURE_ROOT / name / "meta.json").read_text())
        assert meta["format_version"] == 1
        for entry in meta["files"]:
            if entry["file"] != "meta.json":
                data = (FIXTURE_ROOT / name / entry["file"]).read_bytes()
                assert hashlib.sha256(data).hexdigest() == entry["sha256"]


def test_full_recompute_sees_flip_improvements() -> None:
    # Flip 201 activates C→B and B→A twins: C→A drops to 20 s, B→A (a candidate) to 10 s.
    export = load("flip")
    evaluation = evaluate(export, parse_edit(export, case("flip")))
    assert evaluation.distances.tolist() == [150_000, 160_000, 20_000, 10_000]
    assert evaluation.candidate.tolist() == [True, True, False, True]


def test_flip_twin_parallels_an_existing_edge() -> None:
    # V→U had only 303 at 50 s; the flipped 301 adds a 10 s parallel twin, which wins.
    export = load("parallel_flip")
    evaluation = evaluate(export, parse_edit(export, case("parallel_flip")))
    assert evaluation.distances.tolist() == [140_000, 10_000]


def test_meteor_ring_geometry() -> None:
    export = load("meteor_ring")
    spec, radius = ring_case()
    hits = meteor_hits(export, spec["lat"], spec["lon"], spec["radius_m"])
    assert [int(export.way_osm_id[w]) for w in hits] == [901, 902, 904]
    ways, distance2 = segment_distances2(export, spec["lat"], spec["lon"])
    osm = export.way_osm_id[ways]
    assert distance2[osm == 902].min() == radius * radius  # exactly r counts
    beyond = np.sqrt(distance2[osm == 903].min()) - radius
    assert 0.9e-6 < beyond < 1.1e-6  # r + 1e-6 m does not
    crossing = np.flatnonzero(osm == 901)
    assert len(crossing) == 1 and np.sqrt(distance2[crossing[0]]) < radius
    last_only = distance2[osm == 904]
    assert last_only[0] > radius**2 and last_only[1] <= radius**2
    assert 905 not in osm  # a one-point way has no segments
    assert meteor_hits(export, TAP[0] / 1e6, TAP[1] / 1e6, 0.0) == []


def test_meteor_one_way_hit_still_runs_counterfactuals() -> None:
    export = load("meteor_single")
    edit = parse_edit(export, case("meteor_single"))
    assert edit.counterfactuals and [int(export.way_osm_id[w]) for w in edit.ways] == [
        401,
        402,
        405,
    ]


def test_flip_rejects_two_way_and_unknown_ways() -> None:
    export = load("stomp")
    with pytest.raises(ValueError, match="one-way"):
        parse_edit(export, {"weapon": "flip", "way_id": 101})
    with pytest.raises(ValueError, match="not in the export"):
        parse_edit(export, {"weapon": "stomp", "way_ids": [999]})


def test_cli_case_prints_canonical_output(capsys: pytest.CaptureFixture[str]) -> None:
    case_file = FIXTURE_ROOT / "threshold/case.json"
    assert (
        main(
            [
                "playground-oracle",
                "--data",
                str(FIXTURE_ROOT / "threshold"),
                "--case",
                str(case_file),
            ]
        )
        == 0
    )
    assert json.loads(capsys.readouterr().out) == HAND["threshold"]


def test_cli_stress_writes_outputs(tmp_path: Path) -> None:
    stress = tmp_path / "stress.json"
    stress.write_text(json.dumps({"seed": 1, "cases": [{"id": "x", **case("stomp")}]}))
    out = tmp_path / "out.json"
    args = ["playground-oracle", "--data", str(FIXTURE_ROOT / "stomp"), "--stress", str(stress)]
    assert main([*args, "--output", str(out), "--jobs", "1"]) == 0
    assert json.loads(out.read_text())["outputs"] == {"x": HAND["stomp"]}


def test_cli_write_presets_refinalizes_meta(tmp_path: Path) -> None:
    data = tmp_path / "flip"
    shutil.copytree(FIXTURE_ROOT / "flip", data)
    before = json.loads((data / "meta.json").read_text())
    assert main(["playground-oracle", "--data", str(data), "--write-presets"]) == 0
    meta = json.loads((data / "meta.json").read_text())
    entry = next(e for e in meta["files"] if e["file"] == "presets.json.gz")
    packed = (data / "presets.json.gz").read_bytes()
    assert hashlib.sha256(packed).hexdigest() == entry["sha256"]
    assert meta["files"][-1]["raw_bytes"] == (data / "meta.json").stat().st_size
    assert {k: v for k, v in meta.items() if k not in {"files", "total_shipped_bytes"}} == {
        k: v for k, v in before.items() if k not in {"files", "total_shipped_bytes"}
    }
    presets = json.loads(gzip.decompress(packed))
    # The flip preset is the fixture's own case; drawn = the after-edit paths of its rows.
    flip = presets["flip_201"]
    assert {k: v for k, v in flip.items() if k != "drawn"} == HAND["flip"]
    assert [d["trip"] for d in flip["drawn"]] == [0, 1]
    assert [len(d["edges"]) for d in flip["drawn"]] == [1, 2]  # A→C; A→C→B
    # Deleting 202 and 203 (999 is missing from the export) strands C: C→A and B→A break.
    pair = presets["stomp_pair"]
    assert (pair["ways_hit"], pair["broken"], [r["trip"] for r in pair["rows"]]) == (2, 2, [2, 3])
    assert [r["confirmed_singles"] for r in pair["rows"]] == [[203], [203]]
    assert pair["drawn"] == []


def test_confirmed_single_suppresses_runs() -> None:
    export = load("meteor_single")
    evaluation = evaluate(export, parse_edit(export, case("meteor_single")))
    changed = export.initially_active & ~evaluation.mask
    run = path_runs(export, 0, changed)
    assert [[int(export.way_osm_id[w]) for w in r] for r in run] == [[401, 402]]
    out = run_case(export, case("meteor_single"))["rows"][0]
    assert (out["confirmed_singles"], out["total_runs"], out["tested_runs"]) == ([401], 0, 0)


def test_repeated_run_is_counted_once() -> None:
    export = load("repeated_run")
    changed = export.initially_active & ~edited_mask(
        export, parse_edit(export, case("repeated_run"))
    )
    assert [[int(export.way_osm_id[w]) for w in r] for r in path_runs(export, 0, changed)] == [
        [1201, 1202]
    ]


def test_flip_pair_restoring_one_way_reverts_its_twin() -> None:
    export = load("flip_pair")
    edit = parse_edit(export, case("flip_pair"))
    mask = edited_mask(export, edit)
    for way in edit.ways:
        restored = restored_mask(export, mask, [way])
        edges = export.way_edges([way])
        assert np.array_equal(restored[edges], export.initially_active[edges])  # twin off
        assert route(export, restored, [0]).tolist() == [300_000]
    assert route(export, restored_mask(export, mask, edit.ways), [0]).tolist() == [20_000]
    # The flip activates c→b→a, so the non-candidate c→a gets faster: allowed for Flip only.
    assert evaluate(export, edit).distances.tolist() == [300_000, 20_000]


def test_incremental_check_is_two_sided() -> None:
    baseline = np.array([10.0, 10.0])
    candidate = np.array([True, False])
    stomp, flip = Edit("stomp", (0,)), Edit("flip", (0,))
    check_incremental(stomp, np.array([np.inf, 10.0]), baseline, candidate)
    check_incremental(flip, np.array([5.0, 5.0]), baseline, candidate)
    with pytest.raises(OracleError, match="faster"):
        check_incremental(stomp, np.array([5.0, 10.0]), baseline, candidate)
    with pytest.raises(OracleError, match="Non-candidate"):
        check_incremental(stomp, np.array([10.0, 11.0]), baseline, candidate)
    with pytest.raises(OracleError, match="Non-candidate"):
        check_incremental(flip, np.array([10.0, 11.0]), baseline, candidate)


def test_twin_pairing_is_checked() -> None:
    way, oneway = np.array([0, 0, 1]), np.array([True, False])
    check_twins(way, np.array([True, False, True]), np.array([1, 0, -1]), oneway)
    with pytest.raises(OracleError):
        check_twins(way, np.array([True, False, True]), np.array([1, -1, -1]), oneway)
    with pytest.raises(OracleError):  # an inactive edge on a two-way way
        check_twins(np.array([1, 1]), np.array([True, False]), np.array([1, 0]), oneway)
    with pytest.raises(OracleError):  # a one-way edge without a twin
        check_twins(np.array([0]), np.array([True]), np.array([-1]), oneway)


def test_edit_rejects_duplicates_and_meteor_outside_box() -> None:
    export = load("stomp")
    with pytest.raises(ValueError, match="Duplicate way ids"):
        parse_edit(export, {"weapon": "stomp", "way_ids": [101, 101]})
    with pytest.raises(ValueError, match="lat=40.0, lon=-122.27"):
        parse_edit(export, {"weapon": "meteor", "lat": 40.0, "lon": -122.27, "radius_m": 100})


def test_write_presets_needs_format_1(tmp_path: Path) -> None:
    data = tmp_path / "flip"
    shutil.copytree(FIXTURE_ROOT / "flip", data)
    meta = json.loads((data / "meta.json").read_text())
    (data / "meta.json").write_text(json.dumps({**meta, "format_version": 0}))
    with pytest.raises(OracleError, match="format_version 1"):
        write_presets(data)


def test_stress_rejects_duplicates_and_names_failing_case(tmp_path: Path) -> None:
    data = FIXTURE_ROOT / "stomp"
    same = {"cases": [{"id": "x", **case("stomp")}, {"id": "x", **case("stomp")}]}
    with pytest.raises(ValueError, match="Duplicate stress case ids"):
        run_stress(data, same, jobs=1)
    bad = {"cases": [{"id": "ok", **case("stomp")}, {"id": "bad", "weapon": "stomp", "way_id": 9}]}
    for jobs in (1, 2):
        with pytest.raises(OracleError, match="'bad'"):
            run_stress(data, bad, jobs=jobs)
