/** P0c-2 Node checkpoint. Run from any cwd; requires the local P0c-1 export.
 * No presets, ALT, cap, network, worker pool, or fractional costs in timed CCH.
 * Attribution uses shipped baseline edge ids, as required by §5.10. Baseline
 * distances are recomputed using integer Dijkstra. The oracle uses its own
 * heap/search; the §5.8 attribution orchestration is shared deliberately.
 */
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {cpus, totalmem, platform, arch, release, endianness} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildCCH} from './cch.js';

const root = new URL('../../../', import.meta.url);
const data = new URL('data/playground-spike/', root);
const json = url => JSON.parse(readFileSync(url, 'utf8'));
const now = () => performance.now();
const output = new URL('results/playground/cch_checkpoint_node.json', root);
const environment = () => ({node: process.version, cpu: cpus()[0].model, logical_cpus: cpus().length,
  ram_bytes: totalmem(), platform: platform(), arch: arch(), release: release()});
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const meta = json(new URL('meta.json', data));
assert.equal(endianness(), 'LE', 'Export is little endian');
const constructors = {'<f8': Float64Array, '<u4': Uint32Array, '<i4': Int32Array, u1: Uint8Array};
const a = {};
for (const spec of meta.arrays) {
  const bytes = gunzipSync(readFileSync(new URL(spec.file, data)));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  a[spec.name] = new constructors[spec.dtype](buffer);
  assert.equal(a[spec.name].length, spec.length);
}
const manifest = json(new URL('order_manifest.json', data));
const orderBytes = gunzipSync(readFileSync(new URL('cch_order.bin.gz', data)));
assert.equal(sha(orderBytes), manifest.output_sha256, 'Order hash');
assert.equal(sha(readFileSync(new URL('cch_order_input.bin', data))), manifest.input_sha256, 'Canonical input hash');
const order = new Uint32Array(orderBytes.buffer.slice(orderBytes.byteOffset, orderBytes.byteOffset + orderBytes.byteLength));
const n = meta.counts.vertices, m = a.edge_source.length;
const weights = Uint32Array.from(a.edge_seconds, (seconds, e) => {
  if (seconds === Infinity) {
    assert.equal(a.edge_initially_active[e], 0, 'Infinite input must be inactive');
    return 0;
  }
  const ms = Math.floor(seconds * 1000 + 0.5);
  assert.ok(Number.isInteger(ms) && ms >= 0 && ms <= 0xffffffff, 'Finite input milliseconds');
  return ms;
});
const active = a.edge_initially_active.slice();
const wayEdges = Array.from({length: meta.counts.ways}, () => []);
for (let e = 0; e < m; e++) wayEdges[a.edge_way[e]].push(e);
const wayIndex = new Map(Array.from(a.way_osm_id, (id, w) => [id, w]));
const path = t => a.trip_path_edges.subarray(a.trip_path_offsets[t], a.trip_path_offsets[t + 1]);
const osm = w => a.way_osm_id[w];

class Heap {
  constructor() { this.nodes = new Uint32Array(1024); this.costs = new Float64Array(1024); this.length = 0; }
  push(v, d) {
    if (this.length === this.nodes.length) {
      const nodes = new Uint32Array(this.length * 2), costs = new Float64Array(this.length * 2);
      nodes.set(this.nodes); costs.set(this.costs); this.nodes = nodes; this.costs = costs;
    }
    let i = this.length++;
    while (i) { const p = (i - 1) >> 1; if (this.costs[p] < d || (this.costs[p] === d && this.nodes[p] <= v)) break;
      this.nodes[i] = this.nodes[p]; this.costs[i] = this.costs[p]; i = p; }
    this.nodes[i] = v; this.costs[i] = d;
  }
  pop() {
    this.node = this.nodes[0]; this.cost = this.costs[0];
    const size = --this.length, v = this.nodes[size], d = this.costs[size];
    let i = 0;
    while (2 * i + 1 < size) {
      let j = 2 * i + 1;
      if (j + 1 < size && (this.costs[j + 1] < this.costs[j] || (this.costs[j + 1] === this.costs[j] && this.nodes[j + 1] < this.nodes[j]))) j++;
      if (this.costs[j] > d || (this.costs[j] === d && this.nodes[j] >= v)) break;
      this.nodes[i] = this.nodes[j]; this.costs[i] = this.costs[j]; i = j;
    }
    this.nodes[i] = v; this.costs[i] = d;
  }
}
function makeDijkstra(mask, costs = weights) {
  const dist = new Float64Array(n), stamp = new Uint32Array(n), pred = new Int32Array(n), heap = new Heap();
  let epoch = 0;
  function search(s, targets, wantPaths = false) {
    if (++epoch === 0xffffffff) { stamp.fill(0); epoch = 1; }
    heap.length = 0; const remaining = new Set(targets);
    stamp[s] = epoch; dist[s] = 0; pred[s] = -1; heap.push(s, 0);
    while (heap.length && remaining.size) {
      heap.pop(); const v = heap.node, d = heap.cost;
      if (d !== dist[v]) continue;
      remaining.delete(v);
      for (let e = a.csr_offsets[v]; e < a.csr_offsets[v + 1]; e++) {
        if (!mask[e]) continue;
        const w = a.edge_target[e], nd = d + costs[e];
        if (stamp[w] !== epoch || nd < dist[w]) {
          stamp[w] = epoch; dist[w] = nd; pred[w] = e; heap.push(w, nd);
        }
      }
    }
    return targets.map(t => {
      const distance = remaining.has(t) ? Infinity : dist[t];
      if (!wantPaths) return distance;
      const edges = [];
      if (Number.isFinite(distance)) for (let v = t; v !== s;) { const e = pred[v]; edges.push(e); v = a.edge_source[e]; }
      edges.reverse(); return {distance, edges};
    });
  }
  return {search};
}
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

