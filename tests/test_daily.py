"""Offline daily-window and shell integration checks; no real downloads or git writes."""

import json
import os
import shutil
import subprocess
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from route_impact.daily import Window, is_complete, main, plan_window


def complete(results: Path, day: date, **changes: object) -> Path:
    directory = results / day.isoformat()
    directory.mkdir(parents=True, exist_ok=True)
    payload = {
        "old": (day - timedelta(days=1)).strftime("%y%m%d"),
        "new": day.strftime("%y%m%d"),
        "exit_code": 0,
        **changes,
    }
    (directory / "impact.json").write_text(json.dumps(payload))
    (directory / "report.md").write_text("report")
    (directory / "impact.geojson").write_text("{}")
    return directory


@pytest.mark.parametrize("cap", [2, 3, 5])
@pytest.mark.parametrize("kind", ["one", "cap", "over"])
def test_windows(tmp_path: Path, cap: int, kind: str) -> None:
    target = date(2026, 10, 31)
    gap = {"one": 1, "cap": cap, "over": cap + 1}[kind]
    predecessor = target - timedelta(days=gap)
    complete(tmp_path, predecessor)
    fresh = kind == "over"
    old = target - timedelta(days=1) if fresh else predecessor
    note = (
        f"Fresh start: gap {gap} exceeds cap {cap}; "
        f"uncovered dates {predecessor + timedelta(days=1)} through {old}."
        if fresh
        else ""
    )
    assert plan_window(date(2026, 11, 1), tmp_path, None, cap) == Window(
        target, "261031", old.strftime("%y%m%d"), 1 if fresh else gap, False, fresh, note
    )


def test_real_stall_and_future_result(tmp_path: Path) -> None:
    complete(tmp_path, date(2026, 10, 28))
    expected = Window(date(2026, 10, 31), "261031", "261028", 3, False, False, "")
    assert plan_window(date(2026, 11, 1), tmp_path, None, 3) == expected
    complete(tmp_path, date(2026, 11, 2))
    assert plan_window(date(2026, 11, 1), tmp_path, None, 3) == Window(
        expected.date,
        expected.new,
        expected.old,
        3,
        False,
        False,
        "Warning: ignoring future result 2026-11-02.",
    )


@pytest.mark.parametrize("explicit", [None, date(2026, 10, 31)])
@pytest.mark.parametrize("exit_code", [0, 1])
def test_skip_complete(tmp_path: Path, explicit: date | None, exit_code: int) -> None:
    complete(tmp_path, date(2026, 10, 31), exit_code=exit_code)
    assert plan_window(date(2026, 11, 1), tmp_path, explicit, 3) == Window(
        date(2026, 10, 31), "261031", "261030", 1, True, False, ""
    )


@pytest.mark.parametrize(
    "defect",
    ["metrics", "new", "exit", "report", "geojson", "json", "old", "same_old", "bool", "list"],
)
def test_incomplete_never_chained_or_skipped(tmp_path: Path, defect: str) -> None:
    complete(tmp_path, date(2026, 10, 28))
    directory = complete(tmp_path, date(2026, 10, 30))
    payload = json.loads((directory / "impact.json").read_text())
    if defect == "metrics":
        (directory / "impact.json").unlink()
        (directory / "report.md").unlink()
        (directory / "impact.geojson").unlink()
        (directory / "metrics.json").write_text("{}")
    elif defect in {"report", "geojson"}:
        (directory / {"report": "report.md", "geojson": "impact.geojson"}[defect]).unlink()
    elif defect == "json":
        (directory / "impact.json").write_text("{")
    else:
        key, value = {
            "new": ("new", "261029"),
            "exit": ("exit_code", 2),
            "old": ("old", "260230"),
            "same_old": ("old", "261030"),
            "bool": ("exit_code", True),
            "list": ("old", []),
        }[defect]
        payload[key] = value
        (directory / "impact.json").write_text(json.dumps(payload))
    assert not is_complete(directory)
    note = "Warning: ignoring incomplete result 2026-10-30."
    assert plan_window(date(2026, 11, 1), tmp_path, None, 3) == Window(
        date(2026, 10, 31), "261031", "261028", 3, False, False, note
    )
    assert plan_window(date(2026, 10, 31), tmp_path, None, 3) == Window(
        date(2026, 10, 30), "261030", "261028", 2, False, False, note
    )


