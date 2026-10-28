-- Downgrade a road to residential and clear its speed override.
-- The runner requires the residential default to be strictly slower than current speed.
-- Recompute implied direction as well: a former untagged motorway is now two-way.
UPDATE roads SET
    tags = MAP_CONCAT(
        MAP_FROM_ENTRIES(LIST_FILTER(MAP_ENTRIES(tags), LAMBDA entry: entry.key != 'maxspeed')),
        MAP {'highway': 'residential'}
    ),
    highway = 'residential',
    maxspeed_raw = NULL,
    speed_kph = (SELECT speed_kph FROM default_speeds WHERE highway = 'residential'),
    oneway = CASE
        WHEN tags['oneway'] IN ('yes', 'true', '1') THEN 1
        WHEN tags['oneway'] = '-1' THEN -1
        WHEN tags['oneway'] IS NULL AND tags['junction'] IN ('roundabout', 'circular') THEN 1
        ELSE 0
    END
WHERE way_id = $way_id;

UPDATE roads SET content_hash = SHA256(TO_JSON(STRUCT_PACK(
    tags := LIST_SORT(MAP_ENTRIES(tags)), node_refs := node_refs
))) WHERE way_id = $way_id;
