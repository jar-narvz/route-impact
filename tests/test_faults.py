"""Hand-checked injected edits on the tiny offline town graph."""

import json
import shutil
from dataclasses import asdict
from pathlib import Path
from unittest.mock import Mock

import duckdb
import pytest

from route_impact.cli import main
from route_impact.faults import (
    Baseline,
    Fault,
    apply_faults,
    evaluate_faults,
    fault_batches,
    run_demos,
    sample_faults,
    score_payload,
    snapshot_path,
    top_confirmed,
)
from route_impact.graph import build_graph
from route_impact.impact import read_trips


@pytest.fixture
def baseline(towns):
    return Baseline.load(towns["db"]["town_v1"], towns["rows"])


# T1 follows 50→51→52; T2 travels backwards on 23; T6 enters 43
# backwards. T4 crosses node 122 on way 12, the lowest containing way.
CASES = [
    (Fault("delete_way", way_id=51), "T1", "way_deleted/51"),
    (Fault("delete_bridge", way_id=51), "T1", "way_deleted/51"),
    (Fault("flip_oneway", way_id=23), "T2", "way_changed/23"),
    (Fault("add_oneway", way_id=43), "T6", "way_changed/43"),
    (Fault("disconnect_node", node_id=122), "T4", "node_disconnected/122"),
    (Fault("bad_maxspeed", way_id=51), "T1", "way_changed/51"),
    (Fault("downgrade_class", way_id=51), "T1", "way_changed/51"),
]


@pytest.mark.parametrize("fault,trip_id,expected", CASES, ids=[c[0].type for c in CASES])
def test_fault_type(towns, baseline, thresholds, tmp_path, fault, trip_id, expected):
    db = apply_faults(towns["db"]["town_v1"], [fault], tmp_path / "new.duckdb")
    graph = build_graph(db)
    assert len(graph.vertices) > 0
    payload = baseline.impact(db, towns["rows"], thresholds, "town_v1")
    full = baseline.impact(db, towns["rows"], thresholds, "town_v1", full=True)
    assert payload["trips"] == full["trips"]
    assert [t["trip_id"] for t in payload["trips"]] == [trip_id]
    assert top_confirmed(payload, payload["trips"][0]) == expected == fault.expected_edit
    with duckdb.connect(str(db), config={"threads": 2, "memory_limit": "2GB"}) as connection:
        assert (
            connection.execute("""
            SELECT COUNT(*) FROM roads WHERE content_hash != SHA256(TO_JSON(STRUCT_PACK(
                tags := LIST_SORT(MAP_ENTRIES(tags)), node_refs := node_refs)))
        """).fetchone()[0]
            == 0
        )
        if fault.type == "bad_maxspeed":
            assert connection.execute(
                "SELECT maxspeed_raw, speed_kph, tags['maxspeed'] FROM roads WHERE way_id=51"
            ).fetchone() == ("5 mph", 5 * 1.609344, "5 mph")
        if fault.type == "downgrade_class":
            assert connection.execute(
                "SELECT highway, maxspeed_raw, tags['maxspeed'], speed_kph FROM roads WHERE way_id=51"
            ).fetchone() == ("residential", None, None, 25 * 1.609344)
        if fault.type == "disconnect_node":
            assert connection.execute("SELECT node_refs FROM roads WHERE way_id=12").fetchone()[
                0
            ] == [120, 121, 803, 123, 124]
            assert (
                connection.execute("SELECT lat, lon FROM road_nodes WHERE node_id=803").fetchone()
                == connection.execute(
                    "SELECT lat, lon FROM road_nodes WHERE node_id=122"
                ).fetchone()
            )


def test_mini_suite(towns, baseline, thresholds, tmp_path, monkeypatch):
    from route_impact import faults, impact

    build = Mock(wraps=faults.build_graph)
    explain = Mock(wraps=impact.explain_trips)
    monkeypatch.setattr(faults, "build_graph", build)
    monkeypatch.setattr(impact, "build_graph", build)
    monkeypatch.setattr(impact, "explain_trips", explain)
    scores = evaluate_faults(
        towns["db"]["town_v1"],
        baseline,
        towns["rows"],
        thresholds,
        [c[0] for c in CASES],
        tmp_path,
        "town_v1",
        full_check_every=1,
    )
    assert scores["incremental_equals_full"]["percent"] == 100
    assert scores["incremental_equals_full"]["denominator"] == 11
    assert build.call_count == 11
    assert explain.call_count == 11
    assert scores["root_cause_single"] == {"correct": 7, "denominator": 7, "percent": 100}
    assert scores["impact_rate"]["correct"] == scores["impact_rate"]["denominator"] == 7
    assert json.loads((tmp_path / "scores.json").read_text()) == scores


