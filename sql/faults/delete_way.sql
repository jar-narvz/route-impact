-- Apply delete_way to roads; the runner validates target eligibility.
DELETE FROM roads WHERE way_id = $way_id;
