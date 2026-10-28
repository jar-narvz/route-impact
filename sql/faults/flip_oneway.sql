-- Apply flip_oneway to roads; the runner validates target eligibility.
UPDATE roads SET tags = MAP_CONCAT(tags, MAP {'oneway': CASE WHEN oneway = 1 THEN '-1' ELSE 'yes' END}), oneway = -oneway WHERE way_id = $way_id;

UPDATE roads SET content_hash = SHA256(TO_JSON(STRUCT_PACK(
    tags := LIST_SORT(MAP_ENTRIES(tags)), node_refs := node_refs
))) WHERE way_id = $way_id;
