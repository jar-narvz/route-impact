"""Extract a snapshot with two OSM scans and reference-completeness validation."""

import tomllib
from pathlib import Path

import duckdb


def _load_speeds(path: Path) -> list[tuple[str, float]]:
    with path.open("rb") as source:
        speeds = tomllib.load(source)["speeds_mph"]
    return [(highway, float(mph) * 1.609344) for highway, mph in speeds.items()]


def _check_references(connection: duckdb.DuckDBPyConnection) -> None:
    missing = """
        SELECT node_id FROM referenced_nodes
        WHERE node_id NOT IN (SELECT node_id FROM road_nodes)
    """
    count = connection.execute(f"SELECT COUNT(*) FROM ({missing})").fetchone()[0]
    if count:
        examples = connection.execute(f"{missing} ORDER BY node_id LIMIT 10").fetchall()
        raise ValueError(
            f"{count} missing node references; example ids: {[row[0] for row in examples]}"
        )


def extract(
    pbf: Path,
    out_db: Path,
    *,
    threads: int = 2,
    memory_limit: str = "2GB",
    temp_directory: Path | None = None,
    speeds_path: Path | None = None,
) -> Path:
    """Build roads, road_nodes and places; load the installed extension offline.

    The output must not already contain these tables. Failed builds roll back all
    persistent tables. SQL/config paths are relative to this source checkout.
    """
    root = Path(__file__).resolve().parents[2]
    pbf = Path(pbf).resolve(strict=True)
    out_db = Path(out_db)
    out_db.parent.mkdir(parents=True, exist_ok=True)
    spill = temp_directory if temp_directory is not None else out_db.parent / f".{out_db.stem}-tmp"
    spill = Path(spill).resolve()
    spill.mkdir(parents=True, exist_ok=True)
    speeds = _load_speeds(speeds_path if speeds_path is not None else root / "config/speeds.toml")
    with duckdb.connect(
        str(out_db),
        config={"threads": threads, "memory_limit": memory_limit, "temp_directory": str(spill)},
    ) as connection:
        connection.execute("LOAD spatial")
        connection.execute("BEGIN TRANSACTION")
        try:
            # CREATE VIEW cannot bind a filename parameter; escape it as a SQL literal.
            filename = str(pbf).replace("'", "''")
            connection.execute(
                f"CREATE TEMP VIEW osm_input AS SELECT * FROM ST_ReadOSM('{filename}')"
            )
            connection.execute(
                "CREATE TEMP TABLE default_speeds (highway VARCHAR, speed_kph DOUBLE)"
            )
            connection.executemany("INSERT INTO default_speeds VALUES (?, ?)", speeds)
            for name in ("drivable.sql", "build_tables.sql"):
                connection.execute((root / "sql/extract" / name).read_text())
            _check_references(connection)
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
    return out_db