// worker.js meteor(): same projection, radius, clamping, coordinate scale and
// segment test. Scan shipped ways directly instead of using its grid prefilter.
function meteor(test) {
  const {lat, lon, radius_m: radius} = test, R = 6371008.8, DEG = Math.PI / 180;
  const sx = R * DEG * Math.cos(lat * DEG), sy = R * DEG, hit = [];
  for (let w = 0; w < meta.counts.ways; w++) {
    const end = a.geometry_offsets[w + 1];
    for (let p = a.geometry_offsets[w] + 1; p < end; p++) {
      const lat0 = a.geometry_coords[2 * (p - 1)] / meta.geometry_scale;
      const lon0 = a.geometry_coords[2 * (p - 1) + 1] / meta.geometry_scale;
      const x = (lon0 - lon) * sx, y = (lat0 - lat) * sy;
      const vx = (a.geometry_coords[2 * p + 1] / meta.geometry_scale - lon0) * sx;
      const vy = (a.geometry_coords[2 * p] / meta.geometry_scale - lat0) * sy;
      const norm = vx * vx + vy * vy;
      const t = norm ? Math.max(0, Math.min(1, -(x * vx + y * vy) / norm)) : 0;
      if ((x + t * vx) ** 2 + (y + t * vy) ** 2 <= radius ** 2) { hit.push(w); break; }
    }
  }
  return hit;
}

const stress = json(new URL('results/playground/stress_set.json', root));
const p0b = json(new URL('results/playground/feasibility_p0b.json', root));
const ids = ['bay_bridge_toll_plaza_500', 'bay_bridge_toll_plaza_150', 'bay_bridge', 'sf_union_square_500', 'stomp_17'];
function hitWaysFor(test) {
  return test.weapon === 'meteor' ? meteor(test) : test.way_ids.map(id => {
    assert.ok(wayIndex.has(id), `Unknown OSM way ${id}`); return wayIndex.get(id);
  });
}
function p0bCaseFor(test) {
  const id = test.id === 'bay_bridge' ? 'bay_bridge_live' : test.weapon === 'meteor' ? `${test.id}_bunlimited` : test.id;
  const row = p0b.cases.find(c => c.id === id); assert.ok(row, id); return row;
}
const hitValidation = ids.map(id => {
  const test = stress.cases.find(c => c.id === id); assert.ok(test, id);
  const ways = hitWaysFor(test), expected = p0bCaseFor(test).ways_hit;
  assert.equal(ways.length, expected, `${id} P0b ways_hit`);
  return {id, ways_hit: ways.length, p0b_ways_hit: expected, identical: true};
});