def test_slowdown_run_batch(towns, baseline, thresholds, tmp_path):
    faults = [Fault("bad_maxspeed", way_id=w) for w in (50, 51)]
    for index, fault in enumerate(faults):
        db = apply_faults(towns["db"]["town_v1"], [fault], tmp_path / f"single{index}.duckdb")
        trip = baseline.impact(db, towns["rows"], thresholds, "town_v1")["trips"][0]
        assert trip["trip_id"] == "T1"
        assert trip["delay_s"] > thresholds.slow_seconds
    db = apply_faults(towns["db"]["town_v1"], faults, tmp_path / "batch.duckdb")
    payload = baseline.impact(db, towns["rows"], thresholds, "town_v1")
    assert [(t["trip_id"], t["cause"], t["edits"]) for t in payload["trips"]] == [
        (
            "T1",
            "confirmed",
            [
                {
                    "edit": "run/way_changed/50+way_changed/51",
                    "label": "confirmed",
                    "members": ["way_changed/50", "way_changed/51"],
                },
                {"edit": "way_changed/50", "label": "candidate"},
                {"edit": "way_changed/51", "label": "candidate"},
            ],
        )
    ]
    assert score_payload(payload, faults, single=False) == {
        "root_cause_batch": (1, 1),
        "root_cause_joint": (0, 0),
    }
    scores = evaluate_faults(
        towns["db"]["town_v1"],
        baseline,
        towns["rows"],
        thresholds,
        faults,
        tmp_path,
        "town_v1",
        full_check_every=1,
    )
    assert scores["root_cause_joint"] == {"correct": 0, "denominator": 0, "percent": None}
    assert scores["root_cause_batch"] == {"correct": 1, "denominator": 1, "percent": 100}
    assert scores["incremental_equals_full"] == {"correct": 3, "denominator": 3, "percent": 100}


@pytest.mark.parametrize(
    "fault",
    [
        Fault("delete_bridge", way_id=10),
        Fault("flip_oneway", way_id=10),
        Fault("add_oneway", way_id=23),
        Fault("disconnect_node", node_id=401),
        Fault("delete_way", way_id=99999),
    ],
)
def test_refusals(towns, tmp_path, fault):
    with pytest.raises(ValueError, match="Ineligible"):
        apply_faults(towns["db"]["town_v1"], [fault], tmp_path / "bad.duckdb")


def test_cli_what_if(capsys, tmp_path):
    # Only T1 uses the bridge 51; the other eight OLD paths stay elsewhere.
    assert (
        main(
            [
                "what-if",
                "--data-dir",
                "tests/fixtures",
                "--snapshot",
                "town_v1",
                "--trips",
                "tests/fixtures/town_trips.csv",
                "--delete-way",
                "51",
                "--out",
                str(tmp_path),
            ]
        )
        == 0
    )
    lines = capsys.readouterr().out.splitlines()
    assert [line for line in lines if line.startswith("Trip ")] == []
    # Default slow_seconds=120 exceeds this bridge's 91.73-second detour.
    assert "Affected: 0 intercity · 0 local trips · 0% weighted travel" in lines
    payload = json.loads((tmp_path / "impact.json").read_text())
    assert payload["old"] == "town_v1"
    assert payload["new"] == "town_v1+what-if"
    geojson = json.loads((tmp_path / "impact.geojson").read_text())
    assert geojson["snapshots"] == {"old": "town_v1", "new": "town_v1+what-if"}
    assert (tmp_path / "report.md").is_file()


