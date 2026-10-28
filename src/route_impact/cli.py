"""Command-line entry point for route-impact."""

import argparse
import json
import sys
from datetime import datetime
from importlib.metadata import version
from pathlib import Path
from tempfile import TemporaryDirectory

from route_impact.extract import extract
from route_impact.impact import compute_impact, read_trips
from route_impact.report import render_markdown, write_report
from route_impact.risk import load_thresholds
from route_impact.trips import generate


def main(argv: list[str] | None = None) -> int:
    """Parse arguments and return the command's exit code."""
    parser = argparse.ArgumentParser(prog="route-impact")
    parser.add_argument("--version", action="version", version=version("route-impact"))
    subparsers = parser.add_subparsers(dest="command", required=True)
    trips = subparsers.add_parser("trips", help="Generate the fixed trip set")
    trips.add_argument("--snapshot", required=True)
    trips.add_argument("--seed", required=True, type=int)
    trips.add_argument("--out", type=Path, default=Path("config/trips.csv"))
    impact = subparsers.add_parser("impact", help="Compare routing impact")
    impact.add_argument("--old", required=True)
    impact.add_argument("--new", required=True)
    impact.add_argument("--trips", type=Path, default=Path("config/trips.csv"))
    impact.add_argument("--thresholds", type=Path, default=Path("config/thresholds.toml"))
    impact.add_argument("--data-dir", type=Path, default=Path("data"))
    impact.add_argument("--results-dir", type=Path, default=Path("results"))
    impact.add_argument("--full", action="store_true")
    report = subparsers.add_parser("report", help="Re-render an existing impact summary")
    report.add_argument("--date", required=True)
    report.add_argument("--results-dir", type=Path, default=Path("results"))
    for command in ("what-if", "faults"):
        subparsers.add_parser(command, help="not implemented yet")
    args = parser.parse_args(argv)
    if args.command == "impact":
        try:
            dates = []
            for value in (args.old, args.new):
                if len(value) != 6 or not value.isascii() or not value.isdigit():
                    raise ValueError("date must be YYMMDD (no latest)")
                dates.append(datetime.strptime("20" + value, "%Y%m%d"))
            pbfs = [args.data_dir / f"norcal-{value}.osm.pbf" for value in (args.old, args.new)]
            for pbf in pbfs:
                if not pbf.is_file():
                    raise FileNotFoundError(f"Snapshot file not found: {pbf}")
            thresholds = load_thresholds(args.thresholds)
            rows = read_trips(args.trips)
            with TemporaryDirectory(prefix="route-impact-") as directory:
                databases = []
                for label, value, pbf in zip(
                    ("old", "new"), (args.old, args.new), pbfs, strict=True
                ):
                    folder = Path(directory) / label
                    databases.append(extract(pbf, folder / f"{value}.duckdb"))
                payload = compute_impact(
                    *databases,
                    rows,
                    thresholds,
                    old_label=args.old,
                    new_label=args.new,
                    full=args.full,
                )
                output = args.results_dir / dates[1].strftime("%Y-%m-%d") / "impact.json"
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(
                    json.dumps(payload, sort_keys=True, indent=2, allow_nan=False) + "\n",
                    encoding="utf-8",
                )
                write_report(payload, output.parent, *databases)
            print(
                f"{payload['risk']['level']} {payload['risk']['rule']} broken={payload['metrics']['broken']} slowed={payload['metrics']['slowed']} output={output}"
            )
            return payload["exit_code"]
        except Exception as error:  # noqa: BLE001 — every impact failure must exit 2.
            print(f"impact: {error}", file=sys.stderr)
            return 2
    if args.command == "report":
        try:
            date = datetime.strptime(args.date, "%Y-%m-%d")
            if date.strftime("%Y-%m-%d") != args.date:
                raise ValueError("date must be YYYY-MM-DD")
            directory = args.results_dir / args.date
            payload = json.loads((directory / "impact.json").read_text(encoding="utf-8"))
            (directory / "report.md").write_text(render_markdown(payload), encoding="utf-8")
            return 0
        except Exception as error:  # noqa: BLE001 — report failures are tool errors.
            print(f"report: {error}", file=sys.stderr)
            return 2
    if args.command == "trips":
        if args.snapshot != "latest" and (
            len(args.snapshot) != 6 or not args.snapshot.isascii() or not args.snapshot.isdigit()
        ):
            parser.error("snapshot must be YYMMDD or latest")
        pbf = Path("data") / f"norcal-{args.snapshot}.osm.pbf"
        if not pbf.is_file():
            print(f"Snapshot file not found: {pbf}")
            return 2
        generate(pbf, args.out, seed=args.seed)
        return 0
    print("not implemented yet")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
