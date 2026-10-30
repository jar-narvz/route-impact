"""Freeze P2d's seeded browser/oracle checks from the shipped export."""

import argparse
import json
import random
from pathlib import Path
from typing import Any

from route_impact.playground_oracle import load_export


def verification_set(directory: Path, seed: int) -> dict[str, Any]:
    """Choose distinct baseline-used OSM ways, sorted before seeded sampling."""
    export = load_export(directory)
    presets = export.meta["presets"]
    cases: list[dict[str, Any]] = [
        {
            "id": "bay_bridge_live",
            "weapon": "stomp",
            "way_ids": presets["bay_bridge"]["ids"],
            "purpose": "Live compound deletion matching the Bay Bridge preset.",
        },
        {
            "id": "university_ramp_live",
            "weapon": "flip",
            "way_id": presets["university_ramp"]["ids"][0],
            "purpose": "Live reversal matching the University Avenue ramp preset.",
        },
    ]
    candidates = sorted({int(export.way_osm_id[export.edge_way[e]]) for e in export.path_edges})
    for index, way in enumerate(random.Random(seed).sample(candidates, 10), 1):
        cases.append(
            {
                "id": f"stomp_{index:02d}",
                "weapon": "stomp",
                "way_id": way,
                "purpose": "Seeded deletion of a way used by a baseline trip.",
            }
        )
    stress_path = Path(__file__).resolve().parents[1] / "results/playground/stress_set.json"
    stress = json.loads(stress_path.read_text(encoding="utf-8"))
    by_id = {case["id"]: case for case in stress["cases"]}
    for name in ("bay_bridge_toll_plaza_500", "sf_financial_500", "sf_union_square_500"):
        case = by_id[name]
        cases.append({key: case[key] for key in ("id", "weapon", "lat", "lon", "purpose")})
        cases[-1]["radius_m"] = 500
    return {
        "seed": seed,
        "snapshot": export.meta["snapshot"],
        "note": "Frozen P2d checks: live presets, baseline-used Stomps, and stress Meteors.",
        "cases": cases,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=2027)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = verification_set(args.data, args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