def test_cli_fixture_thresholds(capsys, tmp_path):
    thresholds = tmp_path / "thresholds.toml"
    thresholds.write_text(
        Path("config/thresholds.toml")
        .read_text()
        .replace("slow_seconds = 120", "slow_seconds = 10")
    )
    assert (
        main(
            [
                "what-if",
                "--data-dir",
                "tests/fixtures",
                "--snapshot",
                "town_v1",
                "--trips",
                "tests/fixtures/town_trips.csv",
                "--thresholds",
                str(thresholds),
                "--out",
                str(tmp_path / "report"),
                "--delete-way",
                "51",
            ]
        )
        == 0
    )
    lines = capsys.readouterr().out.splitlines()
    assert [line for line in lines if line.startswith("Trip ")] == ["Trip T1: slowed"]
    assert lines[-2] == "Worst: T1 (intercity)  +1.2 min"
    assert lines[-1] == "Root cause: way 51 ✔ (matches injected fault)"
    saved = json.loads((tmp_path / "report/impact.json").read_text())
    assert len(saved["trips"]) == 1
    assert saved["trips"][0]["changed_segment_count"] == 1
    assert not {"old_path", "new_path", "changed_segments"} & saved["trips"][0].keys()
    geojson = json.loads((tmp_path / "report/impact.geojson").read_text())
    assert [f["properties"]["role"] for f in geojson["features"]] == [
        "old_path",
        "new_path",
        "culprit",
    ]
    assert geojson["snapshots"] == {"old": "town_v1", "new": "town_v1+what-if"}


def test_deterministic_sampling(towns, baseline, tmp_path):
    first = sample_faults(towns["db"]["town_v1"], baseline, 7, 2027)
    second = sample_faults(towns["db"]["town_v1"], baseline, 7, 2027)
    for name, faults in (("first", first), ("second", second)):
        (tmp_path / name).write_text(
            json.dumps(
                {"N": 7, "seed": 2027, "faults": [asdict(f) for f in faults]}, sort_keys=True
            )
        )
    assert (tmp_path / "first").read_bytes() == (tmp_path / "second").read_bytes()
    assert len({(f.node_id, f.way_id) for f in first}) == 7
    assert {f.type for f in first} == {case[0].type for case in CASES}
    batches = fault_batches(first, baseline.ways)
    assert [f for batch in batches for f in batch] == first
    for batch in batches:
        assert len(batch) <= 10
    with pytest.raises(ValueError, match="distinct eligible"):
        sample_faults(towns["db"]["town_v1"], baseline, 200, 2027)


@pytest.mark.parametrize("arguments", [[], ["--delete-way", "999999"], ["--flip-oneway", "10"]])
def test_cli_errors(arguments, capsys):
    assert (
        main(
            [
                "what-if",
                "--snapshot",
                "town_v1",
                "--data-dir",
                "tests/fixtures",
                "--trips",
                "tests/fixtures/town_trips.csv",
                *arguments,
            ]
        )
        == 2
    )
    assert capsys.readouterr().err.startswith("what-if:")


def test_snapshot_resolution():
    assert snapshot_path("261027", Path("data")) == Path("data/norcal-261027.osm.pbf")
    assert snapshot_path("town_v1", Path("tests/fixtures")) == Path(
        "tests/fixtures/town_v1.osm.pbf"
    )
    with pytest.raises(ValueError):
        snapshot_path("../town_v1", Path("data"))


def test_trip_csv_matches_expected(towns):
    actual = read_trips(Path("tests/fixtures/town_trips.csv"))
    assert [t["trip_id"] for t in actual] == [f"T{i}" for i in range(1, 10)]
    for row, expected in zip(actual, towns["rows"], strict=True):
        assert row["kind"] == "intercity"
        assert row["weight"] == "1"
        for key in ("o_lat", "o_lon", "d_lat", "d_lon"):
            assert float(row[key]) == expected[key]


