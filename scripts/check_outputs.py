"""Validate committed result schemas without importing the pipeline or its dependencies."""

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any


def number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def fields(data: dict, names: str, predicate: Any, expected: str, errors: list[str]) -> None:
    for name in names.split():
        if name not in data:
            errors.append(f"{name}: missing field")
        elif data[name] is None:
            errors.append(f"{name}: null")
        elif not predicate(data[name]):
            errors.append(f"{name}: expected {expected}")


def integer(value: Any) -> bool:
    return type(value) is int and value >= 0


def mapping(data: dict, key: str, errors: list[str]) -> dict:
    fields(data, key, lambda v: isinstance(v, dict), "object", errors)
    return data[key] if isinstance(data.get(key), dict) else {}


def risk(data: dict, level: Any, errors: list[str]) -> None:
    fields(
        data, "exit_code", lambda v: type(v) is int and v in (0, 1, 2), "exit code 0/1/2", errors
    )
    if not isinstance(level, str) or level not in {"LOW", "MEDIUM", "HIGH"}:
        errors.append("risk level: expected LOW/MEDIUM/HIGH")
    # risk.py maps HIGH to 1, both LOW and MEDIUM to 0; 2 is a tool error.
    elif data.get("exit_code") != (1 if level == "HIGH" else 0):
        errors.append("exit_code: inconsistent with risk level")


def validate_metrics(data: dict) -> list[str]:
    errors: list[str] = []
    fields(
        data,
        "input_bytes input_bytes_old drivable_ways graph_vertices graph_edges "
        "lscc_vertices broken slowed trips_total threads ram_bytes peak_rss_bytes",
        integer,
        "nonnegative integer",
        errors,
    )
    fields(
        data,
        "duckdb_version python_version memory_limit cpu os git_commit timestamp_utc snapshot old risk_level",
        lambda v: isinstance(v, str) and bool(v),
        "nonempty string",
        errors,
    )
    fields(
        data,
        "rss_tool",
        lambda v: isinstance(v, str) and v in {"time -l", "time -v"},
        "time -l or time -v",
        errors,
    )
    fields(data, "wall_seconds", number, "finite nonnegative seconds", errors)
    fields(data, "git_dirty", lambda v: type(v) is bool, "boolean", errors)
    seconds = mapping(data, "seconds", errors)
    fields(
        seconds,
        "extract_old extract_new graph_old graph_new prepare_old prepare_new "
        "route diff root_cause count total",
        number,
        "finite nonnegative seconds",
        errors,
    )
    counts = mapping(data, "osm_rows_by_kind", errors)
    fields(counts, "node way relation", integer, "nonnegative integer", errors)
    if any(not isinstance(k, str) or not integer(v) for k, v in counts.items()):
        errors.append("osm_rows_by_kind: expected str -> nonnegative integer")
    risk(data, data.get("risk_level"), errors)
    return errors


def validate_impact(data: dict) -> list[str]:
    errors: list[str] = []
    fields(data, "old new", lambda v: isinstance(v, str) and bool(v), "nonempty string", errors)
    risk(data, mapping(data, "risk", errors).get("level"), errors)
    fields(mapping(data, "metrics", errors), "trips_total", integer, "nonnegative integer", errors)
    return errors


def validate_scores(data: dict) -> tuple[list[str], int]:
    errors: list[str] = []
    fields(data, "full_check_every", lambda v: integer(v) and v > 0, "positive integer", errors)
    for name in (
        "impact_rate",
        "incremental_equals_full",
        "root_cause_single",
        "root_cause_batch",
        "root_cause_joint",
    ):
        score_errors: list[str] = []
        score = mapping(data, name, score_errors)
        fields(score, "correct denominator", integer, "nonnegative integer", score_errors)
        # faults.py writes null percent when no trips qualify (denominator == 0).
        if score.get("denominator") == 0 and "percent" in score and score["percent"] is None:
            pass
        else:
            fields(
                score,
                "percent",
                lambda v: number(v) and v <= 100,
                "percent in [0, 100]",
                score_errors,
            )
        if (
            integer(score.get("correct"))
            and integer(score.get("denominator"))
            and score["correct"] > score["denominator"]
        ):
            score_errors.append("correct exceeds denominator")
        errors.extend(f"{name}.{error}" for error in score_errors)
    fields(data, "runs", lambda v: isinstance(v, list), "list", errors)
    runs = data.get("runs")
    n = 0
    if isinstance(runs, list):
        if any(not isinstance(run, dict) or type(run.get("single")) is not bool for run in runs):
            errors.append("runs: expected objects with boolean single")
        n = sum(isinstance(run, dict) and run.get("single") is True for run in runs)
    return errors, n


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--expect-impact", type=int, default=0)
    args = parser.parse_args(argv)
    counts = dict.fromkeys(("metrics", "impact", "scores"), 0)
    failures = 0
    for path in sorted(args.root.rglob("*.json")):
        relative = path.relative_to(args.root)
        parts = relative.parts
        kind = None
        if len(parts) == 2 and re.fullmatch(r"\d{4}-\d{2}-\d{2}", parts[0]):
            kind = {"metrics.json": "metrics", "impact.json": "impact"}.get(parts[1])
        elif len(parts) == 3 and parts[0] == "faults" and parts[2] == "scores.json":
            kind = "scores"
        if kind is None:
            continue
        counts[kind] += 1
        detail = ""
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise TypeError("expected JSON object")
            if kind == "scores":
                errors, n = validate_scores(data)
                detail = f" n = {n}"
            elif kind == "metrics":
                errors = validate_metrics(data)
                if data.get("git_dirty") is True and not errors:
                    detail = " WARN dirty tree"
            else:
                errors = validate_impact(data)
        except (OSError, ValueError, TypeError) as error:
            errors = [str(error)]
        failures += bool(errors)
        print(
            f"{'FAIL' if errors else 'OK'} {path}{detail}"
            + (": " + "; ".join(errors) if errors else "")
        )
    if not sum(counts.values()):
        print("FAIL: no files of any kind found (metrics.json, impact.json, scores.json)")
        failures += 1
    if counts["impact"] < args.expect_impact:
        print(
            f"FAIL: expected at least {args.expect_impact} impact.json files; found {counts['impact']}"
        )
        failures += 1
    print(
        f"Summary: metrics={counts['metrics']} impact={counts['impact']} scores={counts['scores']} failures={failures}"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
