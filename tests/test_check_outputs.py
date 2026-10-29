"""Exercise the stdlib-only result checker using synthetic and committed results."""

import json
import subprocess
import sys
from pathlib import Path

import pytest


def check(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    script = Path(__file__).parents[1] / "scripts/check_outputs.py"
    return subprocess.run(
        [sys.executable, str(script), str(root), *args], capture_output=True, text=True, check=False
    )


@pytest.fixture
def results(tmp_path: Path) -> Path:
    metrics = {
        **dict.fromkeys(
            [
                "input_bytes",
                "input_bytes_old",
                "drivable_ways",
                "graph_vertices",
                "graph_edges",
                "lscc_vertices",
                "broken",
                "slowed",
                "trips_total",
                "threads",
                "ram_bytes",
                "peak_rss_bytes",
            ],
            1,
        ),
        **dict.fromkeys(
            [
                "duckdb_version",
                "python_version",
                "memory_limit",
                "cpu",
                "os",
                "git_commit",
                "timestamp_utc",
                "snapshot",
                "old",
            ],
            "value",
        ),
        "risk_level": "LOW",
        "exit_code": 0,
        "rss_tool": "time -l",
        "wall_seconds": 1.5,
        "git_dirty": False,
        "seconds": dict.fromkeys(
            [
                "extract_old",
                "extract_new",
                "graph_old",
                "graph_new",
                "prepare_old",
                "prepare_new",
                "count",
                "route",
                "diff",
                "root_cause",
                "total",
            ],
            0.5,
        ),
        "osm_rows_by_kind": {"node": 10, "way": 2, "relation": 0},
    }
    impact = {
        "old": "261026",
        "new": "261027",
        "risk": {"level": "HIGH"},
        "exit_code": 1,
        "metrics": {"trips_total": 9},
    }
    scores = {
        key: {"correct": 1, "denominator": 2, "percent": 50.0}
        for key in (
            "impact_rate",
            "incremental_equals_full",
            "root_cause_single",
            "root_cause_batch",
            "root_cause_joint",
        )
    }
    scores.update(full_check_every=10, runs=[{"single": True}, {"single": False}])
    for relative, payload in [
        ("2026-10-27/metrics.json", metrics),
        ("2026-10-27/impact.json", impact),
        ("faults/261027/scores.json", scores),
    ]:
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload))
    return tmp_path


def test_valid(results: Path) -> None:
    output = check(results, "--expect-impact", "1")
    assert output.returncode == 0, output.stdout
    assert "n = 1" in output.stdout
    assert "Summary: metrics=1 impact=1 scores=1 failures=0" in output.stdout
    assert "WARN dirty tree" not in output.stdout
    assert check(results, "--expect-impact", "4").returncode == 1


def test_dirty_warning(results: Path) -> None:
    path = results / "2026-10-27/metrics.json"
    payload = json.loads(path.read_text())
    payload["git_dirty"] = True
    path.write_text(json.dumps(payload))
    output = check(results)
    assert output.returncode == 0, output.stdout
    assert f"OK {path} WARN dirty tree" in output.stdout.splitlines()


@pytest.mark.parametrize("key", ["count", "prepare_old", "prepare_new"])
def test_missing_phase(results: Path, key: str) -> None:
    path = results / "2026-10-27/metrics.json"
    payload = json.loads(path.read_text())
    del payload["seconds"][key]
    path.write_text(json.dumps(payload))
    output = check(results)
    assert output.returncode == 1
    assert f"{key}: missing field" in output.stdout


@pytest.mark.parametrize(
    "relative,key,value,reason",
    [
        ("2026-10-27/metrics.json", "cpu", None, "cpu: null"),
        ("2026-10-27/metrics.json", "git_dirty", None, "git_dirty: null"),
        ("2026-10-27/metrics.json", "git_dirty", 1, "git_dirty: expected boolean"),
        ("2026-10-27/metrics.json", "threads", True, "threads: expected"),
        ("2026-10-27/metrics.json", "seconds", {"total": -1}, "total: expected"),
        ("2026-10-27/metrics.json", "rss_tool", "unknown", "rss_tool: expected"),
        ("2026-10-27/impact.json", "risk", {"level": "BAD"}, "risk level: expected"),
        ("2026-10-27/impact.json", "exit_code", 0, "inconsistent"),
        ("2026-10-27/impact.json", "metrics", {"trips_total": "9"}, "trips_total: expected"),
        ("faults/261027/scores.json", "runs", {}, "runs: expected"),
        ("faults/261027/scores.json", "root_cause_single", None, "null"),
        (
            "faults/261027/scores.json",
            "impact_rate",
            {"correct": 0, "denominator": 2, "percent": None},
            "percent: null",
        ),
    ],
)
def test_invalid(results: Path, relative: str, key: str, value: object, reason: str) -> None:
    path = results / relative
    payload = json.loads(path.read_text())
    payload[key] = value
    path.write_text(json.dumps(payload))
    output = check(results)
    assert output.returncode == 1
    assert f"FAIL {path}" in output.stdout
    assert reason in output.stdout


@pytest.mark.parametrize(
    "relative,key",
    [
        ("2026-10-27/metrics.json", "git_commit"),
        ("2026-10-27/metrics.json", "git_dirty"),
        ("2026-10-27/impact.json", "old"),
        ("faults/261027/scores.json", "full_check_every"),
    ],
)
def test_missing(results: Path, relative: str, key: str) -> None:
    path = results / relative
    payload = json.loads(path.read_text())
    del payload[key]
    path.write_text(json.dumps(payload))
    output = check(results)
    assert output.returncode == 1
    assert f"{key}: missing field" in output.stdout


def test_empty(tmp_path: Path) -> None:
    output = check(tmp_path)
    assert output.returncode == 1
    assert "no files of any kind" in output.stdout


def test_real_results() -> None:
    root = Path(__file__).parents[1] / "results"
    output = check(root)
    assert output.returncode == 0, output.stdout
    assert f"OK {root / '2026-10-27/impact.json'}" in output.stdout
    assert f"OK {root / 'faults/261027/scores.json'} n = 200" in output.stdout
