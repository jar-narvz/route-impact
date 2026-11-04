"""Build results/index.json so the static map can list published days and samples."""

import argparse
import json
from pathlib import Path
from typing import Any

from route_impact.daily import is_complete


def _counts(payload: dict[str, Any]) -> dict[str, Any]:
    metrics = payload["metrics"]
    return {
        "risk": payload["risk"]["level"],
        "broken": metrics["broken"],
        "slowed": metrics["slowed"],
        "rerouted": metrics["rerouted"],
        "trips_total": metrics["trips_total"],
    }


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_index(results_dir: Path) -> dict[str, list[dict[str, Any]]]:
    """List complete days newest first, then samples by id."""
    days = [
        {"date": directory.name, **_counts(_read(directory / "impact.json"))}
        for directory in sorted(results_dir.iterdir(), reverse=True)
        if directory.is_dir() and is_complete(directory)
    ]
    samples = []
    samples_dir = results_dir / "samples"
    for directory in sorted(samples_dir.iterdir()) if samples_dir.is_dir() else []:
        if (directory / "impact.geojson").is_file():
            sample = _read(directory / "sample.json")
            samples.append(
                {
                    "id": directory.name,
                    "title": sample["title"],
                    "note": sample["note"],
                    **_counts(_read(directory / "impact.json")),
                }
            )
    return {"days": days, "samples": samples}


def main(argv: list[str] | None = None) -> int:
    """Write the index; the Pages job runs this so it can't drift from results/."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results_dir", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args(argv)
    index = build_index(args.results_dir)
    args.output.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