def test_invalid_names_and_no_predecessor(tmp_path: Path) -> None:
    for name in ("2026-02-30", "faults", "playground", "2026-1-01"):
        directory = tmp_path / name
        directory.mkdir()
        assert not is_complete(directory)
    expected = Window(
        date(2026, 10, 31),
        "261031",
        "261030",
        1,
        False,
        True,
        "Fresh start: no complete predecessor; uncovered dates through 2026-10-30.",
    )
    assert plan_window(date(2026, 11, 1), tmp_path, None, 3) == expected
    assert plan_window(date(2026, 11, 1), tmp_path / "missing", None, 3) == expected


def test_explicit_does_not_chain(tmp_path: Path) -> None:
    complete(tmp_path, date(2026, 10, 28))
    assert plan_window(date(2026, 11, 4), tmp_path, date(2026, 10, 31), 3) == Window(
        date(2026, 10, 31), "261031", "261030", 1, False, False, ""
    )


@pytest.mark.parametrize(
    ("predecessor", "target", "old", "new"),
    [
        (date(2026, 12, 31), date(2027, 1, 2), "261231", "270102"),
        (date(2028, 2, 28), date(2028, 3, 1), "280228", "280301"),
    ],
)
def test_calendar_boundaries(tmp_path: Path, predecessor: date, target: date, old: str, new: str):
    complete(tmp_path, predecessor)
    assert plan_window(target + timedelta(days=1), tmp_path, None, 3) == Window(
        target, new, old, 2, False, False, ""
    )


def test_cli_replay_and_actions_output(tmp_path: Path, monkeypatch, capsys) -> None:
    complete(tmp_path, date(2026, 10, 28))
    output = tmp_path / "outputs"
    output.write_text("existing=value\n")
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    assert main(["plan", "--today", "2026-11-01", "--results-dir", str(tmp_path)]) == 0
    expected = (
        "date=2026-10-31\nnew=261031\nold=261028\ngap_days=3\n"
        "skip=false\nfresh_start=false\nnote=\n"
    )
    assert capsys.readouterr().out == expected
    assert output.read_text() == "existing=value\n" + expected


