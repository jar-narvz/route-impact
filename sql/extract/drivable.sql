-- Stage public car ways with full tags and ordered refs; service roads are excluded.
CREATE TEMP TABLE staged_roads AS
SELECT id AS way_id, tags, refs AS node_refs
FROM osm_input
WHERE kind = 'way'
    AND (
        tags['highway'] IN (
            'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
            'unclassified', 'residential', 'living_street',
            'motorway_link', 'trunk_link', 'primary_link',
            'secondary_link', 'tertiary_link'
        )
        OR (
            tags['route'] = 'ferry'
            AND (tags['motor_vehicle'] = 'yes' OR tags['motorcar'] = 'yes')
        )
    )
    AND COALESCE(
        tags['motorcar'], tags['motor_vehicle'], tags['vehicle'], tags['access'], ''
    ) NOT IN ('no', 'private');

CREATE TEMP TABLE referenced_nodes AS
SELECT DISTINCT UNNEST(node_refs) AS node_id FROM staged_roads;
