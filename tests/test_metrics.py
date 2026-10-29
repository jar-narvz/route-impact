"""Offline benchmark integration and captured platform resource logs."""

import csv
import json
import shutil
from pathlib import Path

import duckdb
import pytest

from route_impact import metrics
from route_impact.metrics import main, parse_time_log, snapshot_date


@pytest.mark.parametrize("status,expected", [("", False), (" M metrics.py", True), (None, None)])
def test_git_metadata(
    status: str | None, expected: bool | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = metrics.command_output

    def command_output(command: list[str]) -> str:
        if command[0] != "git":
            return original(command)
        if status is None:
            raise FileNotFoundError("git")
        if command == ["git", "rev-parse", "HEAD"]:
            return "abc123"
        assert command == ["git", "status", "--porcelain", "--untracked-files=no"]
        return status

    monkeypatch.setattr(metrics, "command_output", command_output)
    result = metrics.environment()
    assert result["git_commit"] == (None if status is None else "abc123")
    assert result["git_dirty"] is expected


@pytest.mark.parametrize(
    "sample,expected",
    [
        (
            (
                "       12.34 real         9.12 user         1.01 sys\n"
                "          12345678  maximum resident set size\n"
            ),
            {"peak_rss_bytes": 12345678, "rss_tool": "time -l", "wall_seconds": 12.34},
        ),
        (
            (
                'Command being timed: "python benchmark"\n'
                "Elapsed (wall clock) time (h:mm:ss or m:ss): 1:02:03.45\n"
                "Maximum resident set size (kbytes): 123456\n"
            ),
            {"peak_rss_bytes": 126418944, "rss_tool": "time -v", "wall_seconds": 3723.45},
        ),
        (
            (
                "Elapsed (wall clock) time (h:mm:ss or m:ss): 2:03.45\n"
                "Maximum resident set size (kbytes): 1\n"
            ),
            {"peak_rss_bytes": 1024, "rss_tool": "time -v", "wall_seconds": 123.45},
        ),
    ],
)
def test_parse_time_log(sample: str, expected: dict) -> None:
    assert parse_time_log(sample) == expected


@pytest.mark.parametrize(
    "text,reason",
    [
        ("", "maximum resident set size"),
        ("123 maximum resident set size\n", "wall clock time"),
        ("Maximum resident set size (kbytes): 123\n", "wall clock time"),
    ],
)
def test_missing_time_fields(text: str, reason: str) -> None:
    with pytest.raises(ValueError, match=reason):
        parse_time_log(text)


def test_add_rss(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out, log = tmp_path / "metrics.json", tmp_path / "time.log"
    out.write_text('{"snapshot": "261027", "peak_rss_bytes": null, "rss_tool": null}')
    log.write_text("1.25 real 0.5 user 0.2 sys\n123 maximum resident set size\n")
    assert main(["add-rss", "--out", str(out), "--log", str(log)]) == 0
    assert json.loads(out.read_text()) == {
        "snapshot": "261027",
        "peak_rss_bytes": 123,
        "rss_tool": "time -l",
        "wall_seconds": 1.25,
    }
    original = out.read_text()
    assert original.endswith("\n")
    log.write_text("invalid")
    assert main(["add-rss", "--out", str(out), "--log", str(log)]) == 2
    assert "maximum resident set size" in capsys.readouterr().err
    assert out.read_text() == original


@pytest.mark.parametrize("value", ["latest", "261332", "26102", "26ab02"])
def test_invalid_date(value: str) -> None:
    with pytest.raises(ValueError):
        snapshot_date(value)


def test_run(tmp_path: Path, request: pytest.FixtureRequest) -> None:
    # Probe the installed extension without INSTALL or network access.
    with duckdb.connect(config={"threads": 2, "memory_limit": "2GB"}) as connection:
        try:
            connection.execute("LOAD spatial")
        except duckdb.Error:
            pytest.skip("DuckDB spatial extension unavailable")
    towns = request.getfixturevalue("towns")
    fixtures = Path(__file__).parent / "fixtures"
    data = tmp_path / "data"
    data.mkdir()
    for date, version in [("261001", "town_v1"), ("261002", "town_v2")]:
        shutil.copyfile(fixtures / f"{version}.osm.pbf", data / f"norcal-{date}.osm.pbf")
    trips = tmp_path / "trips.csv"
    with trips.open("w", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=list(towns["rows"][0]))
        writer.writeheader()
        writer.writerows(towns["rows"])
    out = tmp_path / "metrics.json"
    args = [
        "run",
        "--snapshot",
        "261002",
        "--data-dir",
        str(data),
        "--trips",
        str(trips),
        "--out",
        str(out),
    ]
    assert main(args) == 0
    result = json.loads(out.read_text())
    assert result["old"] == "261001"
    assert result["snapshot"] == "261002"
    assert (
        result["risk_level"],
        result["exit_code"],
        result["broken"],
        result["slowed"],
        result["trips_total"],
    ) == ("HIGH", 1, 1, 0, 9)
    graph = towns["graphs"]["town_v2"]
    assert result["graph_vertices"] == len(graph.vertices)
    assert result["graph_edges"] == len(graph.edges)
    assert result["lscc_vertices"] == len(graph.lscc())
    assert result["input_bytes"] == (fixtures / "town_v2.osm.pbf").stat().st_size
    assert result["input_bytes_old"] == (fixtures / "town_v1.osm.pbf").stat().st_size
    assert result["threads"] == 2
    assert result["memory_limit"] == "2GB"
    assert result["peak_rss_bytes"] is result["rss_tool"] is None
    assert type(result["git_dirty"]) is bool
    seconds = result["seconds"]
    assert set(seconds) == {
        "extract_old",
        "extract_new",
        "graph_old",
        "graph_new",
        "prepare_old",
        "prepare_new",
        "route",
        "diff",
        "root_cause",
        "count",
        "total",
    }
    pipeline_phases = (
        "extract_old",
        "extract_new",
        "graph_old",
        "graph_new",
        "prepare_old",
        "prepare_new",
        "route",
        "root_cause",
    )
    assert all(value >= 0 for value in seconds.values())
    # Count is outside the pipeline total and is excluded from this sum.
    assert seconds["total"] + 1e-9 >= sum(seconds[key] for key in pipeline_phases)
    assert sorted(data.iterdir()) == sorted(data.glob("*.osm.pbf"))
    log = tmp_path / "time.log"
    log.write_text("1.25 real\n123 maximum resident set size\n")
    assert main(["add-rss", "--out", str(out), "--log", str(log)]) == 0
    # The standalone validator checks every required field and its type.
    import runpy

    validator = runpy.run_path(str(Path(__file__).parents[1] / "scripts/check_outputs.py"))
    assert validator["validate_metrics"](json.loads(out.read_text())) == []
    assert main([*args, "--old", "261003"]) == 2
