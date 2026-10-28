"""Contract snapshot roads into directed runs and route with bounded origin batches."""

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from math import inf, isfinite
from pathlib import Path

import duckdb
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra


@dataclass(frozen=True, slots=True)
class Segment:
    a: int
    b: int
    way_id: int
    seq: int
    length_m: float
    seconds: float


@dataclass(frozen=True, slots=True)
class Edge:
    u: int
    v: int
    seconds: float
    segments: tuple[Segment, ...]

    @property
    def rank(self) -> tuple[float, int, int]:
        first = self.segments[0]
        return self.seconds, first.way_id, first.seq


@dataclass(slots=True)
class Graph:
    vertices: tuple[int, ...]
    indices: dict[int, int]
    edges: list[Edge]
    winning_edges: dict[tuple[int, int], Edge]
    matrix: csr_matrix
    fallback_speed_count: int

    def lscc(self) -> set[int]:
        """Return the largest strong component, breaking size ties by smallest node."""
        if not self.vertices:
            return set()
        _, labels = connected_components(self.matrix, directed=True, connection="strong")
        counts = np.bincount(labels)
        largest = counts.max()
        label = next(labels[i] for i in range(len(labels)) if counts[labels[i]] == largest)
        return {node for node, group in zip(self.vertices, labels, strict=True) if group == label}


@dataclass(frozen=True, slots=True)
class Route:
    seconds: float
    segments: tuple[Segment, ...] | None


def _validate_speeds(connection: duckdb.DuckDBPyConnection) -> int:
    invalid = connection.execute(
        "SELECT COUNT(*) FROM roads "
        "WHERE speed_kph IS NULL OR speed_kph <= 0 OR NOT ISFINITE(speed_kph)"
    ).fetchone()[0]
    if invalid:
        raise ValueError(f"{invalid} roads have NULL, non-positive or non-finite speed_kph")
    # Match Step 3's parser exactly: unsupported units/spacing also use defaults.
    return connection.execute(
        """
        SELECT COUNT(*) FROM roads WHERE maxspeed_raw IS NOT NULL AND NOT COALESCE(
            REGEXP_FULL_MATCH(TRIM(maxspeed_raw), '[0-9]+(\\.[0-9]+)?( mph)?')
            AND TRY_CAST(REGEXP_EXTRACT(TRIM(maxspeed_raw), '[0-9]+(\\.[0-9]+)?')
                AS DOUBLE) > 0
            AND ISFINITE(TRY_CAST(REGEXP_EXTRACT(TRIM(maxspeed_raw), '[0-9]+(\\.[0-9]+)?')
                AS DOUBLE)), FALSE)
        """
    ).fetchone()[0]


def _rows(connection: duckdb.DuckDBPyConnection) -> Iterator[tuple]:
    cursor = connection.execute(
        "SELECT a, b, way_id, seq, length_m, seconds, oneway "
        "FROM forward_segments ORDER BY way_id, seq"
    )
    while rows := cursor.fetchmany(8192):
        yield from rows


def _edges(connection: duckdb.DuckDBPyConnection, vertices: set[int]) -> list[Edge]:
    edges = []
    run: list[Segment] = []
    for a, b, way, seq, length, seconds, oneway in _rows(connection):
        run.append(Segment(a, b, way, seq, length, seconds))
        if b not in vertices:
            continue
        elapsed = sum(segment.seconds for segment in run)
        if oneway != -1:
            edges.append(Edge(run[0].a, b, elapsed, tuple(run)))
        if oneway != 1:
            reverse = tuple(
                Segment(s.b, s.a, s.way_id, s.seq, s.length_m, s.seconds) for s in reversed(run)
            )
            edges.append(Edge(b, run[0].a, elapsed, reverse))
        run = []
    return edges


def build_graph(db: Path, *, threads: int = 2, memory_limit: str = "2GB") -> Graph:
    """Build from extracted roads/road_nodes without persisting graph tables."""
    with duckdb.connect(
        str(db), config={"threads": threads, "memory_limit": memory_limit}
    ) as connection:
        fallback_count = _validate_speeds(connection)
        vertices = tuple(
            row[0]
            for row in connection.execute(
                """
                WITH refs AS (SELECT UNNEST(node_refs) AS node_id FROM roads)
                SELECT node_id FROM refs GROUP BY node_id HAVING COUNT(*) >= 2
                UNION SELECT node_refs[1] FROM roads WHERE ARRAY_LENGTH(node_refs) > 0
                UNION SELECT node_refs[-1] FROM roads WHERE ARRAY_LENGTH(node_refs) > 0
                ORDER BY node_id
                """
            ).fetchall()
        )
        sql = Path(__file__).resolve().parents[2] / "sql/extract/segments.sql"
        connection.execute(sql.read_text())
        edges = _edges(connection, set(vertices))
    winners: dict[tuple[int, int], Edge] = {}
    for edge in edges:
        key = edge.u, edge.v
        if key not in winners or edge.rank < winners[key].rank:
            winners[key] = edge
    indices = {node: index for index, node in enumerate(vertices)}
    rows, cols, costs = [], [], []
    for (u, v), edge in winners.items():
        rows.append(indices[u])
        cols.append(indices[v])
        costs.append(edge.seconds)
    matrix = csr_matrix((costs, (rows, cols)), shape=(len(vertices), len(vertices)))
    return Graph(vertices, indices, edges, winners, matrix, fallback_count)


def _path(graph: Graph, predecessors: np.ndarray, source: int, target: int) -> tuple[Segment, ...]:
    runs = []
    current = target
    while current != source:
        previous = int(predecessors[graph.indices[current]])
        if previous < 0:
            raise RuntimeError("Finite distance has no predecessor")
        parent = graph.vertices[previous]
        runs.append(graph.winning_edges[parent, current].segments)
        current = parent
    return tuple(segment for run in reversed(runs) for segment in run)


