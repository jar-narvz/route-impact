-- Build directed segments from roads and road_nodes using haversine metres.
-- seq is zero-based in the original way, including for reverse segments.
CREATE OR REPLACE TEMP TABLE forward_segments AS
WITH pairs AS (
    SELECT way_id, speed_kph, oneway, i - 1 AS seq,
        node_refs[i] AS a, node_refs[i + 1] AS b
    FROM roads, UNNEST(RANGE(1, ARRAY_LENGTH(node_refs))) AS refs(i)
), lengths AS (
    SELECT p.*, 2 * 6371008.8 * ASIN(SQRT(LEAST(1.0,
        POWER(SIN(RADIANS(nb.lat - na.lat) / 2), 2)
        + COS(RADIANS(na.lat)) * COS(RADIANS(nb.lat))
        * POWER(SIN(RADIANS(nb.lon - na.lon) / 2), 2)
    ))) AS length_m
    FROM pairs AS p
    JOIN road_nodes AS na ON na.node_id = p.a
    JOIN road_nodes AS nb ON nb.node_id = p.b
)
SELECT a, b, way_id, seq, length_m, length_m / (speed_kph / 3.6) AS seconds, oneway
FROM lengths;

CREATE OR REPLACE TEMP TABLE segments AS
SELECT a, b, way_id, seq, length_m, seconds FROM forward_segments WHERE oneway != -1
UNION ALL
SELECT b AS a, a AS b, way_id, seq, length_m, seconds
FROM forward_segments WHERE oneway != 1;