console.log(`Building CCH: ${n} vertices, ${m} directed input arcs`);
let start = now();
// Measure both modes on the same topology without retaining two CCHs. The
// lower-neighbour intersections remain available for on-demand comparison.
const cch = buildCCH({n, order, tail: a.edge_source, head: a.edge_target});
const buildMs = now() - start, memoryAfterBuild = process.memoryUsage();
const enumerationRepeats = Array.from({length: 5}, () => cch.measureTriangleEnumeration());
const triangleEnumeration = {
  repeats: enumerationRepeats,
  median_on_demand_ms: median(enumerationRepeats.map(r => r.onDemand.ms)),
  median_precomputed_ms: median(enumerationRepeats.map(r => r.precomputed.ms)),
};
for (const row of enumerationRepeats) {
  assert.equal(row.onDemand.count, row.precomputed.count);
  assert.equal(row.onDemand.checksum, row.precomputed.checksum);
}
triangleEnumeration.choice = 'Precomputed lower triangles: measured enumeration is faster; the 8-byte child pair per triangle costs the reported extra buffer bytes. Reverse dependencies are enumerated on demand.';
const finiteWeightSum = weights.reduce((sum, w) => sum + w, 0);
const activeFiniteWeightSum = weights.reduce((sum, w, e) => sum + (!active[e] ? 0 : w), 0);
start = now();
try { cch.customize(weights, active); }
catch (error) {
  const blocked = {step: 'P0c-2', status: 'blocked', measured_at: new Date().toISOString(), environment: environment(),
    order_manifest: manifest, topology: cch.stats(), build_ms: buildMs, triangle_enumeration: triangleEnumeration,
    hit_validation: hitValidation,
    memory_after_build: memoryAfterBuild, memory_after_failed_customize: process.memoryUsage(),
    process_peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
    integer_rounding: 'Math.floor(seconds * 1000 + 0.5)',
    bound: {finite_weight_sum_ms: finiteWeightSum, active_finite_weight_sum_ms: activeFiniteWeightSum, maximum_safe_integer: Number.MAX_SAFE_INTEGER},
    correctness: {identical: null, comparisons: 0, reason: error.message}, cases: [],
    blocker: 'The unmodified export violates the required total finite input weight bound. No routing, attribution, or checkpoint case timings are claimed.'};
  writeFileSync(output, JSON.stringify(blocked, null, 2) + '\n');
  console.error(`Checkpoint blocked: ${error.message}; finite ms=${finiteWeightSum}, active finite ms=${activeFiniteWeightSum}, MAX_SAFE_INTEGER=${Number.MAX_SAFE_INTEGER}. Wrote ${fileURLToPath(output)}`);
  throw error;
}
const customizeMs = now() - start;
const memoryAfterCustomize = process.memoryUsage(); cch.saveBase();
console.log(`Built ${cch.stats().cchArcs} fill arcs, ${cch.stats().triangles} triangles; customize ${customizeMs.toFixed(1)} ms`);
const oracleMask = active.slice(), dijkstra = makeDijkstra(oracleMask);
const allTrips = Array.from(a.trip_origin, (_, i) => i);
const baseline = new Float64Array(allTrips.length), baselinePathDifferences = [];
start = now();
for (const [s, ts] of groups(allTrips)) {
  const rows = dijkstra.search(s, ts.map(t => a.trip_destination[t]), true);
  ts.forEach((t, i) => {
    baseline[t] = rows[i].distance; assert.ok(Number.isFinite(baseline[t]), 'Baseline trip reachable');
    const shipped = [...path(t)], shippedMs = shipped.reduce((sum, e) => sum + weights[e], 0);
    if (JSON.stringify(shipped) !== JSON.stringify(rows[i].edges)) baselinePathDifferences.push({trip: t, shipped_ms: shippedMs,
      shortest_ms: baseline[t], shipped_is_integer_shortest: shippedMs === baseline[t]});
  });
}
const baselineMs = now() - start;
for (const [t, d] of queryTrips({search: (s, targets) => cch.queryMany(s, targets)}, allTrips)) assert.equal(d, baseline[t], `Baseline CCH trip ${t}`);
console.log(`Integer Dijkstra baselines: ${allTrips.length} trips in ${baselineMs.toFixed(1)} ms`);

function timed(timings, key, fn) { const t = now(); const value = fn(); timings[key] = (timings[key] || 0) + now() - t; return value; }
function procedure(test, hitWays, engine, baseDistances = baseline, threshold = 120000) {
  const timings = {initial_edit_update_ms: 0, reroute_queries_ms: 0, single_restore_update_ms: 0, single_queries_ms: 0,
    single_undo_ms: 0, run_restore_update_ms: 0, run_queries_ms: 0, run_undo_ms: 0, unpack_ms: 0};
  const counts = {initial: {dirtyArcs: 0, changedArcs: 0, trianglesScanned: 0}, single: {jobs: 0, dirtyArcs: 0, changedArcs: 0, trianglesScanned: 0},
    run: {jobs: 0, dirtyArcs: 0, changedArcs: 0, trianglesScanned: 0}, unpackedTrips: 0};
  const addCounts = (phase, update) => { if (update) for (const k of ['dirtyArcs', 'changedArcs', 'trianglesScanned']) counts[phase][k] += update[k]; };
  const begin = now(), destroyed = new Set(hitWays);
  const changed = [];
  timed(timings, 'initial_edit_update_ms', () => {
    for (const w of hitWays) for (const e of wayEdges[w]) if (engine.mask[e]) { engine.mask[e] = 0; changed.push(e); }
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
      for (const w of ways) for (const e of wayEdges[w]) if (engine.mask[e] !== a.edge_initially_active[e]) {
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
      engine.unpack(a.trip_origin[row.trip], a.trip_destination[row.trip]); counts.unpackedTrips++;
    }
  });
  timings.total_ms = now() - begin;
  return {ways_hit: hitWays.length, candidate_trips: candidates.length, affected_trips: affected.length,
    broken: affected.filter(r => r.status === 'broken').length, slowed: affected.filter(r => r.status === 'slowed').length,
    added_ms: affected.reduce((sum, row) => sum + (row.added_ms ?? 0), 0), rows: affected, timings, counts};
}

