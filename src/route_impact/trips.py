"""Generate fixed coordinate trips, keeping city and local sampling rules here."""

import csv
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

import duckdb
import numpy as np

from route_impact.extract import extract
from route_impact.graph import build_graph

MIN_POPULATION = 50_000
BOX_MIN_LAT = 36.2
BOX_MAX_LAT = 41.7
BOX_MAX_LON = -120.3
BOX = (BOX_MIN_LAT, BOX_MAX_LAT, BOX_MAX_LON)
LOCAL_COUNT = 2_000
LOCAL_MIN_KM = 2.0
LOCAL_MAX_KM = 30.0
EARTH_RADIUS_KM = 6371.0088

Node = tuple[int, float, float]
Place = tuple[int, float, float, int | None]
Bounds = tuple[float, float, float]


@dataclass(frozen=True)
class Trip:
    origin: Node
    destination: Node
    weight: int


def filter_places(
    places: Sequence[Place], *, min_population: int = MIN_POPULATION, box: Bounds = BOX
) -> list[Place]:
    """Return cities ordered by node id; latitude bounds inclusive, longitude strict."""
    min_lat, max_lat, max_lon = box
    return sorted(
        (
            p
            for p in places
            if p[3] is not None
            and p[3] >= min_population
            and min_lat <= p[1] <= max_lat
            and p[2] < max_lon
        ),
        key=lambda p: p[0],
    )


def intercity_trips(places: Sequence[Place]) -> list[Trip]:
    """All ordered city pairs with integer gravity weights, without snapping."""
    ordered = sorted(places, key=lambda p: p[0])
    return [
        Trip(a[:3], b[:3], int(a[3]) * int(b[3])) for a in ordered for b in ordered if a[0] != b[0]
    ]


def local_trips(
    nodes: Sequence[Node],
    *,
    seed: int,
    count: int = LOCAL_COUNT,
    min_km: float = LOCAL_MIN_KM,
    max_km: float = LOCAL_MAX_KM,
) -> list[Trip]:
    """Sample uniformly over valid ordered pairs without replacement.

    Reject uniform index draws outside the inclusive distance range, self-pairs,
    and previously accepted pairs. Preserve draw order and stop after 100 batches
    of 100,000 draws if the requested count cannot be filled.
    """
    if count < 0 or not 0 <= min_km <= max_km or not np.isfinite(max_km):
        raise ValueError("count must be nonnegative and distances finite with 0 <= min <= max")
    ordered = sorted(nodes, key=lambda n: n[0])
    if count == 0:
        return []
    if count > len(ordered) * (len(ordered) - 1):
        raise ValueError("Not enough distinct ordered node pairs for requested local count")
    coords = np.radians([(lat, lon) for _, lat, lon in ordered])
    rng = np.random.default_rng(seed)
    seen: set[tuple[int, int]] = set()
    trips = []
    for _ in range(100):
        pairs = rng.integers(len(ordered), size=(100_000, 2))
        a, b = coords[pairs[:, 0]], coords[pairs[:, 1]]
        delta = b - a
        hav = np.sin(delta[:, 0] / 2) ** 2 + (
            np.cos(a[:, 0]) * np.cos(b[:, 0]) * np.sin(delta[:, 1] / 2) ** 2
        )
        distances = 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(hav, 0, 1)))
        valid = (pairs[:, 0] != pairs[:, 1]) & (distances >= min_km) & (distances <= max_km)
        for o, d in pairs[valid].tolist():
            if (o, d) in seen:
                continue
            seen.add((o, d))
            trips.append(Trip(ordered[o], ordered[d], 1))
            if len(trips) == count:
                return trips
    raise ValueError(f"Could only sample {len(trips)} of {count} local trips after 100 batches")


def _write_csv(out: Path, intercity: Sequence[Trip], local: Sequence[Trip]) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as target:
        writer = csv.writer(target, lineterminator="\n")
        writer.writerow(["trip_id", "kind", "o_lat", "o_lon", "d_lat", "d_lon", "weight"])
        for prefix, kind, trips in (("ic", "intercity", intercity), ("lo", "local", local)):
            for index, trip in enumerate(trips, 1):
                coordinates = (*trip.origin[1:], *trip.destination[1:])
                writer.writerow(
                    [f"{prefix}-{index:05d}", kind]
                    + [f"{value:.6f}" for value in coordinates]
                    + [int(trip.weight)]
                )


def generate(
    pbf: Path,
    out: Path,
    *,
    seed: int,
    min_population: int = MIN_POPULATION,
    box: Bounds = BOX,
    local_count: int = LOCAL_COUNT,
    min_km: float = LOCAL_MIN_KM,
    max_km: float = LOCAL_MAX_KM,
    threads: int = 2,
    memory_limit: str = "2GB",
) -> None:
    """Extract into a fresh temporary database and write deterministic coordinate trips."""
    with TemporaryDirectory(prefix="route-impact-trips-") as directory:
        db = extract(
            pbf, Path(directory) / "snapshot.duckdb", threads=threads, memory_limit=memory_limit
        )
        lscc = build_graph(db, threads=threads, memory_limit=memory_limit).lscc()
        with duckdb.connect(
            str(db), config={"threads": threads, "memory_limit": memory_limit}
        ) as connection:
            places = filter_places(
                connection.execute("SELECT node_id, lat, lon, population FROM places").fetchall(),
                min_population=min_population,
                box=box,
            )
            nodes = [
                row
                for row in connection.execute(
                    "SELECT node_id, lat, lon FROM road_nodes "
                    "WHERE lat BETWEEN ? AND ? AND lon < ? ORDER BY node_id",
                    list(box),
                ).fetchall()
                if row[0] in lscc
            ]
        intercity = intercity_trips(places)
        local = local_trips(nodes, seed=seed, count=local_count, min_km=min_km, max_km=max_km)
        _write_csv(out, intercity, local)
    print(
        f"snapshot={pbf} seed={seed} n_places={len(places)} "
        f"intercity={len(intercity)} local={len(local)} lscc_vertices_in_box={len(nodes)}"
    )
