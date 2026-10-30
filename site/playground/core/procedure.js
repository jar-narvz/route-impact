/** Shared uncapped §5.8 procedure. Costs and baselines are integer milliseconds. */
export function createProcedure(meta, a) {
  const now = () => performance.now();
  const allTrips = Array.from(a.trip_origin, (_, i) => i);
  const baseline = a.trip_ms;
  const wayEdgeOffsets = new Uint32Array(meta.counts.ways + 1);
  for (const w of a.edge_way) wayEdgeOffsets[w + 1]++;
  for (let w = 0; w < meta.counts.ways; w++) wayEdgeOffsets[w + 1] += wayEdgeOffsets[w];
  const wayEdgeList = new Uint32Array(a.edge_way.length), cursor = wayEdgeOffsets.slice();
  for (let e = 0; e < a.edge_way.length; e++) wayEdgeList[cursor[a.edge_way[e]]++] = e;
  const wayEdges = w => wayEdgeList.subarray(wayEdgeOffsets[w], wayEdgeOffsets[w + 1]);
  const wayPermutation = Uint32Array.from(a.way_osm_id, (_, w) => w);
  wayPermutation.sort((x, y) => a.way_osm_id[x] - a.way_osm_id[y]);
  const sortedOsmIds = Float64Array.from(wayPermutation, w => a.way_osm_id[w]);
  function wayIndex(id) {
    let lo = 0, hi = sortedOsmIds.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (sortedOsmIds[mid] < id) lo = mid + 1; else hi = mid; }
    if (lo === sortedOsmIds.length || sortedOsmIds[lo] !== id) throw new Error(`Unknown OSM way ${id}`);
    return wayPermutation[lo];
  }
  const path = t => a.trip_path_edges.subarray(a.trip_path_offsets[t], a.trip_path_offsets[t + 1]);
  const osm = w => a.way_osm_id[w];
  function groups(trips) {
    const result = new Map();
    for (const t of trips) { const s = a.trip_origin[t]; if (!result.has(s)) result.set(s, []); result.get(s).push(t); }
    return result;
  }
  function queryTrips(engine, trips) {
    const result = new Map();
    for (const [s, ts] of groups(trips)) {
      const ds = engine.search(s, ts.map(t => a.trip_destination[t]));
      ts.forEach((t, i) => result.set(t, ds[i]));
    }
    return result;
  }

  // Hit-test the shipped simplified polylines in the local metre projection.
  function meteor(test) {
    const {lat, lon, radius_m: radius} = test;
    // Format-v0 spike exports predate earth_radius_m.
    const R = 'earth_radius_m' in meta ? meta.earth_radius_m : 6371008.8, scale = meta.geometry_scale;
    const k = R * Math.PI / 180, kx = k * Math.cos(lat * Math.PI / 180), hit = [];
    const point = p => {
      const plat = a.geometry_coords[2 * p] / scale, plon = a.geometry_coords[2 * p + 1] / scale;
      const y = (plat - lat) * k, x = (plon - lon) * kx;
      return [x, y];
    };
    for (let w = 0; w < meta.counts.ways; w++) {
      const end = a.geometry_offsets[w + 1];
      for (let p = a.geometry_offsets[w] + 1; p < end; p++) {
        const [ax, ay] = point(p - 1), [bx, by] = point(p);
        const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
        const projection = length2 > 0 ? -(ax * dx + ay * dy) / length2 : 0;
        const t = Math.min(Math.max(projection, 0), 1), cx = ax + t * dx, cy = ay + t * dy;
        if (cx * cx + cy * cy <= radius * radius) { hit.push(w); break; }
      }
    }
    return hit;
  }

  function timed(timings, key, fn) { const t = now(); const value = fn(); timings[key] = (timings[key] || 0) + now() - t; return value; }
  function procedure(test, hitWays, engine, baseDistances = baseline, threshold = 120000) {
    const timings = {initial_edit_update_ms: 0, reroute_queries_ms: 0, single_restore_update_ms: 0, single_queries_ms: 0,
      single_undo_ms: 0, run_restore_update_ms: 0, run_queries_ms: 0, run_undo_ms: 0, unpack_ms: 0};
    const counts = {initial: {dirtyArcs: 0, changedArcs: 0, trianglesScanned: 0}, single: {jobs: 0, dirtyArcs: 0, changedArcs: 0, trianglesScanned: 0},
      run: {jobs: 0, dirtyArcs: 0, changedArcs: 0, trianglesScanned: 0}, unpackedTrips: 0};
    const addCounts = (phase, update) => { if (update) for (const k of ['dirtyArcs', 'changedArcs', 'trianglesScanned']) counts[phase][k] += update[k]; };
    const drawn = [];
    const begin = now(), destroyed = new Set(hitWays);
    const changed = [];
    timed(timings, 'initial_edit_update_ms', () => {
      for (const w of hitWays) for (const e of wayEdges(w)) if (engine.mask[e]) { engine.mask[e] = 0; changed.push(e); }
      if (test.weapon === 'flip') for (const w of hitWays) {
        if (!meta.counts || !a.way_oneway[w]) throw new Error('Flip requires a one-way');
        for (const e of wayEdges(w)) if (a.edge_initially_active[e]) {
          const twin = a.edge_twin[e];
          if (twin < 0) throw new Error('Missing reverse twin');
          engine.mask[twin] = 1; changed.push(twin);
        }
      }
      addCounts('initial', engine.update(changed));
    });
    const candidates = allTrips.filter(t => path(t).some(e => !engine.mask[e]));
    const distances = timed(timings, 'reroute_queries_ms', () => queryTrips(engine, candidates));
    const affected = [];
    for (const t of candidates) {
      const distance = distances.get(t), status = Number.isFinite(distance) ? (distance - baseDistances[t] >= threshold ? 'slowed' : 'ok') : 'broken';
      if (status !== 'ok') affected.push({trip: t, status, distance_ms: Number.isFinite(distance) ? distance : null,
        added_ms: Number.isFinite(distance) ? distance - baseDistances[t] : null,
        candidates: [...new Set(Array.from(path(t), e => a.edge_way[e]).filter(w => destroyed.has(w)))],
        confirmed_singles: [], confirmed_runs: [], tested_candidates: [], unchecked_candidates: [], tested_runs: 0, total_runs: 0});
    }
    const rows = new Map(affected.map(row => [row.trip, row]));
    function counterfactual(ways, trips, phase, record) {
      counts[phase].jobs++;
      let log;
      timed(timings, `${phase}_restore_update_ms`, () => {
        const restored = [];
        for (const w of ways) for (const e of wayEdges(w)) if (engine.mask[e] !== a.edge_initially_active[e]) {
          restored.push([e, engine.mask[e]]); engine.mask[e] = a.edge_initially_active[e];
        }
        const update = engine.update(restored.map(([e]) => e)); addCounts(phase, update); log = {restored, update};
      });
      try {
        const result = timed(timings, `${phase}_queries_ms`, () => queryTrips(engine, trips));
        for (const [t, d] of result) {
          const row = rows.get(t), recovered = row.status === 'broken' ? Number.isFinite(d) : Number.isFinite(d) && d - baseDistances[t] < threshold;
          record(row, recovered);
        }
      } finally {
        timed(timings, `${phase}_undo_ms`, () => {
          if (log.update) engine.undo(log.update.undo);
          else for (const [e, mask] of log.restored) engine.mask[e] = mask;
        });
      }
    }
    const compound = test.weapon === 'meteor' || hitWays.length > 1;
    if (compound) {
      const singles = new Map();
      for (const row of affected) for (const w of row.candidates) {
        if (!singles.has(w)) singles.set(w, []); singles.get(w).push(row.trip);
      }
      for (const [w, trips] of [...singles].sort((x, y) => y[1].length - x[1].length || x[0] - y[0]))
        counterfactual([w], trips, 'single', (row, recovered) => { row.tested_candidates.push(w); if (recovered) row.confirmed_singles.push(w); });
      const runs = new Map();
      for (const row of affected) {
        if (row.confirmed_singles.length) continue;
        let run = new Set(); const tripRuns = new Map();
        const flush = () => { if (run.size >= 2) { const ways = [...run].sort((x, y) => x - y); tripRuns.set(ways.join(','), ways); } run = new Set(); };
        for (const e of path(row.trip)) { if (!engine.mask[e]) run.add(a.edge_way[e]); else flush(); } flush();
        row.total_runs = tripRuns.size;
        for (const [key, ways] of tripRuns) { if (!runs.has(key)) runs.set(key, {ways, trips: []}); runs.get(key).trips.push(row.trip); }
      }
      for (const {ways, trips} of [...runs.values()].sort((x, y) => y.trips.length - x.trips.length))
        counterfactual(ways, trips, 'run', (row, recovered) => { row.tested_runs++; if (recovered) row.confirmed_runs.push(ways); });
    } else for (const row of affected) { row.confirmed_singles = [...hitWays]; row.tested_candidates = [...hitWays]; }
    for (const row of affected) {
      row.label = row.confirmed_singles.length ? 'single' : row.confirmed_runs.length ? 'run' : 'several_together';
      row.candidates = row.candidates.map(osm); row.tested_candidates = row.tested_candidates.map(osm);
      row.confirmed_singles = row.confirmed_singles.map(osm); row.confirmed_runs = row.confirmed_runs.map(run => run.map(osm));
    }
    timed(timings, 'unpack_ms', () => {
      if (!engine.unpack) return;
      // The draw cap applies to affected trips, including broken trips (no path).
      for (const row of affected.slice(0, 25)) if (row.distance_ms !== null) {
        const edges = engine.unpack(a.trip_origin[row.trip], a.trip_destination[row.trip]);
        drawn.push({trip: row.trip, edges}); counts.unpackedTrips++;
      }
    });
    timings.total_ms = now() - begin;
    return {ways_hit: hitWays.length, candidate_trips: candidates.length, affected_trips: affected.length,
      broken: affected.filter(r => r.status === 'broken').length, slowed: affected.filter(r => r.status === 'slowed').length,
      added_ms: affected.reduce((sum, row) => sum + (row.added_ms ?? 0), 0), rows: affected, drawn, timings, counts};
  }

  function hitWays(test) {
    if (test.weapon === 'meteor') return meteor(test);
    const ids = test.way_ids || [test.way_id], seen = new Set(), duplicates = new Set();
    for (const id of ids) { if (seen.has(id)) duplicates.add(id); seen.add(id); }
    if (duplicates.size) throw new Error(`Duplicate way ids in the edit: [${[...duplicates].sort((a, b) => a - b).join(', ')}]`);
    return ids.map(wayIndex);
  }
  return {run: (test, engine) => procedure(test, hitWays(test), engine, baseline, meta.slow_seconds * 1000), path, hitWays};
}

// Paths may differ on equal-cost routes; impact and full attribution must not.
export function canonical(result) {
  const sorted = values => [...values].sort((a, b) => a - b);
  const tuples = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  };
  return {ways_hit: result.ways_hit, candidate_trips: result.candidate_trips,
    affected_trips: result.affected_trips, broken: result.broken, slowed: result.slowed, added_ms: result.added_ms,
    rows: [...result.rows].sort((a, b) => a.trip - b.trip).map(row => ({...row,
      candidates: sorted(row.candidates), confirmed_singles: sorted(row.confirmed_singles),
      confirmed_runs: row.confirmed_runs.map(sorted).sort(tuples),
      tested_candidates: sorted(row.tested_candidates), unchecked_candidates: sorted(row.unchecked_candidates)
    }))};
}