def test_seeded_suite_files(tmp_path):
    from route_impact.faults import run_suite

    for name in ("first", "second"):
        run_suite(
            "town_v1",
            n=7,
            seed=2027,
            full_check_every=1,
            data_dir=Path("tests/fixtures"),
            trips_path=Path("tests/fixtures/town_trips.csv"),
            results_dir=tmp_path / name,
        )
    relative = Path("faults/town_v1/faults.json")
    assert (tmp_path / "first" / relative).read_bytes() == (
        tmp_path / "second" / relative
    ).read_bytes()
    recorded = json.loads((tmp_path / "first" / relative).read_text())
    scores = json.loads((tmp_path / "first/faults/town_v1/scores.json").read_text())
    seconds = scores["seconds"]
    assert set(seconds) == {"extract", "baseline", "runs", "mean_single", "mean_batch"}
    assert seconds["extract"] > 0
    assert seconds["baseline"] > 0
    assert len(seconds["runs"]) == len(scores["runs"])
    for timing in seconds["runs"]:
        assert set(timing) == {
            "apply",
            "new_graph",
            "compare_incremental",
            "compare_full",
            "root_cause",
            "total",
        }
        assert all(isinstance(value, float) and value >= 0 for value in timing.values())
        assert timing["total"] >= sum(value for key, value in timing.items() if key != "total")
    for single, field in ((True, "mean_single"), (False, "mean_batch")):
        totals = [
            t["total"]
            for r, t in zip(scores["runs"], seconds["runs"], strict=True)
            if r["single"] == single
        ]
        assert seconds[field] == sum(totals) / len(totals)
    assert recorded["N"] == 7
    assert recorded["seed"] == 2027
    assert len(recorded["faults"]) == 7
    assert {fault["type"] for fault in recorded["faults"]} == {case[0].type for case in CASES}


@pytest.mark.parametrize("way,tag,oneway", [(23, "yes", 1), (40, "-1", -1)])
def test_flip_reverse_and_implied(towns, tmp_path, way, tag, oneway):
    db = apply_faults(
        towns["db"]["town_v1"], [Fault("flip_oneway", way_id=way)], tmp_path / "flip.duckdb"
    )
    with duckdb.connect(str(db), config={"threads": 2, "memory_limit": "2GB"}) as connection:
        assert connection.execute(
            "SELECT tags['oneway'], oneway FROM roads WHERE way_id=?", [way]
        ).fetchone() == (tag, oneway)


def test_batch_top_is_confirmed_for_this_trip():
    # A globally higher ranked culprit only confirmed for another trip must lose.
    payload = {
        "culprits": [{"edit": "way_changed/10"}, {"edit": "way_changed/51"}],
        "trips": [
            {
                "cause": "confirmed",
                "edits": [
                    {"edit": "way_changed/10", "label": "candidate"},
                    {"edit": "way_changed/51", "label": "confirmed"},
                ],
            }
        ],
    }
    assert top_confirmed(payload, payload["trips"][0]) == "way_changed/51"
    assert score_payload(payload, [Fault("bad_maxspeed", way_id=51)], single=False) == {
        "root_cause_batch": (1, 1),
        "root_cause_joint": (0, 0),
    }
    payload["trips"][0]["cause"] = "joint"
    assert score_payload(payload, [Fault("bad_maxspeed", way_id=51)], single=False)[
        "root_cause_joint"
    ] == (0, 1)


def test_repeated_cli_flags(capsys):
    assert (
        main(
            [
                "what-if",
                "--data-dir",
                "tests/fixtures",
                "--snapshot",
                "town_v1",
                "--trips",
                "tests/fixtures/town_trips.csv",
                "--delete-way",
                "50",
                "--delete-way",
                "51",
            ]
        )
        == 0
    )
    lines = capsys.readouterr().out.splitlines()
    assert [line for line in lines if line.startswith("Fault:")] == [
        "Fault: delete way 50 (unnamed, highway=secondary)",
        "Fault: delete way 51 (unnamed, highway=secondary)",
    ]


@pytest.mark.parametrize(
    "kind,speed",
    [
        ("downgrade_class", 25 * 1.609344),
        ("downgrade_class", 10.0),
        ("bad_maxspeed", 5 * 1.609344),
        ("bad_maxspeed", 5.0),
    ],
)
def test_speed_fault_refuses_equal_or_slower(towns, tmp_path, kind, speed):
    source = tmp_path / "source.duckdb"
    shutil.copyfile(towns["db"]["town_v1"], source)
    with duckdb.connect(str(source), config={"threads": 2, "memory_limit": "2GB"}) as connection:
        connection.execute("UPDATE roads SET speed_kph = ? WHERE way_id = 51", [speed])
    with pytest.raises(ValueError, match="Ineligible"):
        apply_faults(source, [Fault(kind, way_id=51)], tmp_path / "refused.duckdb")


