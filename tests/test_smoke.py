"""Offline smoke test; make setup must have installed spatial already."""

import duckdb
import scipy


def test_spatial_query() -> None:
    """Load the cached spatial extension and execute a trivial query."""
    assert scipy.__version__
    with duckdb.connect(":memory:", config={"memory_limit": "1GB", "threads": 1}) as connection:
        connection.execute("LOAD spatial")
        assert connection.execute("SELECT 1 + 1").fetchone() == (2,)
