/* Read-only frozen regression, bounds, Python agreement, and actual worker_threads pools. */
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Worker} from 'node:worker_threads';
import {RoutingPool} from './pool.mjs';
import assert from 'node:assert/strict';

const base = new URL('../../../data/playground-spike/', import.meta.url);
const read = name => readFileSync(new URL(name, base));
const reference = JSON.parse(read('reference-outputs.json'));
const presets = JSON.parse(gunzipSync(read('presets.json.gz')));
const cases = JSON.parse(readFileSync(new URL('../../../results/playground/stress_set.json', import.meta.url))).cases;
assert(process.argv.includes('--compare'), 'Use --compare; reference generation is intentionally disabled');
assert(presets.bay_bridge && presets.university_ramp, 'Both Python presets required');
const canonical = r => ({candidate_trips: r.candidate_trips, affected_trips: r.affected_trips,
  broken: r.broken, slowed: r.slowed, added_seconds: Math.round(r.added_seconds * 100) / 100,
  attribution: r.attribution.map(c => ({trip_id: c.trip_id, label: c.label,
    confirmed_singles: [...c.confirmed_singles].sort((a,b) => a-b),
    confirmed_runs: c.confirmed_runs.map(r => [...r].sort((a,b) => a-b)).sort()})).sort((a,b) => a.trip_id.localeCompare(b.trip_id))});
const impact = r => { const {attribution, ...totals} = canonical(r); return totals; };
const rounded = x => x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100;
function client() {
  const worker = new Worker(new URL('node-worker.cjs', import.meta.url), {workerData: {base: base.href}});
  let sequence = 0;
  const pending = new Map();
  const loaded = new Promise((resolve, reject) => pending.set(0, {resolve, reject}));
  worker.on('message', data => {
    const item = pending.get(data.requestId);
    if (!item) return;
    pending.delete(data.requestId);
    if (data.error) item.reject(new Error(data.error));
    else item.resolve(data.requestId === 0 ? data : data.result);
  });
  worker.on('error', error => { for (const item of pending.values()) item.reject(error); pending.clear(); });
  const request = payload => new Promise((resolve, reject) => {
    const requestId = ++sequence;
    pending.set(requestId, {resolve, reject});
    worker.postMessage({...payload, requestId});
  });
  return {worker, loaded, request};
}
let differences = 0;
const record = (valid, description) => { if (!valid) { differences++; console.error(description); } };
const singleOutputs = new Map();
for (const P of [1, 4]) {
  const clients = Array.from({length: P}, client), pool = new RoutingPool(clients.map(c => c.request));
  try {
    const loaded = await Promise.all(clients.map(c => c.loaded));
    console.log('LOAD ' + JSON.stringify({P, workers: loaded}));
    if (P === 1) console.log('BOUNDS ' + JSON.stringify(await clients[0].request({type: 'bounds'})));
    let wall = 0;
    for (const test of cases) {
      const started = performance.now(), result = await pool.edit({...test, budget: Infinity});
      const wall_ms = performance.now() - started; wall += wall_ms;
      const frozen = reference.outputs[test.id].result;
      assert(await clients[0].request({type: 'validatePaths', result}));
      record(JSON.stringify(canonical(result)) === JSON.stringify(canonical(frozen)), 'REFERENCE DIFFERENCE ' + test.id);
      // Compare numerical trip outputs, allowing deterministic equal-cost path edges to differ.
      const frozenTrips = new Map(frozen.trips.map(row => [row.trip_id, row]));
      for (const row of result.trips) {
        const expected = frozenTrips.get(row.trip_id);
        // P0's frozen worker chose a different drawing cohort before orientation grouping.
        if (expected) record(row.status === expected.status && rounded(row.seconds) === rounded(expected.seconds),
          'TRIP DIFFERENCE ' + test.id + ' ' + row.trip_id);
      }
      if (P === 1) singleOutputs.set(test.id, result);
      else {
        const clean = r => { const {timings, requestId, ...rest} = r; return rest; };
        assert.deepEqual(clean(result), clean(singleOutputs.get(test.id)), 'Pool output must be identical');
      }
      console.log(JSON.stringify({P, id: test.id, old_wall_ms: reference.outputs[test.id].wall_ms, wall_ms,
        settled_total: result.settled_total, settled_vertices: result.settled_vertices, searches: result.searches,
        search_compute_ms: result.timings.search_compute_ms}));
      if (test.weapon === 'meteor') for (const budget of [100, 40, 15]) {
        const start = performance.now(), capped = await pool.edit({...test, budget});
        record(capped.attribution_searches <= budget && JSON.stringify(impact(result)) === JSON.stringify(impact(capped)), 'BUDGET IMPACT DIFFERENCE ' + test.id);
        const full = new Map(canonical(result).attribution.map(row => [row.trip_id, row]));
        for (const row of canonical(capped).attribution) {
          const expected = full.get(row.trip_id);
          record(!!expected && row.confirmed_singles.every(w => expected.confirmed_singles.includes(w)) &&
            row.confirmed_runs.every(run => expected.confirmed_runs.some(r => JSON.stringify(r) === JSON.stringify(run))) &&
            (row.label === 'incomplete' || JSON.stringify(row) === JSON.stringify(expected)), 'BUDGET ATTRIBUTION DIFFERENCE ' + test.id);
        }
        const key = test.id + ':' + budget;
        if (P === 1) singleOutputs.set(key, canonical(capped));
        else assert.deepEqual(canonical(capped), singleOutputs.get(key), 'Budget must be pool independent');
        console.log(JSON.stringify({P, id: key, wall_ms: performance.now() - start, settled_total: capped.settled_total,
          settled_vertices: capped.settled_vertices, attribution_searches: capped.attribution_searches,
          attribution_complete: capped.attribution_complete}));
      }
      if (presets[test.id]) {
        record(JSON.stringify(canonical(result)) === JSON.stringify(canonical(presets[test.id])), 'PYTHON DIFFERENCE ' + test.id);
        const statuses = await clients[0].request({...test, type: 'presetTimes'});
        for (let i = 0; i < statuses.length; i++) {
          const expected = presets[test.id].trip_statuses[i], actual = statuses[i];
          record(expected.status === actual.status && rounded(expected.seconds) === rounded(actual.seconds), 'PYTHON TRIP DIFFERENCE ' + expected.trip_id);
        }
        const cached = await pool.edit({...test, preset: test.id});
        record(cached.precomputed && JSON.stringify(canonical(cached)) === JSON.stringify(canonical(result)), 'CACHED DIFFERENCE ' + test.id);
        console.log(JSON.stringify({P, id: test.id + '_preset', worker_ms: cached.timings.total_ms, settled_total: cached.settled_total}));
      }
    }
    console.log(`P=${P}: total edit wall ${reference.wall_ms.toFixed(2)} -> ${wall.toFixed(2)} ms; ${differences} differences; Python presets checked`);
  } finally { await Promise.all(clients.map(c => c.worker.terminate())); }
}
process.exitCode = differences ? 1 : 0;