const report = {step: 'P0c-2', status: 'complete', measured_at: new Date().toISOString(), environment: environment(),
  order_manifest: manifest, integer_rounding: 'Math.floor(seconds * 1000 + 0.5)', seed: stress.seed,
  protocol: 'Five sequential live repeats; saved base reset excluded; total includes hit testing, edit, full uncapped batched attribution, undo and unpack of first 25 affected trips. No rendering/transfer in Node.',
  hit_validation: hitValidation, topology: cch.stats(), triangle_enumeration: triangleEnumeration, build_ms: buildMs, full_customization_ms: customizeMs, memory_after_build: memoryAfterBuild,
  memory_after_customize: memoryAfterCustomize, sampled_peak_rss_bytes: Math.max(memoryAfterBuild.rss, memoryAfterCustomize.rss),
  process_peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
  baseline_dijkstra_ms: baselineMs, baseline_path_differences: baselinePathDifferences,
  baseline_note: 'Integer Dijkstra costs; attribution uses shipped baseline paths. A different tied Dijkstra path is recorded, never substituted.',
  bound: {finite_weight_sum_ms: finiteWeightSum, active_finite_weight_sum_ms: activeFiniteWeightSum, maximum_safe_integer: Number.MAX_SAFE_INTEGER},
  correctness: {identical: true, differences: []}, cases: []};
const clean = ({timings, counts, ...result}) => result;
for (const id of ids) {
  const test = stress.cases.find(c => c.id === id); assert.ok(test, id);
  const p0bCase = p0bCaseFor(test);
  console.log(`${id}: integer Dijkstra oracle (full attribution)`);
  const hit = () => hitWaysFor(test);
  const hitWays = hit(); assert.equal(hitWays.length, p0bCase.ways_hit, `${id} P0b ways_hit`);
  oracleMask.set(a.edge_initially_active);
  const oracle = procedure(test, hitWays, {mask: oracleMask, search: dijkstra.search, update: () => null});
  const repeats = [];
  for (let i = 0; i < 5; i++) {
    cch.restoreBase(); const t = now(), ways = hit(), hitMs = now() - t;
    assert.equal(ways.length, p0bCase.ways_hit);
    const actual = procedure(test, ways, {mask: active, search: (s, ts) => cch.queryMany(s, ts),
      update: cch.update, undo: cch.undo, unpack: cch.unpack});
    actual.timings.hit_test_ms = hitMs; actual.timings.total_ms += hitMs;
    try { assert.deepEqual(clean(actual), clean(oracle)); }
    catch (error) { report.correctness.identical = false; report.correctness.differences.push({id, repeat: i, message: error.message}); }
    repeats.push({timings: actual.timings, counts: actual.counts});
    report.sampled_peak_rss_bytes = Math.max(report.sampled_peak_rss_bytes, process.memoryUsage().rss);
  }
  const timings = Object.fromEntries(Object.keys(repeats[0].timings).map(k => [k, median(repeats.map(r => r.timings[k]))]));
  report.cases.push({id, live: true, p0b_ways_hit: p0bCase.ways_hit, ...clean(oracle), median_timings: timings, repeats});
  console.log(`${id}: ${oracle.affected_trips} affected (${oracle.broken} broken), ${timings.total_ms.toFixed(1)} ms median, oracle ${report.correctness.identical ? 'identical' : 'DIFFERS'}`);
}
report.status = report.correctness.identical ? 'complete' : 'failed';
report.process_peak_rss_bytes = process.resourceUsage().maxRSS * 1024;
report.correctness.comparisons = ids.length * 5;
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Wrote ${fileURLToPath(output)}; correctness identical: ${report.correctness.identical}`);
assert.ok(report.correctness.identical, 'CCH differs from integer Dijkstra; see checkpoint differences');