def test_equality_detects_unaffected_record_difference(
    towns, baseline, thresholds, tmp_path, monkeypatch
):
    from route_impact import faults

    original = faults.compare_trips

    def wrong_full(*args, **kwargs):
        records, excluded = original(*args, **kwargs)
        unaffected = next(t for t in records if t["status"] == "ok")
        # Smaller than JSON's rounding precision: compare the raw records.
        unaffected["new_seconds"] += 1e-10
        return records, excluded

    monkeypatch.setattr(faults, "compare_trips", wrong_full)
    scores = evaluate_faults(
        towns["db"]["town_v1"],
        baseline,
        towns["rows"],
        thresholds,
        [Fault("delete_way", way_id=51)],
        tmp_path,
        "town_v1",
        full_check_every=1,
    )
    assert scores["incremental_equals_full"] == {
        "correct": 0,
        "denominator": 2,
        "percent": 0,
    }
    assert [run["incremental_equals_full"] for run in scores["runs"]] == [False, False]


def test_run_demos_parses_faults(tmp_path, monkeypatch):
    run = Mock()
    monkeypatch.setattr("route_impact.faults.run_what_if", run)
    run_demos("261027", results_dir=tmp_path)
    assert run.call_args_list == [
        (
            (
                "261027",
                [
                    Fault("delete_way", way_id=w)
                    for w in [
                        8921938,
                        23874736,
                        236348360,
                        236348361,
                        237731428,
                        497579295,
                        661905443,
                        661905446,
                        929579737,
                        1343738800,
                    ]
                ],
            ),
            {"out": tmp_path / "faults/261027/demo-bay_bridge"},
        ),
        (
            ("261027", [Fault("flip_oneway", way_id=6320410)]),
            {"out": tmp_path / "faults/261027/demo-university_ramp"},
        ),
        (
            ("261027", [Fault("disconnect_node", node_id=35833157)]),
            {"out": tmp_path / "faults/261027/demo-ashby_junction"},
        ),
    ]
    config = tmp_path / "demo.toml"
    config.write_text('[demos.custom]\ntype="delete_way"\ntarget="way_id"\nids=[51]\n')
    run.reset_mock()
    run_demos("town_v1", config=config, results_dir=tmp_path)
    run.assert_called_once_with(
        "town_v1",
        [Fault("delete_way", way_id=51)],
        out=tmp_path / "faults/town_v1/demo-custom",
    )


def test_deleted_run(towns, baseline, thresholds, tmp_path):
    faults = [Fault("delete_way", way_id=w) for w in (50, 51)]
    db = apply_faults(towns["db"]["town_v1"], faults, tmp_path / "deleted.duckdb")
    payload = baseline.impact(db, towns["rows"], thresholds, "town_v1")
    trip = next(t for t in payload["trips"] if t["trip_id"] == "T1")
    key = "run/way_deleted/50+way_deleted/51"
    assert trip["cause"] == "confirmed"
    assert trip["edits"][0] == {
        "edit": key,
        "label": "confirmed",
        "members": ["way_deleted/50", "way_deleted/51"],
    }
    assert payload["culprits"][0]["edit"] == top_confirmed(payload, trip) == key
    assert score_payload(payload, faults, single=False)["root_cause_batch"] == (1, 1)
    assert score_payload(payload, faults[:1], single=False)["root_cause_batch"] == (0, 1)


def test_nonadjacent_slowdowns_joint(towns, baseline, thresholds, tmp_path):
    # T1: 50 → 51 → 52. Leave 51 unchanged to separate the two stretches.
    faults = [Fault("bad_maxspeed", way_id=w) for w in (50, 52)]
    for index, fault in enumerate(faults):
        db = apply_faults(towns["db"]["town_v1"], [fault], tmp_path / f"single-{index}.duckdb")
        trip = baseline.impact(db, towns["rows"], thresholds, "town_v1")["trips"][0]
        assert trip["trip_id"] == "T1"
        assert trip["delay_s"] > thresholds.slow_seconds
    db = apply_faults(towns["db"]["town_v1"], faults, tmp_path / "joint.duckdb")
    payload = baseline.impact(db, towns["rows"], thresholds, "town_v1")
    assert [(t["trip_id"], t["cause"]) for t in payload["trips"]] == [("T1", "joint")]
    assert payload["culprits"] == []
    assert score_payload(payload, faults, single=False)["root_cause_joint"] == (1, 1)


