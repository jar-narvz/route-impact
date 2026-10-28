"""Inject reproducible table mutations and evaluate routing and attribution."""

import json
import os
import random
import re
import shutil
import tomllib
from dataclasses import asdict, dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

import duckdb

from route_impact.extract import _load_speeds, extract
from route_impact.graph import Graph, Route, build_graph, route_pairs
from route_impact.impact import (
    Snapper,
    compare_trips,
    impact_from_graphs,
    prepare_trips,
    read_trips,
    serialisable,
    snapshot_nodes,
)
from route_impact.report import write_report
from route_impact.risk import Thresholds, load_thresholds
from route_impact.rootcause import WayInfo, load_way_info


@dataclass(frozen=True)
class Fault:
    type: str
    way_id: int | None = None
    node_id: int | None = None

    def __post_init__(self) -> None:
        if self.type not in fault_types():
            raise ValueError(f"Unknown fault type: {self.type}")
        node = self.type == "disconnect_node"
        if (self.node_id is None) == node or (self.way_id is None) != node:
            raise ValueError("Fault requires exactly its way_id or node_id")

    @property
    def expected_edit(self) -> str:
        kind = (
            "node_disconnected"
            if self.type == "disconnect_node"
            else "way_deleted"
            if self.type in {"delete_way", "delete_bridge"}
            else "way_changed"
        )
        return f"{kind}/{self.node_id if self.node_id is not None else self.way_id}"


def fault_types() -> tuple[str, ...]:
    return (
        "delete_way",
        "delete_bridge",
        "flip_oneway",
        "add_oneway",
        "disconnect_node",
        "bad_maxspeed",
        "downgrade_class",
    )


def _eligible(fault: Fault, roads: dict[int, tuple], residential_speed: float) -> bool:
    if fault.node_id is not None:
        ways = [w for w in sorted(roads) if fault.node_id in roads[w][2]]
        return len(ways) >= 2 and any(n != fault.node_id for n in roads[ways[0]][2])
    if fault.way_id not in roads:
        return False
    oneway, tags, _, speed = roads[fault.way_id]
    return {
        "delete_bridge": tags.get("bridge") not in {None, "no", "false", "0"},
        "flip_oneway": oneway != 0,
        "add_oneway": oneway == 0,
        "downgrade_class": residential_speed < speed,
        "bad_maxspeed": speed > 5 * 1.609344,
    }.get(fault.type, True)


def _roads(connection: duckdb.DuckDBPyConnection, fault: Fault | None = None) -> dict[int, tuple]:
    predicate, parameters = "", []
    if fault is not None:
        if fault.node_id is not None:
            predicate, parameters = " WHERE LIST_CONTAINS(node_refs, ?)", [fault.node_id]
        else:
            predicate, parameters = " WHERE way_id = ?", [fault.way_id]
    return {
        way: (oneway, dict(tags), refs, speed)
        for way, oneway, tags, refs, speed in connection.execute(
            "SELECT way_id, oneway, tags, node_refs, speed_kph FROM roads"
            + predicate
            + " ORDER BY way_id",
            parameters,
        ).fetchall()
    }


def apply_faults(snapshot_db: Path, faults: list[Fault], out_db: Path) -> Path:
    """Copy the snapshot and atomically apply the validated ordered SQL catalog."""
    root = Path(__file__).resolve().parents[2]
    out_db.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(snapshot_db, out_db)
    with duckdb.connect(str(out_db), config={"threads": 2, "memory_limit": "2GB"}) as connection:
        connection.execute("BEGIN TRANSACTION")
        try:
            connection.execute(
                "CREATE TEMP TABLE default_speeds(highway VARCHAR, speed_kph DOUBLE)"
            )
            connection.executemany(
                "INSERT INTO default_speeds VALUES (?, ?)",
                _load_speeds(root / "config/speeds.toml"),
            )
            residential_speed = connection.execute(
                "SELECT speed_kph FROM default_speeds WHERE highway = 'residential'"
            ).fetchone()[0]
            for fault in faults:
                if not _eligible(fault, _roads(connection, fault), residential_speed):
                    raise ValueError(f"Ineligible target for {fault}")
                parameters = (
                    {"node_id": fault.node_id}
                    if fault.node_id is not None
                    else {"way_id": fault.way_id}
                )
                sql = (root / "sql/faults" / f"{fault.type}.sql").read_text()
                # DuckDB binds parameters per statement, including DDL statements.
                for statement in connection.extract_statements(sql):
                    names = statement.named_parameters
                    connection.execute(statement, {key: parameters[key] for key in names})
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
    return out_db


