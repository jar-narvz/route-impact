"""Command-line entry point for route-impact."""

import argparse
from importlib.metadata import version
from pathlib import Path

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
    for command in ("impact", "what-if", "faults"):
        subparsers.add_parser(command, help="not implemented yet")
    args = parser.parse_args(argv)
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
