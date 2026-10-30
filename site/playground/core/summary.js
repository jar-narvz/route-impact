/** Sheet copy and attribution, independent of the DOM. */
export function summarize(result, {meta, edit}) {
  const n = value => value.toLocaleString('en-US');
  const tripCount = count => `${n(count)} ${count === 1 ? 'trip' : 'trips'}`;
  const roadNames = new Map((result.ways || []).map(way => [way.way_id, way.name || null]));
  const road = way_id => ({way_id, name: roadNames.get(way_id) ?? null});
  const trips = result.rows.map(row => ({trip: row.trip,
    title: `Trip ${row.trip_label.trip_id} · ${row.trip_label.kind}`,
    status: row.status, before_min: (row.trip_ms / 60000).toFixed(1),
    after_min: row.distance_ms === null ? null : (row.distance_ms / 60000).toFixed(1)}));
  let message;
  if (edit.weapon === 'meteor' && result.ways_hit === 0) message = 'Missed — no roads here';
  else if (result.candidate_trips === 0) message = 'No sampled trip used these roads';
  else if (result.affected_trips === 0) message = `${n(result.candidate_trips)} ${result.candidate_trips === 1 ? 'trip' : 'trips'} rerouted, none slowed by 2 min or more`;
  if (message) return {message, ...(result.ways_hit > 0 ? {note: 'Only the sampled trips were tested.'} : {}),
    announcement: message, trips, ...(result.precomputed ? {precomputed: true} : {})};
  const label = edit.preset ? (edit.label ?? meta.presets?.[edit.preset]?.label ?? edit.preset)
    : ({stomp: 'Stomp', flip: 'Flip', meteor: 'Meteor'})[edit.weapon];
  const headline = `${label} hit ${n(result.ways_hit)} ${result.ways_hit === 1 ? 'road' : 'roads'}`;
  const numbers = {broken: result.broken, slowed: result.slowed,
    added_minutes: Math.round(result.added_ms / 60000), sample: `of ${n(meta.counts.trips)} sampled ${meta.counts.trips === 1 ? 'trip' : 'trips'}`};
  let mattered;
  if (result.ways_hit === 1) mattered = {kind: 'one-road', way: road(result.ways[0].way_id), text: 'This road is the cause.'};
  else {
    const singles = new Map(), runs = new Map();
    for (const row of result.rows) {
      for (const id of new Set(row.confirmed_singles)) singles.set(id, (singles.get(id) || 0) + 1);
      const rowRuns = new Map();
      for (const run of row.confirmed_runs) {
        const ids = [...new Set(run)];
        const key = [...ids].sort((a, b) => a - b).join(',');
        if (!rowRuns.has(key)) rowRuns.set(key, ids);
      }
      for (const [key, ids] of rowRuns) {
        if (!runs.has(key)) {
          const ways = ids.map(road);
          const names = [...new Set(ways.map(way => way.name || 'unnamed road'))];
          runs.set(key, {ways, name: `${names.join(' + ')} (${n(ways.length)} ${ways.length === 1 ? 'way' : 'ways'})`, trips: 0});
        }
        runs.get(key).trips++;
      }
    }
    mattered = {kind: 'attribution', singles: [...singles].map(([id, trips]) => ({...road(id), trips, trip_text: tripCount(trips)}))
      .sort((a, b) => b.trips - a.trips || a.way_id - b.way_id), runs: [...runs.values()].map(run => ({...run, trip_text: tripCount(run.trips)})),
    several_together: result.rows.filter(row => row.label === 'several_together').length};
  }
  const announcement = `${headline}: ${n(numbers.broken)} ${numbers.broken === 1 ? 'trip' : 'trips'} broken, ${n(numbers.slowed)} slowed by 2 min or more, ${n(numbers.added_minutes)} added minutes ${numbers.sample}.`;
  return {headline, numbers, mattered, announcement, trips, ...(result.precomputed ? {precomputed: true} : {})};
}