def test_cli_run_culprit_output(tmp_path, capsys):
    thresholds = tmp_path / "thresholds.toml"
    thresholds.write_text(
        Path("config/thresholds.toml")
        .read_text()
        .replace("slow_seconds = 120", "slow_seconds = 10")
    )
    assert (
        main(
            [
                "what-if",
                "--snapshot",
                "town_v1",
                "--data-dir",
                "tests/fixtures",
                "--trips",
                "tests/fixtures/town_trips.csv",
                "--thresholds",
                str(thresholds),
                "--delete-way",
                "50",
                "--delete-way",
                "51",
                "--out",
                str(tmp_path / "run"),
            ]
        )
        == 0
    )
    assert capsys.readouterr().out.splitlines()[-1] == (
        "Root cause: run run/way_deleted/50+way_deleted/51 ✔ (matches injected fault)"
    )
    saved = json.loads((tmp_path / "run/impact.json").read_text())
    assert saved["trips"][0]["changed_segment_count"] == 2
    assert not {"old_path", "new_path", "changed_segments"} & saved["trips"][0].keys()


@pytest.mark.parametrize("every,checked", [(1, list(range(11))), (3, [0, 3, 6, 9])])
def test_full_check_schedule(towns, baseline, thresholds, tmp_path, monkeypatch, every, checked):
    from route_impact import faults

    compare = Mock(wraps=faults.compare_trips)
    sync = Mock(wraps=faults.os.fsync)
    monkeypatch.setattr(faults, "compare_trips", compare)
    monkeypatch.setattr(faults.os, "fsync", sync)
    scores = evaluate_faults(
        towns["db"]["town_v1"],
        baseline,
        towns["rows"],
        thresholds,
        [case[0] for case in CASES],
        tmp_path,
        "town_v1",
        full_check_every=every,
    )
    assert scores["full_check_every"] == every
    assert [i for i, run in enumerate(scores["runs"]) if run["full_checked"]] == checked
    assert compare.call_count == len(checked)
    assert sync.call_count == 11
    assert scores["incremental_equals_full"] == {
        "correct": len(checked),
        "denominator": len(checked),
        "percent": 100,
    }
    assert scores["root_cause_single"] == {"correct": 7, "denominator": 7, "percent": 100}
    assert scores["impact_rate"] == {
        "correct": 7,
        "denominator": 7,
        "percent": 100,
        "description": "Network redundancy, not accuracy",
    }
    lines = (tmp_path / "progress.jsonl").read_text().splitlines()
    assert [json.loads(line)["index"] for line in lines] == list(range(11))
    for i, (run, timing, line) in enumerate(
        zip(scores["runs"], scores["seconds"]["runs"], lines, strict=True)
    ):
        record = json.loads(line)
        assert line == json.dumps(record, sort_keys=True, allow_nan=False)
        assert record["equal"] is (True if i in checked else None)
        assert run["incremental_equals_full"] is record["equal"]
        if i not in checked:
            assert timing["compare_full"] == 0.0


def fixture_suite(directory, **kwargs):
    from route_impact.faults import run_suite

    return run_suite(
        "town_v1",
        n=7,
        seed=2027,
        data_dir=Path("tests/fixtures"),
        trips_path=Path("tests/fixtures/town_trips.csv"),
        results_dir=directory,
        **kwargs,
    )


