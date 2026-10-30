/** Generate a fresh integer oracle; compare the exact engine imported by the browser. */
import assert from 'node:assert/strict';
import {writeFileSync, existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {load, root, data, read, json, sha} from './node-data.mjs';
import {createEngine, deriveSources} from './engine.js';
import {makeDijkstra} from './dijkstra.mjs';
import {createProcedure, canonical} from './procedure.js';
const {meta, a, order, presets} = load();
const cases = json(new URL('results/playground/stress_set.json', root)).cases;
deriveSources(a, meta.counts.vertices);
const mask = a.edge_initially_active.slice();
const oracle = makeDijkstra(a, meta.counts.vertices, mask);
const procedure = createProcedure(meta, a);
const engine = createEngine(meta, a, order, presets);
// Independently validate every shipped baseline and edge sequence before edits.
const baselineGroups = new Map();
for (let t = 0; t < a.trip_origin.length; t++) {
  const origin = a.trip_origin[t];
  if (!baselineGroups.has(origin)) baselineGroups.set(origin, []);
  baselineGroups.get(origin).push(t);
  let vertex = origin, cost = 0;
  for (const e of procedure.path(t)) {
    assert.equal(a.edge_source[e], vertex); assert.equal(mask[e], 1);
    cost += a.edge_ms[e]; vertex = a.edge_target[e];
  }
  assert.equal(vertex, a.trip_destination[t]); assert.equal(cost, a.trip_ms[t]);
}
for (const [origin, trips] of baselineGroups) {
  const ds = oracle.search(origin, trips.map(t => a.trip_destination[t]));
  trips.forEach((t, i) => assert.equal(ds[i], a.trip_ms[t], `Baseline ${t}`));
}
console.log(`All ${a.trip_origin.length} integer baselines independently verified`);
const outputs = {}, drift = {}, counts = {affected_set: 0, classification: 0, baseline_path: 0, candidate_sets: 0, confirmed_attribution: 0, added_ms: 0};
const old = JSON.parse(read('reference-outputs.json'));
const differences = (list, kind, details) => { list.push({kind, ...details}); counts[kind] = (counts[kind] || 0) + 1; };
// Old P0 retained baseline paths in its drawn trip rows. Report all available paths;
// optionally use the old binary if present, never overwrite the frozen reference.
const oldPaths = new Map();
for (const output of Object.values(old.outputs)) for (const row of output.result.trips || [])
  if (row.old_path || row.baseline_path) oldPaths.set(row.trip_id, row.old_path || row.baseline_path);
const oldOffsetsFile = new URL('float64-trip_path_offsets.bin.gz', data);
if (existsSync(oldOffsetsFile)) {
  const typed = name => { const b = gunzipSync(read(name)); return new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength)); };
  const offsets = typed('float64-trip_path_offsets.bin.gz'), edges = typed('float64-trip_path_edges.bin.gz');
  const labels = JSON.parse(gunzipSync(read('trip_labels.json.gz')));
  labels.forEach((label, t) => oldPaths.set(label.trip_id, [...edges.subarray(offsets[t], offsets[t+1])]));
}
const labels = JSON.parse(gunzipSync(read('trip_labels.json.gz')));
const oldFloat = name => {
  const b = gunzipSync(read(name));
  return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const floatCosts = oldFloat('edge_seconds.bin.gz'), floatBaseline = oldFloat('trip_seconds.bin.gz');
const floatOracle = makeDijkstra(a, meta.counts.vertices, mask, floatCosts);
const labelIndex = new Map(labels.map((label, t) => [label.trip_id, t]));
assert.equal(oldPaths.size, labels.length, 'All Float64 baseline paths required; preserve pre-export binaries');
const baselineChanges = [];
for (let t = 0; t < labels.length; t++) {
  const path = [...procedure.path(t)], previous = oldPaths.get(labels[t].trip_id);
  if (previous && JSON.stringify(previous) !== JSON.stringify(path)) baselineChanges.push({trip_id: labels[t].trip_id, before: previous, after: path});
}
for (const test of cases) {
  mask.set(a.edge_initially_active);
  const expected = procedure.run(test, {mask, search: oracle.search, update: () => null});
  outputs[test.id] = canonical(expected);
  assert.deepEqual(canonical(engine.edit(test)), outputs[test.id], `${test.id}: CCH == integer Dijkstra`);
  if (presets[test.id]) {
    assert.deepEqual(canonical(presets[test.id]), outputs[test.id], `${test.id}: Python == JS live`);
    assert.deepEqual(canonical(engine.edit({...test, preset: test.id})), outputs[test.id]);
  }
  const list = drift[test.id] = [];
  const previous = old.outputs[test.id].result;
  // P0 stored only 25 drawn classifications. Recover the rest independently on
  // its retained Float64 costs, fixed endpoints and original baseline distances.
  const oldClassifications = new Map();
  const origins = new Map();
  for (const row of previous.attribution) {
    const t = labelIndex.get(row.trip_id), origin = a.trip_origin[t];
    if (!origins.has(origin)) origins.set(origin, []);
    origins.get(origin).push(t);
  }
  for (const [origin, trips] of origins) {
    const distances = floatOracle.search(origin, trips.map(t => a.trip_destination[t]));
    trips.forEach((t, i) => oldClassifications.set(labels[t].trip_id,
      !Number.isFinite(distances[i]) ? 'broken' : distances[i] - floatBaseline[t] >= meta.slow_seconds ? 'slowed' : 'ok'));
  }
  assert.equal([...oldClassifications.values()].filter(s => s === 'broken').length, previous.broken, `${test.id} Float64 broken reconstruction`);
  assert.equal([...oldClassifications.values()].filter(s => s === 'slowed').length, previous.slowed, `${test.id} Float64 slowed reconstruction`);
  const hit = new Set(procedure.hitWays(test));
  const before = new Map(previous.attribution.map(r => {
    const candidates = [...new Set(oldPaths.get(r.trip_id).map(e => a.edge_way[e]).filter(w => hit.has(w)))].map(w => a.way_osm_id[w]);
    return [r.trip_id, {...r, candidates: r.candidates ?? candidates}];
  }));
  const after = new Map(expected.rows.map(r => [labels[r.trip].trip_id, r]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const x = before.get(id), y = after.get(id);
    if (!x || !y) differences(list, 'affected_set', {trip_id: id, before: !!x, after: !!y});
    const oldStatus = oldClassifications.get(id) || 'ok', newStatus = y?.status || 'ok';
    if (oldStatus !== newStatus) differences(list, 'classification', {trip_id: id, before: oldStatus, after: newStatus});
    if (x && y) {
      const normalize = value => Array.isArray(value) ? value.map(normalize).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : value;
      for (const key of ['candidates', 'confirmed_singles', 'confirmed_runs', 'label'])
        if (JSON.stringify(normalize(x[key])) !== JSON.stringify(normalize(y[key]))) differences(list, key === 'candidates' ? 'candidate_sets' : 'confirmed_attribution',
          {trip_id: id, field: key, before: x[key] ?? null, after: y[key] ?? null});
    }
  }
  for (const change of baselineChanges) differences(list, 'baseline_path', change);
  if (previous.added_seconds * 1000 !== expected.added_ms)
    differences(list, 'added_ms', {before: previous.added_seconds * 1000, after: expected.added_ms});
  console.log(`${test.id}: identical; ${expected.affected_trips} affected; ${list.length} Float64 differences`);
}
writeFileSync(new URL('reference-ms.json', data), JSON.stringify({snapshot: meta.snapshot, data_hashes: Object.fromEntries(meta.files.map(f => [f.file, sha(read(f.file))])), outputs}, null, 2)+'\n');
writeFileSync(new URL('float64-vs-ms.json', data), JSON.stringify({counts, baseline_paths_compared: oldPaths.size,
  baseline_path_note: 'All original Float64 baseline edges recovered from preserved pre-export binaries. Legacy singleton candidates reconstructed from those paths; missing drawn classifications reconstructed and checked against frozen totals.', cases: drift}, null, 2)+'\n');
console.log(`All ${cases.length} cases identical; Python presets identical. Drift: ${JSON.stringify(counts)}`);
