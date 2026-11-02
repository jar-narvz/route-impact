"""Plan daily snapshot windows from complete results, without downloading anything."""

import argparse
import json
import os
import re
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path


def _iso_date(value: str) -> date:
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError(f"Expected YYYY-MM-DD: {value!r}")
    return date.fromisoformat(value)


def _snapshot_date(value: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{6}", value):
        raise ValueError(f"Expected YYMMDD: {value!r}")
    return datetime.strptime("20" + value, "%Y%m%d").date()


def is_complete(directory: Path) -> bool:
    """Use the same completed-result contract for skipping and chaining."""
    try:
        target = _iso_date(directory.name)
        payload = json.loads((directory / "impact.json").read_text())
        return (
            isinstance(payload, dict)
            and payload.get("new") == target.strftime("%y%m%d")
            and _snapshot_date(payload.get("new")) == target
            and _snapshot_date(payload.get("old")) < target
            and type(payload.get("exit_code")) is int
            and payload["exit_code"] in {0, 1}
            and (directory / "report.md").is_file()
            and (directory / "impact.geojson").is_file()
        )
    except (OSError, ValueError, TypeError):
        return False


@dataclass(frozen=True)
class Window:
    """Dates, decisions and a single-line explanation suitable for Actions outputs."""

    date: date
    new: str
    old: str
    gap_days: int
    skip: bool
    fresh_start: bool
    note: str


def plan_window(today_utc: date, results_dir: Path, explicit: date | None, max_gap: int) -> Window:
    """Chain scheduled runs to the latest earlier complete result within the cap."""
    if max_gap < 1:
        raise ValueError("max_gap must be a positive integer")
    target = explicit or today_utc - timedelta(days=1)
    previous_day = target - timedelta(days=1)
    old = previous_day
    skip = is_complete(results_dir / target.isoformat())
    fresh_start = False
    notes = []
    if not skip and explicit is None:
        predecessors = []
        for directory in sorted(results_dir.iterdir()) if results_dir.exists() else []:
            if not directory.is_dir():
                continue
            try:
                candidate = _iso_date(directory.name)
            except ValueError:
                continue
            if not is_complete(directory):
                notes.append(f"Warning: ignoring incomplete result {directory.name}.")
            elif candidate > target:
                notes.append(f"Warning: ignoring future result {directory.name}.")
            elif candidate < target:
                predecessors.append(candidate)
        predecessor = max(predecessors, default=None)
        if predecessor is not None and (target - predecessor).days <= max_gap:
            old = predecessor
        else:
            fresh_start = True
            if predecessor is None:
                notes.append(
                    f"Fresh start: no complete predecessor; uncovered dates through {previous_day}."
                )
            else:
                notes.append(
                    f"Fresh start: gap {(target - predecessor).days} exceeds cap {max_gap}; "
                    f"uncovered dates {predecessor + timedelta(days=1)} through {previous_day}."
                )
    return Window(
        target,
        target.strftime("%y%m%d"),
        old.strftime("%y%m%d"),
        (target - old).days,
        skip,
        fresh_start,
        " ".join(notes),
    )


def main(argv: list[str] | None = None) -> int:
    """Print the plan and optionally append the same values to GITHUB_OUTPUT."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan")
    plan.add_argument("--today", type=_iso_date)
    plan.add_argument("--date", type=_iso_date)
    plan.add_argument("--results-dir", type=Path, default=Path("results"))
    plan.add_argument("--max-gap", type=int, default=3)
    args = parser.parse_args(argv)
    try:
        window = plan_window(
            args.today or datetime.now(UTC).date(),
            args.results_dir,
            args.date,
            args.max_gap,
        )
    except ValueError as error:
        parser.error(str(error))
    output = "".join(
        f"{key}={str(value).lower() if isinstance(value, bool) else value}\n"
        for key, value in asdict(window).items()
    )
    print(output, end="")
    if path := os.environ.get("GITHUB_OUTPUT"):
        with Path(path).open("a") as destination:
            destination.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
