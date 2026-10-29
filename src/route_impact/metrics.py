"""Benchmark the real snapshot comparison and merge external peak-RSS measurements."""

import argparse
import json
import os
import platform
import re
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
from typing import Any

import duckdb

from route_impact.extract import extract
from route_impact.graph import build_graph
from route_impact.impact import impact_from_graphs, load_way_info, read_trips, snapshot_nodes
from route_impact.risk import load_thresholds


def parse_time_log(text: str) -> dict[str, Any]:
    """Parse BSD time -l (bytes) or GNU time -v (KiB), including wall time."""
    bsd = re.search(r"^\s*(\d+)\s+maximum resident set size\s*$", text, re.MULTILINE)
    gnu = re.search(r"Maximum resident set size \(kbytes\):\s*(\d+)", text)
    if bsd:
        rss, tool = int(bsd[1]), "time -l"
        wall = re.search(r"(?:^|\s)([\d.]+)\s+real\b", text)
    elif gnu:
        rss, tool = int(gnu[1]) * 1024, "time -v"
        wall = re.search(r"Elapsed \(wall clock\) time[^\n]*\):\s*([\d:.]+)", text)
    else:
        raise ValueError("time log is missing maximum resident set size")
    if wall is None:
        raise ValueError("time log is missing wall clock time")
    seconds = 0.0
    for part in wall[1].split(":"):
        seconds = seconds * 60 + float(part)
    return {"peak_rss_bytes": rss, "rss_tool": tool, "wall_seconds": seconds}


def command_output(command: list[str]) -> str:
    return subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL).strip()


def environment() -> dict[str, Any]:
    cpu = platform.processor()
    if platform.system() == "Darwin":
        try:
            cpu = command_output(["sysctl", "-n", "machdep.cpu.brand_string"]) or cpu
        except (OSError, subprocess.CalledProcessError):
            pass  # Sandboxed macOS can deny sysctl; keep platform.processor().
    elif Path("/proc/cpuinfo").exists():
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                cpu = line.split(":", 1)[1].strip()
                break
    try:
        ram = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, OSError):
        ram = int(command_output(["sysctl", "-n", "hw.memsize"]))
    try:
        commit = command_output(["git", "rev-parse", "HEAD"])
        dirty = bool(command_output(["git", "status", "--porcelain", "--untracked-files=no"]))
    except FileNotFoundError:
        commit = None
        dirty = None
    return {
        "duckdb_version": duckdb.__version__,
        "python_version": platform.python_version(),
        "cpu": cpu,
        "ram_bytes": ram,
        "os": platform.platform(),
        "git_commit": commit,
        "git_dirty": dirty,
        "timestamp_utc": datetime.now(UTC).isoformat(),
    }


def snapshot_date(value: str) -> datetime:
    if len(value) != 6 or not value.isascii() or not value.isdigit():
        raise ValueError("date must be YYMMDD")
    return datetime.strptime("20" + value, "%Y%m%d")