def test_cli_default_uses_utc(tmp_path: Path, monkeypatch, capsys) -> None:
    class Clock:
        @staticmethod
        def now(tz):
            assert tz is UTC
            return datetime(2026, 11, 1, 0, 30, tzinfo=tz)

    monkeypatch.setattr("route_impact.daily.datetime", Clock)
    assert main(["plan", "--results-dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out == (
        "date=2026-10-31\nnew=261031\nold=261030\ngap_days=1\n"
        "skip=false\nfresh_start=true\n"
        "note=Fresh start: no complete predecessor; uncovered dates through 2026-10-30.\n"
    )


@pytest.mark.parametrize(
    "args", [["--max-gap", "0"], ["--date", "2026-02-30"], ["--today", "2026-1-01"]]
)
def test_cli_invalid_arguments(args: list[str]) -> None:
    with pytest.raises(SystemExit) as error:
        main(["plan", *args])
    assert error.value.code == 2


@pytest.fixture
def shell_repo(tmp_path: Path) -> tuple[Path, dict[str, str], date]:
    root = Path(__file__).resolve().parents[1]
    (tmp_path / "scripts").mkdir()
    (tmp_path / "bin").mkdir()
    shutil.copyfile(root / "scripts/daily.sh", tmp_path / "scripts/daily.sh")
    (tmp_path / "scripts/download.sh").write_text("""#!/usr/bin/env bash
set -eu
echo "$1" >> downloads
if [[ "$1" == "${FAIL_SNAPSHOT:-}" ]]; then
    echo "not published (404)" >&2
    exit 1
fi
mkdir -p data
printf 'verified %s' "$1" > "data/norcal-$1.osm.pbf"
printf 'manifest %s' "$1" > "data/norcal-$1.osm.pbf.md5"
""")
    fakes = {
        "route-impact": """#!/usr/bin/env bash
printf '%s\\n' "$@" > route-args
exit "${IMPACT_CODE:-0}"
""",
        "git": """#!/usr/bin/env bash
printf '%s\\n' "$@" >> git-args
""",
        "gh": """#!/usr/bin/env bash
printf '%s\\n' "$@" >> gh-args
""",
    }
    for name, content in fakes.items():
        path = tmp_path / "bin" / name
        path.write_text(content)
        path.chmod(0o755)
    # Keep the production UTC clock. The pure CLI separately tests the fixed stall date.
    target = datetime.now(UTC).date() - timedelta(days=1)
    complete(tmp_path / "results", target - timedelta(days=3))
    env = {
        **os.environ,
        "PATH": str(tmp_path / "scripts")
        + os.pathsep
        + str(tmp_path / "bin")
        + os.pathsep
        + str(Path(sys.executable).parent)
        + os.pathsep
        + os.environ["PATH"],
        "PYTHONPATH": str(root / "src"),
        "DATE": "",
        "TEST_HIGH": "false",
        "DAILY_DRY_RUN": "0",
        "DAILY_MAX_GAP_DAYS": "3",
        "DAILY_RETRIES": "2",
        "DAILY_RETRY_SECONDS": "0",
        "GITHUB_OUTPUT": str(tmp_path / "outputs"),
        "GITHUB_STEP_SUMMARY": str(tmp_path / "summary"),
    }
    return tmp_path, env, target


@pytest.mark.parametrize("fallback", [False, True])
def test_shell_chain_fallback_and_cache(shell_repo, fallback: bool) -> None:
    directory, env, target = shell_repo
    chained_old = (target - timedelta(days=3)).strftime("%y%m%d")
    yesterday = (target - timedelta(days=1)).strftime("%y%m%d")
    new = target.strftime("%y%m%d")
    cache = directory / "data/pbf-cache"
    cache.mkdir(parents=True)
    for suffix in ("", ".md5"):
        (cache / f"norcal-{chained_old}.osm.pbf{suffix}").write_text("cached")
    (cache / "unrelated").write_text("stale")
    # Prove restored files are hardlinks before the fake downloader overwrites them.
    download = directory / "scripts/download.sh"
    download.write_text(
        download.read_text().replace(
            'echo "$1" >> downloads',
            '''if [[ "$1" == "'''
            + chained_old
            + """" ]]; then
    [[ "data/norcal-$1.osm.pbf" -ef "data/pbf-cache/norcal-$1.osm.pbf" ]]
    [[ "data/norcal-$1.osm.pbf.md5" -ef "data/pbf-cache/norcal-$1.osm.pbf.md5" ]]
fi
echo "$1" >> downloads""",
        )
    )
    if fallback:
        env["FAIL_SNAPSHOT"] = chained_old
    result = subprocess.run(
        ["bash", "scripts/daily.sh"],
        cwd=directory,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert (directory / "route-args").read_text().splitlines() == [
        "impact",
        "--old",
        yesterday if fallback else chained_old,
        "--new",
        new,
    ]
    assert (directory / "downloads").read_text().splitlines() == (
        [chained_old, yesterday, new] if fallback else [chained_old, new]
    )
    assert sorted(p.name for p in cache.iterdir()) == [
        f"norcal-{new}.osm.pbf",
        f"norcal-{new}.osm.pbf.md5",
    ]
    for path in cache.iterdir():
        assert path.samefile(directory / "data" / path.name)
    assert (directory / "outputs").read_text().endswith("publish=true\n")
    assert result.stdout.count("Filesystem") == 2
    if fallback:
        note = (
            f"Fresh start: chained OLD {chained_old} not published; uncovered dates "
            f"{target - timedelta(days=2)} through {target - timedelta(days=1)}."
        )
        assert note in result.stdout
        assert (directory / "summary").read_text() == note + "\n"
        assert (directory / "git-args").read_text().splitlines() == [
            "config",
            "user.name",
            "github-actions[bot]",
            "config",
            "user.email",
            "41898699+github-actions[bot]@users.noreply.github.com",
            "add",
            f"results/{target}/",
            "commit",
            "-m",
            f"Add impact results for {target}",
            "-m",
            note,
            "pull",
            "--rebase",
            "push",
        ]


def test_shell_fallback_retries_previous_day(shell_repo) -> None:
    directory, env, target = shell_repo
    old = (target - timedelta(days=3)).strftime("%y%m%d")
    previous = (target - timedelta(days=1)).strftime("%y%m%d")
    download = directory / "scripts/download.sh"
    download.write_text(
        download.read_text().replace(
            '[[ "$1" == "${FAIL_SNAPSHOT:-}" ]]', f'[[ "$1" == "{old}" || "$1" == "{previous}" ]]'
        )
    )
    result = subprocess.run(
        ["bash", "scripts/daily.sh"],
        cwd=directory,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert (directory / "downloads").read_text().splitlines() == [old, previous, previous]
    assert not (directory / "route-args").exists()
    assert (directory / "outputs").read_text().endswith("publish=false\n")


def test_shell_dry_run_still_routes(shell_repo) -> None:
    directory, env, target = shell_repo
    env["DAILY_DRY_RUN"] = "1"
    result = subprocess.run(
        ["bash", "scripts/daily.sh"],
        cwd=directory,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert (directory / "route-args").read_text().splitlines() == [
        "impact",
        "--old",
        (target - timedelta(days=3)).strftime("%y%m%d"),
        "--new",
        target.strftime("%y%m%d"),
    ]
    assert not (directory / "git-args").exists()
    assert "DRY RUN: git push" in result.stdout
    assert (directory / "outputs").read_text().endswith("publish=false\n")


def test_shell_test_high_bypasses_planning(shell_repo) -> None:
    directory, env, _ = shell_repo
    env.update(TEST_HIGH="true", IMPACT_CODE="1", DAILY_MAX_GAP_DAYS="invalid")
    fixtures = directory / "tests/fixtures"
    fixtures.mkdir(parents=True)
    for name in ("town_v1", "town_v2"):
        (fixtures / f"{name}.osm.pbf").write_text("fixture")
    command = directory / "bin/route-impact"
    command.write_text(
        command.read_text().replace(
            'exit "${IMPACT_CODE:-0}"',
            '''mkdir -p "$9/2026-10-02"
printf 'HIGH fixture' > "$9/2026-10-02/report.md"
exit "${IMPACT_CODE:-0}"''',
        )
    )
    result = subprocess.run(
        ["bash", "scripts/daily.sh"],
        cwd=directory,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert (directory / "route-args").read_text().splitlines()[:5] == [
        "impact",
        "--old",
        "261001",
        "--new",
        "261002",
    ]
    assert not (directory / "downloads").exists()
    assert (directory / "gh-args").read_text().splitlines()[:4] == [
        "issue",
        "create",
        "--title",
        "[test] HIGH risk: fixture town_v1 → town_v2",
    ]
    assert (directory / "outputs").read_text() == "publish=false\n"


def test_shell_complete_target_skips(shell_repo) -> None:
    directory, env, target = shell_repo
    complete(directory / "results", target)
    result = subprocess.run(
        ["bash", "scripts/daily.sh"],
        cwd=directory,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert f"results/{target} already done; skipping" in result.stdout
    assert not (directory / "downloads").exists()
    assert not (directory / "route-args").exists()
    assert (directory / "outputs").read_text().endswith("publish=false\n")


def test_shell_explicit_has_no_fallback_or_retries(shell_repo) -> None:
    directory, env, target = shell_repo
    old = (target - timedelta(days=1)).strftime("%y%m%d")
    env.update(DATE=target.isoformat(), FAIL_SNAPSHOT=old)
    result = subprocess.run(
        ["bash", "scripts/daily.sh"],
        cwd=directory,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert (directory / "downloads").read_text().splitlines() == [old]
    assert not (directory / "route-args").exists()
    assert not (directory / "summary").exists()


def test_shell_new_still_retries(shell_repo) -> None:
    directory, env, target = shell_repo
    new = target.strftime("%y%m%d")
    old = (target - timedelta(days=3)).strftime("%y%m%d")
    env["FAIL_SNAPSHOT"] = new
    result = subprocess.run(
        ["bash", "scripts/daily.sh"],
        cwd=directory,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert (directory / "downloads").read_text().splitlines() == [old, new, new]
    assert not (directory / "route-args").exists()
    assert not (directory / "git-args").exists()


@pytest.mark.parametrize("max_gap", ["0", "-1", "abc", "1.5"])
def test_shell_invalid_cap(shell_repo, max_gap: str) -> None:
    directory, env, _ = shell_repo
    env["DAILY_MAX_GAP_DAYS"] = max_gap
    result = subprocess.run(
        ["bash", "scripts/daily.sh"],
        cwd=directory,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert result.stderr == "DAILY_MAX_GAP_DAYS must be a positive integer\n"
    assert not (directory / "downloads").exists()
