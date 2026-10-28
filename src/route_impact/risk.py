"""Load provisional thresholds and apply ordered, explicit risk rules."""

import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, fields
from math import isfinite
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Thresholds:
    slow_seconds: float
    high_slow_seconds: float
    high_slowed_share: float
    high_local_broken: int
    snap_fallback_m: float


def load_thresholds(path: Path) -> Thresholds:
    with path.open("rb") as source:
        values = tomllib.load(source)
    for field in fields(Thresholds):
        value = values.get(field.name)
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not isfinite(value)
            or value <= 0
        ):
            raise ValueError(f"{field.name} must be present, finite and positive")
    return Thresholds(**{field.name: values[field.name] for field in fields(Thresholds)})


def risk_level(metrics: Mapping[str, Any], thresholds: Thresholds) -> tuple[str, str]:
    intercity, local = metrics["intercity"], metrics["local"]
    if intercity["broken"] >= 1:
        return "HIGH", f"HIGH: {intercity['broken']} intercity trip broken"
    if metrics["gravity_share_high"] >= thresholds.high_slowed_share:
        return "HIGH", (
            f"HIGH: gravity share {metrics['gravity_share_high']:g} of broken or severely "
            f"slowed intercity trips ≥ {thresholds.high_slowed_share:g}"
        )
    if local["broken"] >= thresholds.high_local_broken:
        return "HIGH", f"HIGH: {local['broken']} local trips broken"
    if metrics["broken"]:
        return "MEDIUM", "MEDIUM: trip broken"
    if intercity["slowed"]:
        return "MEDIUM", "MEDIUM: intercity trip slowed"
    return "LOW", "LOW: no rule fired"


def exit_code(level: str) -> int:
    return {"LOW": 0, "MEDIUM": 0, "HIGH": 1}[level]
