-- Apply delete_bridge to roads; the runner validates target eligibility.
DELETE FROM roads WHERE way_id = $way_id;
