-- Apply bad_maxspeed to roads; the runner validates target eligibility.
UPDATE roads SET tags = MAP_CONCAT(tags, MAP {'maxspeed': '5 mph'}), maxspeed_raw = '5 mph', speed_kph = 5 * 1.609344 WHERE way_id = $way_id;

UPDATE roads SET content_hash = SHA256(TO_JSON(STRUCT_PACK(
    tags := LIST_SORT(MAP_ENTRIES(tags)), node_refs := node_refs
))) WHERE way_id = $way_id;
