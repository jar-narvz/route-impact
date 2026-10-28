"""Command-line entry point for route-impact."""

import argparse
from importlib.metadata import version


def main(argv: list[str] | None = None) -> int:
    """Parse arguments and return the command's exit code."""
    parser = argparse.ArgumentParser(prog="route-impact")
    parser.add_argument("--version", action="version", version=version("route-impact"))
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("trips", "impact", "what-if", "faults"):
        subparsers.add_parser(command, help="not implemented yet")
    parser.parse_args(argv)
    print("not implemented yet")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
