"""Command-line entry point for route-impact."""

import argparse
import json
import sys
from datetime import datetime
from importlib.metadata import version
from pathlib import Path
from tempfile import TemporaryDirectory

from route_impact.extract import extract
from route_impact.faults import Fault, run_suite, run_what_if
from route_impact.impact import compute_impact, read_trips, serialisable
from route_impact.playground import export_playground, load_config, write_json
from route_impact.playground_oracle import (
    default_jobs,
    load_export,
    run_case,
    run_stress,
    write_presets,
)
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
    what_if = subparsers.add_parser("what-if", help="Evaluate hypothetical edits")
    faults = subparsers.add_parser("faults", help="Evaluate seeded faults")
    for command in (what_if, faults):
        command.add_argument("--snapshot", required=True)
        command.add_argument("--data-dir", type=Path, default=Path("data"))
        command.add_argument("--trips", type=Path, default=Path("config/trips.csv"))
        command.add_argument("--thresholds", type=Path, default=Path("config/thresholds.toml"))
    what_if.add_argument("--out", type=Path)
    for flag in ("delete-way", "flip-oneway", "disconnect-node"):
        what_if.add_argument(f"--{flag}", action="append", type=int, default=[])
    faults.add_argument("--full-check-every", type=int, default=10)
    faults.add_argument("--fresh", action="store_true")
    faults.add_argument("--n", type=int, required=True)
    faults.add_argument("--seed", type=int, required=True)
    faults.add_argument("--results-dir", type=Path, default=Path("results"))
    playground = subparsers.add_parser(
        "export-playground", help="Export the Bay box graph for the fault playground"
    )
    playground.add_argument("--snapshot", required=True)
    playground.add_argument("--db", type=Path, required=True, help="Extracted snapshot DuckDB")
    playground.add_argument("--trips", type=Path, default=Path("config/trips.csv"))
    playground.add_argument("--out", type=Path, default=Path("data/playground"))
    playground.add_argument("--order", choices=("routingkit", "identity"), default="routingkit")
    playground.add_argument("--config", type=Path, default=Path("config/playground.toml"))
    playground.add_argument("--thresholds", type=Path, default=Path("config/thresholds.toml"))
    playground.add_argument("--demo-faults", type=Path, default=Path("config/demo_faults.toml"))
    oracle = subparsers.add_parser(
        "playground-oracle", help="Recompute playground edits in Python (the test oracle)"
    )
    oracle.add_argument("--data", type=Path, required=True, help="Playground export directory")
    mode = oracle.add_mutually_exclusive_group(required=True)
    mode.add_argument("--case", help="Edit as JSON text, or a path to a JSON file")
    mode.add_argument("--stress", type=Path, help="Stress-set JSON; needs --output")
    mode.add_argument("--write-presets", action="store_true", help="Write presets.json.gz")
    oracle.add_argument("--output", type=Path, help="Write JSON here instead of stdout")
    oracle.add_argument("--jobs", type=int, default=default_jobs(), help="Processes for --stress")
    args = parser.parse_args(argv)
    if args.command == "export-playground":
        return run_export_playground(args)
    if args.command == "playground-oracle":
        return run_playground_oracle(args)
    if args.command in {"what-if", "faults"}:
        try:
            options = {
                "data_dir": args.data_dir,
                "trips_path": args.trips,
                "thresholds_path": args.thresholds,
            }
            if args.command == "what-if":
                injections = [
                    Fault(kind, **{key: value})
                    for kind, key, values in (
                        ("delete_way", "way_id", args.delete_way),
                        ("flip_oneway", "way_id", args.flip_oneway),
                        ("disconnect_node", "node_id", args.disconnect_node),
                    )
                    for value in values
                ]
                payload = run_what_if(args.snapshot, injections, out=args.out, **options)
                return payload["exit_code"]
            run_suite(
                args.snapshot,
                n=args.n,
                seed=args.seed,
                results_dir=args.results_dir,
                full_check_every=args.full_check_every,
                fresh=args.fresh,
                **options,
            )
            return 0
        except Exception as error:  # noqa: BLE001 — fault failures are tool errors.
            print(f"{args.command}: {error}", file=sys.stderr)
            return 2
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
                    json.dumps(serialisable(payload), sort_keys=True, indent=2, allow_nan=False)
                    + "\n",
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


def run_export_playground(args: argparse.Namespace) -> int:
    """Export the playground files from an already extracted snapshot database."""
    try:
        if len(args.snapshot) != 6 or not args.snapshot.isascii() or not args.snapshot.isdigit():
            raise ValueError("snapshot must be YYMMDD")
        options = {
            "trips_path": args.trips,
            "config": load_config(args.config),
            "thresholds_path": args.thresholds,
            "demo_faults_path": args.demo_faults,
            "order": args.order,
        }
        if not args.db.is_file():
            raise FileNotFoundError(f"Database not found: {args.db}")
        meta = export_playground(args.db, args.snapshot, args.out, **options)
        for row in meta["files"]:
            print(f"{row['file']}: raw={row['raw_bytes']} gzip={row['gzip_bytes']}")
        print(
            f"TOTAL shipped: {meta['total_shipped_bytes']} B; counts: {json.dumps(meta['counts'])}"
        )
        return 0
    except Exception as error:  # noqa: BLE001 — export failures are tool errors.
        print(f"export-playground: {error}", file=sys.stderr)
        return 2


def run_playground_oracle(args: argparse.Namespace) -> int:
    """Run one case, the stress set, or the presets through the Python oracle."""
    try:
        if args.write_presets:
            meta = write_presets(args.data)
            row = next(r for r in meta["files"] if r["file"] == "presets.json.gz")
            print(f"presets.json.gz: raw={row['raw_bytes']} gzip={row['gzip_bytes']}")
            return 0
        if args.stress is not None:
            if args.output is None:
                raise ValueError("--stress needs --output")
            stress = json.loads(args.stress.read_text(encoding="utf-8"))
            result = run_stress(args.data, stress, jobs=args.jobs)
        else:
            inline = args.case.lstrip().startswith("{")
            text = args.case if inline else Path(args.case).read_text(encoding="utf-8")
            result = run_case(load_export(args.data), json.loads(text))
        if args.output is None:
            print(json.dumps(result, indent=2, allow_nan=False))
        else:
            write_json(args.output, result)
        return 0
    except Exception as error:  # noqa: BLE001 — oracle failures are tool errors.
        print(f"playground-oracle: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