def snapshot_path(snapshot: str, data_dir: Path) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_]+", snapshot):
        raise ValueError("snapshot must contain only letters, digits or underscores")
    name = f"norcal-{snapshot}" if re.fullmatch(r"[0-9]{6}", snapshot) else snapshot
    return data_dir / f"{name}.osm.pbf"


@dataclass
class Baseline:
    graph: Graph
    nodes: list[tuple[int, float, float]]
    ways: dict[int, WayInfo]
    routes: dict[tuple[int, int], Route]

    @classmethod
    def load(cls, db: Path, trips: list[dict]) -> "Baseline":
        graph = build_graph(db)
        nodes = snapshot_nodes(db, graph, 2, "2GB")
        lscc = graph.lscc()
        prepared = prepare_trips(trips, Snapper(n for n in nodes if n[0] in lscc))
        routes = route_pairs(
            graph,
            (
                (t["old_origin"], t["old_destination"])
                for t in prepared
                if t["old_origin"] is not None and t["old_destination"] is not None
            ),
        )
        return cls(graph, nodes, load_way_info(db), routes)

    def impact(
        self,
        new_db: Path,
        trips: list[dict],
        thresholds: Thresholds,
        snapshot: str,
        *,
        full: bool = False,
        raw_trips: list[dict] | None = None,
        new_graph: Graph | None = None,
        new_nodes: list[tuple[int, float, float]] | None = None,
        new_ways: dict[int, WayInfo] | None = None,
        timings: dict[str, float] | None = None,
    ) -> dict:
        return impact_from_graphs(
            self.graph,
            self.nodes,
            self.ways,
            new_db,
            trips,
            thresholds,
            old_label=snapshot,
            new_label=f"{snapshot}+what-if",
            full=full,
            old_routes=self.routes,
            raw_trips=raw_trips,
            new_graph=new_graph,
            new_nodes=new_nodes,
            new_ways=new_ways,
            timings=timings,
        )


def _footprint(fault: Fault, ways: dict[int, WayInfo]) -> tuple[set[int], set[int]]:
    """Track the actual modified way as well as a disconnected shared node."""
    if fault.node_id is not None:
        way = min(w for w, info in ways.items() if fault.node_id in info.node_refs)
        return {way}, {fault.node_id}
    return {fault.way_id}, set()


def fault_batches(faults: list[Fault], ways: dict[int, WayInfo]) -> list[list[Fault]]:
    """Preserve order, closing a batch early on a target collision or at ten."""
    batches: list[list[Fault]] = []
    used_ways: set[int] = set()
    used_nodes: set[int] = set()
    for fault in faults:
        touched_ways, touched_nodes = _footprint(fault, ways)
        if (
            not batches
            or len(batches[-1]) == 10
            or used_ways & touched_ways
            or used_nodes & touched_nodes
        ):
            batches.append([])
            used_ways, used_nodes = set(), set()
        batches[-1].append(fault)
        used_ways.update(touched_ways)
        used_nodes.update(touched_nodes)
    return batches


def sample_faults(db: Path, baseline: Baseline, n: int, seed: int) -> list[Fault]:
    """Round-robin eligible types over OLD path targets, stratified by class."""
    if n <= 0:
        raise ValueError("n must be positive")
    with duckdb.connect(str(db), config={"threads": 2, "memory_limit": "2GB"}) as connection:
        roads = _roads(connection)
    residential_speed = dict(
        _load_speeds(Path(__file__).resolve().parents[2] / "config/speeds.toml")
    )["residential"]
    segments = [s for r in baseline.routes.values() for s in (r.segments or ())]
    ways = sorted({s.way_id for s in segments})
    nodes = sorted({node for s in segments for node in (s.a, s.b)})
    shared: dict[int, list[int]] = {node: [] for node in nodes}
    for way, (_, _, refs, _) in roads.items():
        for node in set(refs):
            if node in shared:
                shared[node].append(way)
    path_membership = {(s.way_id, node) for s in segments for node in (s.a, s.b)}

    def footprint(fault: Fault) -> int:
        return shared[fault.node_id][0] if fault.node_id is not None else fault.way_id

    def eligible(fault: Fault) -> bool:
        if fault.node_id is None:
            return _eligible(fault, roads, residential_speed)
        ways = shared[fault.node_id]
        return (
            len(ways) >= 2
            and (ways[0], fault.node_id) in path_membership
            and any(node != fault.node_id for node in roads[ways[0]][2])
        )

    rng = random.Random(seed)
    pools = {}
    for kind in fault_types():
        candidates = [
            Fault(kind, node_id=target) if kind == "disconnect_node" else Fault(kind, way_id=target)
            for target in (nodes if kind == "disconnect_node" else ways)
        ]
        groups: dict[str, list[Fault]] = {}
        for fault in candidates:
            if eligible(fault):
                way = footprint(fault)
                groups.setdefault(roads[way][1].get("highway", "ferry"), []).append(fault)
        classes = sorted(groups)
        rng.shuffle(classes)
        for group in groups.values():
            rng.shuffle(group)
        ordered = []
        while any(groups.values()):
            for highway in classes:
                if groups[highway]:
                    ordered.append(groups[highway].pop())
        if kind == "delete_way":
            # Leave bridge targets for the more restrictive type that follows.
            ordered.sort(
                key=lambda f: _eligible(
                    Fault("delete_bridge", way_id=f.way_id), roads, residential_speed
                )
            )
        pools[kind] = ordered
    selected: list[Fault] = []
    used: set[tuple[str, int]] = set()
    modified_ways: set[int] = set()
    while len(selected) < n:
        before = len(selected)
        for kind in fault_types():
            while pools[kind]:
                fault = pools[kind].pop(0)
                target = (
                    ("node", fault.node_id) if fault.node_id is not None else ("way", fault.way_id)
                )
                touched = footprint(fault)
                if target not in used and touched not in modified_ways:
                    modified_ways.add(touched)
                    used.add(target)
                    selected.append(fault)
                    break
            if len(selected) == n:
                break
        if len(selected) == before:
            raise ValueError(f"Only {len(selected)} distinct eligible targets available for n={n}")
    return selected