def run(args: argparse.Namespace) -> dict[str, Any]:
    started = perf_counter()
    date = snapshot_date(args.snapshot)
    old = args.old or (date - timedelta(days=1)).strftime("%y%m%d")
    snapshot_date(old)
    pbfs = [args.data_dir / f"norcal-{d}.osm.pbf" for d in (old, args.snapshot)]
    for pbf in pbfs:
        if not pbf.is_file():
            raise FileNotFoundError(f"Snapshot file not found: {pbf}")
    # These are the defaults used by cli impact via compute_impact and extract.
    threads, memory_limit = 2, "2GB"
    options = {"threads": threads, "memory_limit": memory_limit}
    seconds: dict[str, float] = {}
    thresholds, trips = load_thresholds(args.thresholds), read_trips(args.trips)
    with TemporaryDirectory(prefix="route-impact-bench-", dir=args.data_dir) as directory:
        databases, graphs, nodes, ways = [], [], [], []
        for label, pbf in zip(("old", "new"), pbfs, strict=True):
            phase = perf_counter()
            db = extract(pbf, Path(directory) / label / "snapshot.duckdb", **options)
            seconds[f"extract_{label}"] = perf_counter() - phase
            databases.append(db)
            phase = perf_counter()
            graph = build_graph(db, **options)
            seconds[f"graph_{label}"] = perf_counter() - phase
            graphs.append(graph)
            phase = perf_counter()
            nodes.append(snapshot_nodes(db, graph, threads, memory_limit))
            ways.append(load_way_info(db, **options))
            seconds[f"prepare_{label}"] = perf_counter() - phase
        timings: dict[str, float] = {}
        phase = perf_counter()
        payload = impact_from_graphs(
            graphs[0],
            nodes[0],
            ways[0],
            databases[1],
            trips,
            thresholds,
            old_label=old,
            new_label=args.snapshot,
            new_graph=graphs[1],
            new_nodes=nodes[1],
            new_ways=ways[1],
            timings=timings,
            **options,
        )
        finished = perf_counter()
        seconds["total"] = finished - started
        elapsed = finished - phase
        seconds["route"] = timings["compare_incremental"]
        seconds["root_cause"] = timings["root_cause"]
        # Residual impact work: summary/risk, affected-trip selection and JSON conversion.
        # Segment differencing itself is inside compare_incremental (the route phase).
        seconds["diff"] = max(0.0, elapsed - seconds["route"] - seconds["root_cause"])
        # /usr/bin/time wall_seconds and peak_rss_bytes cover the whole process,
        # including count; total covers only the pipeline, excluding cleanup.
        phase = perf_counter()
        with duckdb.connect(str(databases[1]), config=options) as connection:
            drivable = connection.execute("SELECT COUNT(*) FROM roads").fetchone()[0]
            connection.execute("LOAD spatial")
            counts = dict.fromkeys(("node", "way", "relation"), 0)
            counts.update(
                connection.execute(
                    "SELECT kind::VARCHAR, COUNT(*) FROM ST_ReadOSM(?) GROUP BY kind",
                    [str(pbfs[1].resolve())],
                ).fetchall()
            )
        seconds["count"] = perf_counter() - phase
        result = {
            **environment(),
            "threads": threads,
            "memory_limit": memory_limit,
            "snapshot": args.snapshot,
            "old": old,
            "input_bytes": pbfs[1].stat().st_size,
            "input_bytes_old": pbfs[0].stat().st_size,
            "osm_rows_by_kind": counts,
            "drivable_ways": drivable,
            "graph_vertices": len(graphs[1].vertices),
            "graph_edges": len(graphs[1].edges),
            "lscc_vertices": len(graphs[1].lscc()),
            "risk_level": payload["risk"]["level"],
            "exit_code": payload["exit_code"],
            **{key: payload["metrics"][key] for key in ("broken", "slowed", "trips_total")},
            "seconds": seconds,
            "peak_rss_bytes": None,
            "rss_tool": None,
        }
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    benchmark = commands.add_parser("run")
    benchmark.add_argument("--snapshot", required=True)
    benchmark.add_argument("--old")
    benchmark.add_argument("--data-dir", type=Path, default=Path("data"))
    benchmark.add_argument("--trips", type=Path, default=Path("config/trips.csv"))
    benchmark.add_argument("--thresholds", type=Path, default=Path("config/thresholds.toml"))
    merge = commands.add_parser("add-rss")
    merge.add_argument("--log", type=Path, required=True)
    for command in (benchmark, merge):
        command.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            result = run(args)
        else:
            result = json.loads(args.out.read_text(encoding="utf-8"))
            result.update(parse_time_log(args.log.read_text(encoding="utf-8")))
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps(result, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8"
        )
        return 0
    except Exception as error:  # noqa: BLE001 — benchmark failures are tool errors.
        print(f"metrics {args.command}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
