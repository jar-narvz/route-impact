-- Build roads and scan only referenced/place nodes; unparseable populations become NULL.
-- Alternating/reversible one-ways are treated as two-way pending time-aware routing.
CREATE TABLE roads AS
WITH parsed AS (
    SELECT *,
        CASE
            WHEN REGEXP_FULL_MATCH(TRIM(tags['maxspeed']), '[0-9]+(\.[0-9]+)?( mph)?')
            THEN TRY_CAST(REGEXP_EXTRACT(TRIM(tags['maxspeed']), '[0-9]+(\.[0-9]+)?') AS DOUBLE)
                * CASE WHEN ENDS_WITH(TRIM(tags['maxspeed']), ' mph') THEN 1.609344 ELSE 1 END
        END AS parsed_kph
    FROM staged_roads
)
SELECT
    way_id,
    tags['highway'] AS highway,
    tags,
    tags['name'] AS name,
    tags['ref'] AS ref,
    tags['maxspeed'] AS maxspeed_raw,
    COALESCE(
        CASE WHEN parsed_kph > 0 AND ISFINITE(parsed_kph) THEN parsed_kph END,
        defaults.speed_kph
    ) AS speed_kph,
    CAST(CASE
        WHEN tags['oneway'] IN ('yes', 'true', '1') THEN 1
        WHEN tags['oneway'] = '-1' THEN -1
        WHEN tags['oneway'] IS NULL AND (
            tags['highway'] = 'motorway' OR tags['junction'] IN ('roundabout', 'circular')
        ) THEN 1
        ELSE 0
    END AS SMALLINT) AS oneway,
    node_refs,
    SHA256(TO_JSON(STRUCT_PACK(
        tags := LIST_SORT(MAP_ENTRIES(tags)), node_refs := node_refs
    ))) AS content_hash
FROM parsed
LEFT JOIN default_speeds AS defaults
    ON defaults.highway = CASE
        WHEN tags['route'] = 'ferry'
            AND (tags['motor_vehicle'] = 'yes' OR tags['motorcar'] = 'yes') THEN 'ferry'
        ELSE tags['highway']
    END;

CREATE TEMP TABLE staged_nodes AS
SELECT id AS node_id, tags, lat, lon
FROM osm_input
WHERE kind = 'node'
    AND (
        id IN (SELECT node_id FROM referenced_nodes)
        OR tags['place'] IN ('city', 'town', 'village')
    );

CREATE TABLE road_nodes AS
SELECT node_id, lat, lon FROM staged_nodes
WHERE node_id IN (SELECT node_id FROM referenced_nodes);

CREATE TABLE places AS
SELECT node_id, tags['name'] AS name, tags['place'] AS place,
    TRY_CAST(tags['population'] AS BIGINT) AS population, lat, lon
FROM staged_nodes
WHERE tags['place'] IN ('city', 'town', 'village');