def top_confirmed(payload: dict, trip: dict) -> str | None:
    confirmed = {e["edit"] for e in trip["edits"] if e["label"] == "confirmed"}
    return next((c["edit"] for c in payload["culprits"] if c["edit"] in confirmed), None)


def score_payload(
    payload: dict, faults: list[Fault], *, single: bool
) -> dict[str, tuple[int, int]]:
    """Score counterfactual labels against injected edits independently of rank."""
    expected = {f.expected_edit for f in faults}
    correct = total = joint_correct = joint_total = 0
    for trip in payload["trips"]:
        if trip["cause"] == "joint":
            joint_total += 1
            joint_correct += bool(trip["edits"]) and all(
                e["edit"] in expected for e in trip["edits"]
            )
            continue
        total += 1
        # Confirmed labels already mean restoration alone recovers this trip.
        truth = {
            e["edit"]
            for e in trip["edits"]
            if e["label"] == "confirmed"
            and all(member in expected for member in e.get("members", [e["edit"]]))
        }
        top = top_confirmed(payload, trip)
        correct += top is not None and top in truth
    return {
        "root_cause_single" if single else "root_cause_batch": (correct, total),
        "root_cause_joint": (joint_correct, joint_total),
    }


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(serialisable(value), sort_keys=True, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def _read_progress(path: Path, groups: list[list[Fault]], full_check_every: int) -> dict[int, dict]:
    """Reject ambiguous or incompatible checkpoints before executing any runs."""
    records = {}
    if not path.exists():
        return records
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        try:
            record = json.loads(line)
            index = record["index"]
            if type(index) is not int or not 0 <= index < len(groups) or index in records:
                raise ValueError("duplicate or out-of-range index")
            if record["faults"] != [asdict(f) for f in groups[index]]:
                raise ValueError("faults do not match")
            if record["full_checked"] is not (index % full_check_every == 0):
                raise ValueError("full-check schedule does not match")
            records[index] = record
        except (ValueError, KeyError, TypeError) as error:
            raise ValueError(f"Invalid progress.jsonl line {line_number}: {error}") from error
    return records


def _progress_scores(records: dict[int, dict], full_check_every: int) -> dict:
    """Reduce only persisted run contributions, in suite order."""
    counts = {
        key: [0, 0]
        for key in (
            "incremental_equals_full",
            "root_cause_single",
            "root_cause_batch",
            "root_cause_joint",
            "impact_rate",
        )
    }
    runs = []
    run_seconds = []
    for _, record in sorted(records.items()):
        for key, (correct, total) in record["contributions"].items():
            counts[key][0] += correct
            counts[key][1] += total
        runs.append(
            {
                "faults": record["faults"],
                "single": record["single"],
                "full_checked": record["full_checked"],
                "incremental_equals_full": record["equal"],
                "affected_trip_ids": record["affected_trip_ids"],
            }
        )
        run_seconds.append(record["seconds"])
    scores = {
        key: {
            "correct": correct,
            "denominator": total,
            "percent": 100 * correct / total if total else None,
        }
        for key, (correct, total) in counts.items()
    }
    scores["impact_rate"]["description"] = "Network redundancy, not accuracy"
    scores["full_check_every"] = full_check_every
    scores["runs"] = runs

    def mean(single: bool) -> float:
        totals = [
            t["total"] for r, t in zip(runs, run_seconds, strict=True) if r["single"] == single
        ]
        return sum(totals) / len(totals) if totals else 0.0

    setup_seconds = (
        records[min(records)]["setup_seconds"] if records else {"extract": 0.0, "baseline": 0.0}
    )
    scores["seconds"] = {
        **setup_seconds,
        "runs": run_seconds,
        "mean_single": mean(True),
        "mean_batch": mean(False),
    }
    return scores


def evaluate_faults(
    db: Path,
    baseline: Baseline,
    trips: list[dict],
    thresholds: Thresholds,
    faults: list[Fault],
    directory: Path,
    snapshot: str,
    *,
    full_check_every: int = 10,
    extract_seconds: float = 0.0,
    baseline_seconds: float = 0.0,
) -> dict:
    """Checkpoint each run and sample full routing checks in seeded suite order."""
    if full_check_every < 1:
        raise ValueError("full_check_every must be at least 1")
    directory.mkdir(parents=True, exist_ok=True)
    progress = directory / "progress.jsonl"
    singles = [[fault] for fault in faults]
    batches = fault_batches(faults, baseline.ways)
    completed = _read_progress(progress, singles + batches, full_check_every)
    with TemporaryDirectory(prefix="route-faults-") as temporary:
        new_db = Path(temporary) / "fault.duckdb"
        for index, group in enumerate(singles + batches):
            if index in completed:
                continue
            start = perf_counter()
            timing = {}
            if new_db.exists():
                new_db.unlink()
            apply_faults(db, group, new_db)
            timing["apply"] = perf_counter() - start
            graph_start = perf_counter()
            incremental_trips: list[dict] = []
            new_graph = build_graph(new_db)
            new_nodes = snapshot_nodes(new_db, new_graph, 2, "2GB")
            new_ways = load_way_info(new_db)
            timing["new_graph"] = perf_counter() - graph_start
            payload = baseline.impact(
                new_db,
                trips,
                thresholds,
                snapshot,
                raw_trips=incremental_trips,
                new_graph=new_graph,
                new_nodes=new_nodes,
                new_ways=new_ways,
                timings=timing,
            )
            full_checked = index % full_check_every == 0
            equal = None
            timing["compare_full"] = 0.0
            if full_checked:
                full_start = perf_counter()
                full_trips, _ = compare_trips(
                    baseline.graph,
                    new_graph,
                    baseline.nodes,
                    new_nodes,
                    trips,
                    thresholds,
                    full=True,
                    old_routes=baseline.routes,
                )
                timing["compare_full"] = perf_counter() - full_start
                # Compare raw records; rerouted describes execution, not results.
                equal = [
                    {k: v for k, v in t.items() if k != "rerouted"} for t in incremental_trips
                ] == [{k: v for k, v in t.items() if k != "rerouted"} for t in full_trips]
            single = index < len(singles)
            contributions = score_payload(payload, group, single=single)
            if full_checked:
                contributions["incremental_equals_full"] = (int(equal), 1)
            if single:
                contributions["impact_rate"] = (int(bool(payload["trips"])), 1)
            timing["total"] = perf_counter() - start
            record = {
                "index": index,
                "faults": [asdict(f) for f in group],
                "single": single,
                "full_checked": full_checked,
                "equal": equal,
                "contributions": contributions,
                "affected_trip_ids": [trip["trip_id"] for trip in payload["trips"]],
                "seconds": timing,
                "setup_seconds": {"extract": extract_seconds, "baseline": baseline_seconds},
            }
            with progress.open("a", encoding="utf-8") as output:
                output.write(json.dumps(record, sort_keys=True, allow_nan=False) + "\n")
                output.flush()
                os.fsync(output.fileno())
    scores = _progress_scores(
        _read_progress(progress, singles + batches, full_check_every), full_check_every
    )
    _write_json(directory / "scores.json", scores)
    return scores


def run_suite(
    snapshot: str,
    *,
    n: int,
    seed: int,
    full_check_every: int = 10,
    fresh: bool = False,
    data_dir: Path = Path("data"),
    trips_path: Path = Path("config/trips.csv"),
    results_dir: Path = Path("results"),
    thresholds_path: Path = Path("config/thresholds.toml"),
) -> dict:
    if full_check_every < 1:
        raise ValueError("full_check_every must be at least 1")
    trips = read_trips(trips_path)
    thresholds = load_thresholds(thresholds_path)
    with TemporaryDirectory(prefix="route-suite-") as temporary:
        start = perf_counter()
        db = extract(snapshot_path(snapshot, data_dir), Path(temporary) / "old.duckdb")
        extract_seconds = perf_counter() - start
        start = perf_counter()
        baseline = Baseline.load(db, trips)
        baseline_seconds = perf_counter() - start
        faults = sample_faults(db, baseline, n, seed)
        directory = results_dir / "faults" / snapshot
        manifest = {
            "seed": seed,
            "N": n,
            "faults": [asdict(f) for f in faults],
            "full_check_every": full_check_every,
        }
        if fresh:
            for name in ("faults.json", "progress.jsonl", "scores.json"):
                (directory / name).unlink(missing_ok=True)
        if (directory / "progress.jsonl").exists():
            manifest_path = directory / "faults.json"
            if not manifest_path.exists() or json.loads(manifest_path.read_text()) != manifest:
                raise ValueError("Resume faults.json does not match this invocation; use --fresh")
        else:
            _write_json(directory / "faults.json", manifest)
        return evaluate_faults(
            db,
            baseline,
            trips,
            thresholds,
            faults,
            directory,
            snapshot,
            full_check_every=full_check_every,
            extract_seconds=extract_seconds,
            baseline_seconds=baseline_seconds,
        )


def run_what_if(
    snapshot: str,
    faults: list[Fault],
    *,
    data_dir: Path = Path("data"),
    trips_path: Path = Path("config/trips.csv"),
    thresholds_path: Path = Path("config/thresholds.toml"),
    out: Path | None = None,
) -> dict:
    if not faults:
        raise ValueError("At least one fault is required")
    trips = read_trips(trips_path)
    thresholds = load_thresholds(thresholds_path)
    with TemporaryDirectory(prefix="route-what-if-") as temporary:
        db = extract(snapshot_path(snapshot, data_dir), Path(temporary) / "old.duckdb")
        baseline = Baseline.load(db, trips)
        new_db = apply_faults(db, faults, Path(temporary) / "new.duckdb")
        payload = baseline.impact(new_db, trips, thresholds, snapshot)
        if out is not None:
            _write_json(out / "impact.json", payload)
            write_report(payload, out, db, new_db)
        for fault in faults:
            node = fault.node_id is not None
            info = baseline.ways.get(fault.way_id)
            details = (
                f" ({info.tags.get('name', 'unnamed')}, highway={info.tags.get('highway', 'ferry')})"
                if info
                else ""
            )
            print(
                f"Fault: {fault.type.replace('_', ' ')} {fault.node_id if node else fault.way_id}{details}"
            )
        metrics = payload["metrics"]
        print(
            f"Affected: {metrics['intercity']['broken'] + metrics['intercity']['slowed']} intercity · "
            f"{metrics['local']['broken'] + metrics['local']['slowed']} local trips · "
            f"{metrics['gravity_share_affected'] * 100:g}% weighted travel"
        )
        for trip in payload["trips"]:
            print(f"Trip {trip['trip_id']}: {trip['status']}")
        if payload["trips"]:
            worst = max(
                payload["trips"],
                key=lambda t: float("inf") if t["delay_s"] is None else t["delay_s"],
            )
            delay = (
                "unreachable" if worst["delay_s"] is None else f"+{worst['delay_s'] / 60:.1f} min"
            )
            print(f"Worst: {worst['trip_id']} ({worst['kind']})  {delay}")
        else:
            print("Worst: none")
        top = payload["culprits"][0] if payload["culprits"] else None
        matches = top and all(
            member["edit"] in {f.expected_edit for f in faults}
            for member in (top["members"] if top["kind"] == "run" else [top])
        )
        print(
            "Root cause: "
            + (
                f"run {top['edit']}"
                if top and top["kind"] == "run"
                else f"{top['kind'].split('_')[0]} {top['id']}"
                if top
                else "none"
            )
            + (" ✔ (matches injected fault)" if matches else "")
        )
    return payload


def run_demos(
    snapshot: str,
    config: Path = Path("config/demo_faults.toml"),
    results_dir: Path = Path("results"),
) -> None:
    """Run each configured demo with its ordered way or node faults."""
    with config.open("rb") as source:
        demos = tomllib.load(source)["demos"]
    for name, demo in demos.items():
        faults = [Fault(demo["type"], **{demo["target"]: target}) for target in demo["ids"]]
        run_what_if(snapshot, faults, out=results_dir / "faults" / snapshot / f"demo-{name}")
