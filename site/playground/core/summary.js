/** Sheet copy and attribution, independent of the DOM. */
export function summarize(result, {meta, edit}) {
  const n = value => value.toLocaleString('en-US');
  const trips = result.rows.map(row => ({trip: row.trip,
    title: row.trip_label.kind === 'intercity' ? 'Intercity trip' : 'Local trip',
    id_text: row.trip_label.trip_id,
    status: row.status, before_min: (row.trip_ms / 60000).toFixed(1),
    after_min: row.distance_ms === null ? null : (row.distance_ms / 60000).toFixed(1),
    duration_text: row.distance_ms === null ? `${(row.trip_ms / 60000).toFixed(1)} min → no route`
      : `${(row.trip_ms / 60000).toFixed(1)} → ${(row.distance_ms / 60000).toFixed(1)} min`}));
  const singleRoad = !edit.preset && ['stomp', 'flip'].includes(edit.weapon) && result.ways_hit === 1;
  // Mid-sentence, a missing name reads as "an unnamed road" (not "Unnamed road").
  const name = singleRoad ? roadName(result.ways?.[0]).replace(/^Unnamed road$/, 'an unnamed road') : null;
  let message;
  if (edit.weapon === 'meteor' && result.ways_hit === 0) message = 'No roads inside the circle.';
  else if (result.candidate_trips === 0) message = `No sampled trip used ${singleRoad ? name : 'these roads'}`;
  else if (result.affected_trips === 0) message = `${n(result.candidate_trips)} ${result.candidate_trips === 1 ? 'trip' : 'trips'} ${edit.weapon === 'flip' ? `changed route after ${name || 'these roads'} was reversed` : `rerouted${singleRoad ? ` around ${name}` : ''}`}. None lost 2 min or more.`;
  if (message && edit.weapon === 'flip') message = `Flip reversed ${name || 'these roads'}.`;
  if (message) return {message, rerouted_label: 'Rerouted', ...(result.ways_hit > 0 ? {note: 'Only the sampled trips were tested.'} : {}),
    announcement: message, trips, ...(result.precomputed ? {precomputed: true} : {})};
  const label = edit.preset ? (edit.label ?? meta.presets?.[edit.preset]?.label ?? edit.preset)
    : ({stomp: 'Stomp', flip: 'Flip', meteor: 'Meteor'})[edit.weapon];
  const headline = edit.weapon === 'flip' ? `Flip reversed ${name || 'these roads'}` : `${label} hit ${n(result.ways_hit)} ${result.ways_hit === 1 ? 'road' : 'roads'}`;
  const numbers = {broken: result.broken, slowed: result.slowed,
    added_minutes: Math.round(result.added_ms / 60000), sample: `of ${n(meta.counts.trips)} sampled ${meta.counts.trips === 1 ? 'trip' : 'trips'}`};
  const attribution = rankRoads(result);
  const mattered = {rows: attribution.rows, count: attribution.count, more_text: `Show all ${attribution.rows.length} groups`,
    several_together: new Set(result.rows.filter(row => row.label === 'several_together').map(row => row.trip)).size};
  const announcement = `${headline}: ${n(numbers.broken)} ${numbers.broken === 1 ? 'trip' : 'trips'} broken, ${n(numbers.slowed)} slowed by 2 min or more, ${n(numbers.added_minutes)} added minutes ${numbers.sample}.`;
  return {headline, labels: {broken: 'Broken', slowed: 'Slowed', added_minutes: 'Added min'}, detail: `${headline}.`, numbers, mattered, announcement, trips, ...(result.precomputed ? {precomputed: true} : {})};
}

const roadName = way => [way?.name, way?.ref].find(name => name && !new RegExp(`^(?:(?:OSM )?(?:road|way) )?${way.way_id}$`, 'i').test(name)) || 'Unnamed road';

/** A group takes the most frequent name; ties use the lowest road id. */
export function groupName(ways) {
  const ordered = [...ways].sort((a,b) => a.way_id-b.way_id), counts = new Map();
  for (const way of ordered) {
    const name = roadName(way);
    counts.set(name, (counts.get(name) || 0)+1);
  }
  return [...counts.keys()].sort((a,b) => counts.get(b)-counts.get(a))[0] || 'Unnamed road';
}

/** Merge matching headlines; count each trip and each road once per row. */
export function rankRoads(result) {
  const names = new Map((result.ways || []).map(way => [way.way_id, roadName(way)]));
  const groups = new Map(), mattered = new Set();
  for (const row of result.rows) {
    const causes = [
      ...(row.confirmed_singles || []).map(id => ({kind: 'single', ids: [id]})),
      ...(row.confirmed_runs || []).map(ids => ({kind: 'run', ids})),
    ];
    for (const {kind, ids} of causes) {
      const sorted = [...new Set(ids)].sort((a,b) => a-b);
      if (!sorted.length) continue;
      const key = `${kind}:${sorted.join(',')}`;
      if (!groups.has(key)) groups.set(key, {ids: sorted, trips: new Set()});
      groups.get(key).trips.add(row.trip);
      for (const id of sorted) mattered.add(id);
    }
  }
  const merged = new Map();
  for (const group of groups.values()) {
    const ways = group.ids.map(way_id => ({way_id, name: names.get(way_id) || 'Unnamed road'}));
    const name = groupName(ways);
    if (!merged.has(name)) merged.set(name, {name, ways: new Map(), trips: new Set()});
    const row = merged.get(name);
    for (const way of ways) row.ways.set(way.way_id, way);
    for (const trip of group.trips) row.trips.add(trip);
  }
  const rows = [...merged.values()].map(row => ({name: row.name, secondary: '',
    ways: [...row.ways.values()].sort((a,b) => a.way_id-b.way_id), trips: row.trips.size}));
  const joint = new Set(result.rows.filter(row => row.label === 'several_together').map(row => row.trip)).size;
  rows.sort((a,b) => b.trips-a.trips || a.ways[0].way_id-b.ways[0].way_id);
  // Each road is counted in one row only, so captions never add up to more roads than were hit:
  // the row carrying its own name first, else the highest-ranked row that contains it.
  const owner = new Map();
  for (const own of [true, false]) for (const row of rows) for (const way of row.ways)
    if (!owner.has(way.way_id) && (!own || way.name === row.name)) owner.set(way.way_id, row);
  const caption = (roads, trips) => `${roads ? `${roads} ${roads === 1 ? 'road' : 'roads'} · ` : ''}${trips} ${trips === 1 ? 'trip' : 'trips'}`;
  for (const row of rows) row.caption = caption(row.ways.filter(way => owner.get(way.way_id) === row).length, row.trips);
  if (joint) {
    const ways = result.ways || [];
    rows.push({ways, name: 'Several roads together', secondary: '', trips: joint, caption: caption(ways.filter(way => !owner.has(way.way_id)).length, joint)});
    rows.sort((a,b) => b.trips-a.trips || a.ways[0].way_id-b.ways[0].way_id);
  }
  return {rows: rows.map(row => ({...row, share: row.trips/rows[0].trips})), count: mattered.size};
}
