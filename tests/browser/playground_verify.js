/** Local-only worker/oracle and real-page verification; never shipped under site/. */
import {canonical} from '../../site/playground/core/procedure.js';

const $ = id => document.getElementById(id);
const dataBase = '../../site/playground/data/';
async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}
const decode = bytes => JSON.parse(new TextDecoder().decode(bytes));

// Object key order is irrelevant; array order and all scalar values are exact.
function firstDifference(actual, expected, path = '$') {
  if (Object.is(actual, expected)) return null;
  if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') return path;
  if (Array.isArray(actual) !== Array.isArray(expected)) return path;
  if (Array.isArray(actual) && actual.length !== expected.length) return `${path}.length`;
  const keys = [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort();
  for (const key of keys) {
    const next = Array.isArray(actual) ? `${path}[${key}]` : `${path}.${key}`;
    if (!Object.hasOwn(actual, key) || !Object.hasOwn(expected, key)) return next;
    const difference = firstDifference(actual[key], expected[key], next);
    if (difference) return difference;
  }
  return null;
}
function routing(result) {
  // Match the protocol's Node oracle tests: these two fields are for the sheet only.
  return canonical({...result, rows: result.rows.map(({trip_label, trip_ms, ...row}) => row)});
}
function addRow(name, equal, ms = '', paths = '', difference = '') {
  const row = document.createElement('tr');
  for (const value of [name, equal ? 'PASS' : 'FAIL', ms, paths, difference]) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }
  $('checks').append(row);
}
function workerClient(worker) {
  let next = 0;
  const pending = new Map();
  worker.onmessage = ({data}) => {
    const waiter = pending.get(data.id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    pending.delete(data.id);
    if (data.ok) waiter.resolve(data.result);
    else waiter.reject(new Error(data.error));
  };
  worker.onerror = event => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(event.message));
    }
    pending.clear();
  };
  return (type, payload = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Worker ${type} timed out`)); }, 120000);
    pending.set(id, {resolve, reject, timer});
    worker.postMessage({id, type, ...payload});
  });
}
async function arrays(meta) {
  const names = ['csr_offsets', 'edge_target', 'edge_ms', 'edge_way', 'edge_initially_active',
    'edge_twin', 'way_osm_id', 'trip_origin', 'trip_destination'];
  const types = {'<f8': Float64Array, '<u4': Uint32Array, '<i4': Int32Array, u1: Uint8Array};
  const entries = await Promise.all(names.map(async name => {
    const spec = meta.arrays.find(entry => entry.name === name);
    if (!spec || !types[spec.dtype]) throw new Error(`Missing or unsupported array ${name}`);
    let raw = await fetchBytes(dataBase + spec.file);
    if (spec.file.endsWith('.gz')) raw = await new Response(new Blob([raw]).stream()
      .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const values = new types[spec.dtype](raw.slice(spec.byte_offset ?? 0));
    if (values.length !== spec.length) throw new Error(`Length mismatch ${name}`);
    return [name, values];
  }));
  const a = Object.fromEntries(entries);
  a.edge_source = new Uint32Array(a.edge_target.length);
  for (let vertex = 0; vertex < a.csr_offsets.length - 1; vertex++)
    a.edge_source.fill(vertex, a.csr_offsets[vertex], a.csr_offsets[vertex + 1]);
  return a;
}
function validatePaths(a, edit, result) {
  if (!Array.isArray(result.debug?.drawn)) throw new Error('Missing debug.drawn');
  const indices = new Map(Array.from(a.way_osm_id, (id, index) => [id, index]));
  const hits = new Set(result.ways.map(({way_id}) => {
    if (!indices.has(way_id)) throw new Error(`Unknown hit way ${way_id}`);
    return indices.get(way_id);
  }));
  const active = a.edge_initially_active.slice();
  for (let edge = 0; edge < active.length; edge++) {
    if (hits.has(a.edge_way[edge])) active[edge] = 0;
  }
  if (edit.weapon === 'flip') {
    for (let edge = 0; edge < active.length; edge++) {
      if (!hits.has(a.edge_way[edge]) || !a.edge_initially_active[edge]) continue;
      const twin = a.edge_twin[edge];
      if (twin < 0 || twin >= active.length) throw new Error(`Invalid twin ${twin}`);
      active[twin] = 1;
    }
  }
  let valid = 0;
  for (const {trip, edges} of result.debug.drawn) {
    const row = result.rows.find(row => row.trip === trip);
    let connected = Array.isArray(edges) && edges.length > 0 && row?.distance_ms !== null && !!row;
    let cost = 0;
    for (let i = 0; connected && i < edges.length; i++) {
      const edge = edges[i];
      connected = Number.isInteger(edge) && edge >= 0 && edge < active.length && !!active[edge]
        && (i === 0 || a.edge_target[edges[i - 1]] === a.edge_source[edge]);
      cost += a.edge_ms[edge];
    }
    if (connected && a.edge_source[edges[0]] === a.trip_origin[trip]
      && a.edge_target[edges.at(-1)] === a.trip_destination[trip] && cost === row.distance_ms) valid++;
  }
  // Missing or duplicate debug paths must not produce a vacuous pass.
  const expected = result.rows.slice(0, 25).filter(row => row.distance_ms !== null).map(row => row.trip);
  const actual = result.debug.drawn.map(row => row.trip);
  if (firstDifference(actual, expected)) throw new Error('Drawn trip list differs from the first 25 routable affected rows');
  return {drawn_paths: actual.length, drawn_valid: valid};
}
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length / 2;
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle) - 1]) / 2;
};
async function withTimeout(promise, label, ms = 120000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function cycles() {
  const frame = document.createElement('iframe');
  frame.title = 'Real playground cycle check';
  const loaded = new Promise(resolve => { frame.onload = resolve; });
  frame.src = '../../site/playground/?test';
  $('page').append(frame);
  await withTimeout(loaded, 'Playground iframe');
  const hook = frame.contentWindow.__playground;
  if (!hook) throw new Error('Playground test hook unavailable');
  await withTimeout(hook.ready, 'Playground ready');
  const result = {fire_ms: [], rebuild_ms: [], counts_after_1: null, counts_after_50: null, pass: false};
  for (let cycle = 1; cycle <= 50; cycle++) {
    $('status').textContent = `Real page: cycle ${cycle}/50`;
    const fire = await withTimeout(hook.fireMeteor(37.825, -122.315), 'Meteor draw');
    const rebuild = await withTimeout(hook.rebuild(), 'Rebuild draw');
    if (fire.phase !== 'showing' || rebuild.phase !== 'ready') throw new Error('Unexpected page phase');
    result.fire_ms.push(fire.ms);
    result.rebuild_ms.push(rebuild.ms);
    if (cycle === 1) result.counts_after_1 = hook.counts();
    if (cycle === 50) result.counts_after_50 = hook.counts();
  }
  result.pass = !firstDifference(result.counts_after_1, result.counts_after_50)
    && ['fire_ms', 'rebuild_ms'].every(key => median(result[key].slice(-10)) <= 1.5 * median(result[key].slice(0, 10)));
  return result;
}
async function main() {
  const [set, oracle, metaBytes] = await Promise.all([
    fetchBytes('../../results/playground/p2_verify_set.json').then(decode),
    fetchBytes('../../results/playground/p2_oracle.json').then(decode), fetchBytes(dataBase + 'meta.json'),
  ]);
  const meta = decode(metaBytes);
  if (set.snapshot !== meta.snapshot || oracle.snapshot !== meta.snapshot || set.seed !== oracle.seed)
    throw new Error('Check set, oracle and export snapshot/seed mismatch');
  const a = await arrays(meta);
  const report = {measured_at: new Date().toISOString(), user_agent: navigator.userAgent,
    git_commit: meta.git_commit,
    meta_sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', metaBytes))]
      .map(byte => byte.toString(16).padStart(2, '0')).join(''), cases: [], presets: [], cycles: null, totals: null};
  const worker = new Worker('../../site/playground/worker.js', {type: 'module'});
  const request = workerClient(worker), live = new Map();
  try {
    await request('load');
    for (const edit of set.cases) {
      $('status').textContent = `Worker: ${edit.id}`;
      const start = performance.now();
      const result = await request('edit', {edit, debug: true});
      const ms = performance.now() - start;
      const output = routing(result);
      live.set(edit.id, output);
      const difference = firstDifference(output, oracle.outputs[edit.id]);
      const check = {id: edit.id, equal: !difference, ...(difference ? {first_difference: difference} : {}),
        ms, ...validatePaths(a, edit, result)};
      report.cases.push(check);
      addRow(edit.id, check.equal && check.drawn_valid === check.drawn_paths, ms.toFixed(2),
        `${check.drawn_valid}/${check.drawn_paths}`, difference || '');
    }
    for (const name of ['bay_bridge', 'university_ramp']) {
      const precomputed = routing(await request('edit', {edit: {preset: name}}));
      const difference = firstDifference(precomputed, live.get(`${name}_live`));
      report.presets.push({name, equal: !difference});
      addRow(`Preset ${name}`, !difference, '', '', difference || '');
    }
  } finally { worker.terminate(); }
  report.cycles = await cycles();
  addRow('50 page cycles', report.cycles.pass);
  report.totals = {cases_equal: report.cases.filter(row => row.equal).length, cases: report.cases.length,
    presets_equal: report.presets.filter(row => row.equal).length,
    drawn_valid: report.cases.reduce((sum, row) => sum + row.drawn_valid, 0),
    drawn_total: report.cases.reduce((sum, row) => sum + row.drawn_paths, 0)};
  const totals = report.totals;
  const pass = totals.cases === 15 && totals.cases_equal === 15 && totals.presets_equal === 2
    && totals.drawn_valid === totals.drawn_total && report.cycles.pass;
  $('verdict').textContent = pass ? 'PASS' : 'FAIL';
  $('verdict').style.color = pass ? '#176a32' : '#b02020';
  $('status').textContent = `${totals.cases_equal}/${totals.cases} cases; ${totals.presets_equal}/2 presets; ${totals.drawn_valid}/${totals.drawn_total} drawn paths valid.`;
  window.__p2result = report;
  $('download').disabled = false;
  $('download').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'p2_browser_check.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
main().catch(error => {
  $('verdict').textContent = 'FAIL';
  $('verdict').style.color = '#b02020';
  $('status').textContent = error.stack || String(error);
});
