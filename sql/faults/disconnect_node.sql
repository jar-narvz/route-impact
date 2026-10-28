-- Disconnect the lowest containing way; the runner requires a shared node.
CREATE OR REPLACE TEMP TABLE disconnect_target AS
SELECT MIN(way_id) AS way_id, (SELECT MAX(node_id) + 1 FROM road_nodes) AS fresh
FROM roads WHERE LIST_CONTAINS(node_refs, $node_id);
INSERT INTO road_nodes
SELECT fresh, lat, lon FROM disconnect_target, road_nodes WHERE node_id = $node_id;
UPDATE roads SET node_refs = LIST_TRANSFORM(node_refs,
    LAMBDA node: CASE WHEN node = $node_id THEN disconnect_target.fresh ELSE node END)
FROM disconnect_target WHERE roads.way_id = disconnect_target.way_id;
UPDATE roads SET content_hash = SHA256(TO_JSON(STRUCT_PACK(
    tags := LIST_SORT(MAP_ENTRIES(tags)), node_refs := node_refs
))) WHERE way_id = (SELECT way_id FROM disconnect_target);
