/* Frozen-current-worker regression and independent Python preset agreement. */
import {readFileSync, writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
const base = new URL('../../../data/playground-spike/', import.meta.url);
const read = name => readFileSync(new URL(name, base));
const meta = JSON.parse(read('meta.json'));
const types = {'<f8': Float64Array, '<u4': Uint32Array, '<i4': Int32Array, u1: Uint8Array};
const arrays = {};
for (const d of meta.arrays) {
  const bytes = gunzipSync(read(d.file));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  arrays[d.name] = new types[d.dtype](buffer, d.byte_offset, d.length);
}
const labels = JSON.parse(gunzipSync(read('trip_labels.json.gz')));
const presets = meta.files.some(f => f.file === 'presets.json.gz') ? JSON.parse(gunzipSync(read('presets.json.gz'))) : {};
const context = vm.createContext({performance, self: {}, console});
vm.runInContext(readFileSync(new URL('worker.js', import.meta.url), 'utf8'), context);
context.input = {meta, arrays, labels, presets};
vm.runInContext(`meta = input.meta; a = input.arrays; labels = input.labels;
  if (typeof presetResults !== 'undefined') presetResults = input.presets;
  buildIndices();`, context);
const cases = JSON.parse(readFileSync(new URL('../../../results/playground/stress_set.json', import.meta.url))).cases;
const compare = process.argv.includes('--compare');
if (compare && (!presets.bay_bridge || !presets.university_ramp)) throw new Error('Export both Python presets before comparing');
const reference = compare ? JSON.parse(read('reference-outputs.json')) : null;
const canonical = r => ({candidate_trips: r.candidate_trips, affected_trips: r.affected_trips,
  broken: r.broken, slowed: r.slowed, added_seconds: Math.round(r.added_seconds * 100) / 100,
  attribution: r.attribution.map(c => ({trip_id: c.trip_id, label: c.label,
    confirmed_singles: [...c.confirmed_singles].sort((a,b) => a-b),
    confirmed_runs: c.confirmed_runs.map(r => [...r].sort((a,b) => a-b)).sort()})).sort((a,b) => a.trip_id.localeCompare(b.trip_id))});
let differences = 0;
const outputs = {}, start = performance.now();
for (const test of cases) {
  context.message = {...test, budget: Infinity};
  const t = performance.now(), result = vm.runInContext('edit(message)', context);
  outputs[test.id] = {result, wall_ms: performance.now() - t};
  if (compare && JSON.stringify(canonical(result)) !== JSON.stringify(canonical(reference.outputs[test.id].result))) {
    console.error(`DIFFERENCE ${test.id}`); differences++;
  }
  console.log(`${test.id}: ${compare ? reference.outputs[test.id].result.searches + ' -> ' : ''}${result.searches} searches (bound ${result.bound_searches || 0}), ${outputs[test.id].wall_ms.toFixed(2)} ms`);
  if (compare) {
    for (const row of result.trips) {
      if (row.seconds === null) continue;
      context.drawn = row;
      const valid = vm.runInContext(`(() => {
        const t = labels.findIndex(l => l.trip_id === drawn.trip_id);
        let v = a.trip_origin[t], seconds = 0;
        for (const e of drawn.new_path) {
          if (!mask[e] || a.edge_source[e] !== v) return false;
          v = a.edge_target[e]; seconds += a.edge_seconds[e];
        }
        return v === a.trip_destination[t] && Math.abs(seconds - drawn.seconds) < 1e-7;
      })()`, context);
      if (!valid) { differences++; console.error(`PATH DIFFERENCE ${test.id} ${row.trip_id}`); }
    }
    if (test.weapon === 'meteor') for (const budget of [100, 40, 15]) {
      context.message = {...test, budget};
      const capped = vm.runInContext('edit(message)', context);
      const impact = r => { const {attribution, ...totals} = canonical(r); return totals; };
      const full = new Map(canonical(result).attribution.map(row => [row.trip_id, row]));
      let valid = capped.attribution_searches <= budget && JSON.stringify(impact(result)) === JSON.stringify(impact(capped));
      for (const row of canonical(capped).attribution) {
        const expected = full.get(row.trip_id);
        valid &&= !!expected && row.confirmed_singles.every(w => expected.confirmed_singles.includes(w)) &&
          row.confirmed_runs.every(run => expected.confirmed_runs.some(r => JSON.stringify(r) === JSON.stringify(run)));
        if (row.label !== 'incomplete') valid &&= JSON.stringify(row) === JSON.stringify(expected);
      }
      if (!valid) { differences++; console.error(`BUDGET DIFFERENCE ${test.id} ${budget}`); }
    }
  }
  if (compare && presets[test.id]) {
    const expected = presets[test.id];
    if (JSON.stringify(canonical(result)) !== JSON.stringify(canonical(expected))) {
      console.error(`PYTHON DIFFERENCE ${test.id}`); differences++;
    }
    // Check every candidate's exact classification and time to centiseconds.
    for (const row of expected.trip_statuses) {
      context.row = row;
      const actual = vm.runInContext(`search(a.trip_origin[row.trip_index], [row.trip_index]).get(row.trip_index)`, context);
      context.seconds = actual.seconds;
      const status = vm.runInContext('classify(row.trip_index, seconds)', context);
      const rounded = x => x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100;
      if (row.status !== status || rounded(row.seconds) !== rounded(actual.seconds)) { differences++; console.error(`PRESET TRIP DIFFERENCE ${test.id} ${row.trip_id}`); }
    }
    context.message = {...test, preset: test.id};
    const cached = vm.runInContext('edit(message)', context);
    if (!cached.precomputed || JSON.stringify(canonical(cached)) !== JSON.stringify(canonical(result))) { differences++; console.error(`CACHED DIFFERENCE ${test.id}`); }
  }
}
const validation_wall_ms = performance.now() - start;
const wall_ms = Object.values(outputs).reduce((sum, row) => sum + row.wall_ms, 0);
if (!compare) writeFileSync(new URL('reference-outputs.json', base), JSON.stringify({wall_ms, outputs}));
console.log(`Total edit wall: ${reference ? reference.wall_ms.toFixed(2) + ' -> ' : ''}${wall_ms.toFixed(2)} ms; ${differences} differences`);
console.log(`Run including validation: ${validation_wall_ms.toFixed(2)} ms`);
if (compare) writeFileSync(new URL('comparison-outputs.json', base), JSON.stringify({wall_ms, reference_wall_ms: reference.wall_ms, validation_wall_ms, differences,
  counts: cases.map(c => ({id: c.id, old_searches: reference.outputs[c.id].result.searches,
    new_searches: outputs[c.id].result.searches, bound_searches: outputs[c.id].result.bound_searches,
    old_wall_ms: reference.outputs[c.id].wall_ms, new_wall_ms: outputs[c.id].wall_ms})), outputs}, null, 2));
process.exitCode = differences ? 1 : 0;