def test_crash_resume(tmp_path, monkeypatch):
    from route_impact import faults

    original = faults.apply_faults
    calls = []

    def crash(db, group, out):
        calls.append(group)
        if len(calls) == 3:
            raise RuntimeError("third run crashed")
        return original(db, group, out)

    monkeypatch.setattr(faults, "apply_faults", crash)
    directory = tmp_path / "resumed/faults/town_v1"
    with pytest.raises(RuntimeError, match="third run crashed"):
        fixture_suite(tmp_path / "resumed", full_check_every=3)
    progress = directory / "progress.jsonl"
    first_lines = progress.read_text().splitlines()
    assert len(first_lines) == 2
    assert [json.loads(line)["index"] for line in first_lines] == [0, 1]
    assert not (directory / "scores.json").exists()
    apply = Mock(wraps=original)
    monkeypatch.setattr(faults, "apply_faults", apply)
    resumed = fixture_suite(tmp_path / "resumed", full_check_every=3)
    assert len(resumed["runs"]) == 8
    assert apply.call_count == 6
    assert [[asdict(f) for f in call.args[1]] for call in apply.call_args_list] == [
        run["faults"] for run in resumed["runs"][2:]
    ]
    assert progress.read_text().splitlines()[:2] == first_lines
    uninterrupted = fixture_suite(tmp_path / "uninterrupted", full_check_every=3)
    assert {k: v for k, v in resumed.items() if k != "seconds"} == {
        k: v for k, v in uninterrupted.items() if k != "seconds"
    }
    # Rebuild scores from the completed log, without applying any faults.
    (directory / "scores.json").unlink()
    apply.reset_mock()
    repeated = fixture_suite(tmp_path / "resumed", full_check_every=3)
    apply.assert_not_called()
    assert repeated == resumed


@pytest.mark.parametrize("field", ["seed", "N", "faults", "full_check_every", "missing"])
def test_resume_manifest_mismatch(tmp_path, monkeypatch, field):
    from route_impact import faults

    fixture_suite(tmp_path)
    path = tmp_path / "faults/town_v1/faults.json"
    manifest = json.loads(path.read_text())
    if field == "missing":
        path.unlink()
    else:
        manifest[field] = list(reversed(manifest[field])) if field == "faults" else -1
        path.write_text(json.dumps(manifest))
    apply = Mock(wraps=faults.apply_faults)
    monkeypatch.setattr(faults, "apply_faults", apply)
    with pytest.raises(ValueError, match="Resume faults.json does not match"):
        fixture_suite(tmp_path)
    apply.assert_not_called()
    scores = fixture_suite(tmp_path, fresh=True, full_check_every=3)
    assert apply.call_count == 8
    assert scores["full_check_every"] == 3
    assert len((path.parent / "progress.jsonl").read_text().splitlines()) == 8


@pytest.mark.parametrize("bad_index", [-1, 8, 0, True])
def test_invalid_progress_index(tmp_path, monkeypatch, bad_index):
    from route_impact import faults

    fixture_suite(tmp_path)
    path = tmp_path / "faults/town_v1/progress.jsonl"
    lines = path.read_text().splitlines()
    record = json.loads(lines[0])
    record["index"] = bad_index
    path.write_text("\n".join(lines + [json.dumps(record)]) + "\n")
    apply = Mock(wraps=faults.apply_faults)
    monkeypatch.setattr(faults, "apply_faults", apply)
    with pytest.raises(ValueError, match="duplicate or out-of-range index"):
        fixture_suite(tmp_path)
    apply.assert_not_called()


@pytest.mark.parametrize("every", [0, -1])
def test_cli_invalid_full_check_every(every, tmp_path, capsys):
    assert (
        main(
            [
                "faults",
                "--snapshot",
                "town_v1",
                "--n",
                "7",
                "--seed",
                "2027",
                "--data-dir",
                "tests/fixtures",
                "--trips",
                "tests/fixtures/town_trips.csv",
                "--results-dir",
                str(tmp_path),
                "--full-check-every",
                str(every),
            ]
        )
        == 2
    )
    assert "full_check_every must be at least 1" in capsys.readouterr().err
    assert not (tmp_path / "faults").exists()


def test_cli_fault_options(tmp_path, monkeypatch):
    suite = Mock()
    monkeypatch.setattr("route_impact.cli.run_suite", suite)
    arguments = [
        "faults",
        "--snapshot",
        "town_v1",
        "--n",
        "7",
        "--seed",
        "2027",
        "--results-dir",
        str(tmp_path),
    ]
    assert main(arguments) == 0
    assert suite.call_args.kwargs["full_check_every"] == 10
    assert suite.call_args.kwargs["fresh"] is False
    assert main([*arguments, "--full-check-every", "3", "--fresh"]) == 0
    assert suite.call_args.kwargs["full_check_every"] == 3
    assert suite.call_args.kwargs["fresh"] is True
    suite.side_effect = ValueError("Resume faults.json does not match")
    assert main(arguments) == 2