def shortest(
    graph: Graph, sources: Iterable[int], targets: Iterable[int], batch: int = 32
) -> dict[tuple[int, int], Route]:
    """Return the requested Cartesian product; unreachable routes are inf/None.

    Endpoints must be graph vertices (OSM ids), not snapshot-local matrix indices.
    Source-to-self returns zero seconds and an empty segment tuple.
    """
    if batch <= 0:
        raise ValueError("batch must be positive")
    origins, destinations = list(dict.fromkeys(sources)), list(dict.fromkeys(targets))
    for node in origins + destinations:
        if node not in graph.indices:
            raise ValueError(f"Node {node} is not a graph vertex")
    result = {}
    if not destinations:
        return result
    for offset in range(0, len(origins), batch):
        chunk = origins[offset : offset + batch]
        distances, predecessors = dijkstra(
            graph.matrix,
            directed=True,
            indices=[graph.indices[n] for n in chunk],
            return_predecessors=True,
        )
        for row, source in enumerate(chunk):
            for target in destinations:
                seconds = float(distances[row, graph.indices[target]])
                path = (
                    _path(graph, predecessors[row], source, target) if isfinite(seconds) else None
                )
                result[source, target] = Route(seconds if path is not None else inf, path)
        del distances, predecessors
    return result


def route_pairs(
    graph: Graph, pairs: Iterable[tuple[int, int]], batch: int = 32
) -> dict[tuple[int, int], Route]:
    """Route only requested pairs, batching Dijkstra by distinct origin."""
    if batch <= 0:
        raise ValueError("batch must be positive")
    grouped: dict[int, list[int]] = {}
    for source, target in dict.fromkeys(pairs):
        for node in (source, target):
            if node not in graph.indices:
                raise ValueError(f"Node {node} is not a graph vertex")
        grouped.setdefault(source, []).append(target)
    origins = list(grouped)
    result = {}
    for offset in range(0, len(origins), batch):
        chunk = origins[offset : offset + batch]
        distances, predecessors = dijkstra(
            graph.matrix,
            directed=True,
            indices=[graph.indices[n] for n in chunk],
            return_predecessors=True,
        )
        for row, source in enumerate(chunk):
            for target in grouped[source]:
                seconds = float(distances[row, graph.indices[target]])
                path = (
                    _path(graph, predecessors[row], source, target) if isfinite(seconds) else None
                )
                result[source, target] = Route(seconds if path is not None else inf, path)
        del distances, predecessors
    return result


def restored_seconds(
    graph: Graph,
    restored: list[Edge],
    touching: dict[int, list[Edge]],
    origin: int | None,
    destination: int | None,
    limit: float = inf,
) -> float:
    """Route once over NEW union OLD, reconnecting compressed interior nodes.

    Union is deliberately permissive: restoring a flipped one-way also retains
    its NEW direction. Full NEW runs remain valid alongside their split runs.
    Only small candidate edge sets are walked in Python; CSR copying is O(E).
    """
    if origin is None or destination is None:
        return inf
    added_nodes = sorted({n for e in restored for n in (e.u, e.v)} - graph.indices.keys())
    extra_indices = {node: len(graph.vertices) + i for i, node in enumerate(added_nodes)}

    def index(node: int) -> int:
        return graph.indices[node] if node in graph.indices else extra_indices[node]

    if any(n not in graph.indices and n not in extra_indices for n in (origin, destination)):
        return inf
    size = len(graph.vertices) + len(added_nodes)
    matrix = csr_matrix(
        (
            graph.matrix.data.copy(),
            graph.matrix.indices.copy(),
            np.concatenate(
                (graph.matrix.indptr, np.full(len(added_nodes), graph.matrix.indptr[-1]))
            ),
        ),
        shape=(size, size),
    )
    extras: dict[tuple[int, int], float] = {}

    def add(u: int, v: int, seconds: float) -> None:
        pair = index(u), index(v)
        extras[pair] = min(extras.get(pair, inf), seconds)

    split_edges = {id(e): e for n in added_nodes for e in touching.get(n, [])}
    for edge in split_edges.values():
        start, seconds = edge.u, 0.0
        for segment in edge.segments:
            seconds += segment.seconds
            if segment.b in extra_indices or segment.b == edge.v:
                add(start, segment.b, seconds)
                start, seconds = segment.b, 0.0
    for edge in restored:
        add(edge.u, edge.v, edge.seconds)
    # Locate existing entries explicitly: absent entries and zero-cost edges
    # must remain distinguishable. Batch assignment avoids repeated CSR copies.
    rows, cols, costs = [], [], []
    for (row, col), cost in extras.items():
        lo, hi = matrix.indptr[row : row + 2]
        position = np.searchsorted(matrix.indices[lo:hi], col) + lo
        if position < hi and matrix.indices[position] == col:
            matrix.data[position] = min(matrix.data[position], cost)
        else:
            rows.append(row)
            cols.append(col)
            costs.append(cost)
    if rows:
        # Sparse addition can drop explicit zero entries, so concatenate only
        # the small additions and convert once; pairs are disjoint here.
        base = matrix.tocoo()
        matrix = csr_matrix(
            (
                np.concatenate((base.data, costs)),
                (np.concatenate((base.row, rows)), np.concatenate((base.col, cols))),
            ),
            shape=(size, size),
        )
    return float(
        dijkstra(matrix, directed=True, indices=index(origin), limit=limit)[index(destination)]
    )
