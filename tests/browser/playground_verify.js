/** Local-only worker/oracle and real-page verification; never shipped under site/. */
import {canonical} from '../../site/playground/core/procedure.js';

const $ = id => document.getElementById(id);
const dataBase = '../../site/playground/data/';
// Paths resolve relative to this harness page, e.g. ?set=../../results/playground/p4_verify_set.json
// &oracle=../../results/playground/p4_oracle.json&expected=18&output=p4_browser_check.json
const params = new URLSearchParams(location.search);
const setPath = params.get('set') ?? '../../results/playground/p2_verify_set.json';
const oraclePath = params.get('oracle') ?? '../../results/playground/p2_oracle.json';
const expectedCases = Number(params.get('expected') ?? 15);
// Defaults retain the P2/P4a compute-only cycles; opt in with ?animations=1.
const animationsOn = params.get('animations') === '1';
const outputFilename = params.get('output') ?? 'p2_browser_check.json';
$('download').textContent = `Download ${outputFilename}`;
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
    'edge_twin', 'way_osm_id', 'trip_origin', 'trip_destination', 'geometry_coords', 'geometry_offsets'];
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
// canonical-v1 records only the hit count. Independently reconstruct the full hit set
// from the oracle case and shipped geometry, using its local metre projection.
function meteorHits(a, meta, edit) {
  const k = meta.earth_radius_m * Math.PI / 180, kx = k * Math.cos(edit.lat * Math.PI / 180);
  const point = p => [(a.geometry_coords[2 * p + 1] / meta.geometry_scale - edit.lon) * kx,
    (a.geometry_coords[2 * p] / meta.geometry_scale - edit.lat) * k];
  const hits = [];
  for (let w = 0; w < a.way_osm_id.length; w++) {
    for (let p = a.geometry_offsets[w] + 1; p < a.geometry_offsets[w + 1]; p++) {
      const [ax, ay] = point(p - 1), [bx, by] = point(p);
      const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
      if ((ax + t * dx) ** 2 + (ay + t * dy) ** 2 <= edit.radius_m ** 2) {
        hits.push(a.way_osm_id[w]);
        break;
      }
    }
  }
  return hits.sort((a, b) => a - b);
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
async function cycles(largeCase, oracle, a, meta, cases) {
  const frame = document.createElement('iframe');
  frame.title = 'Real playground cycle check';
  const loaded = new Promise(resolve => { frame.onload = resolve; });
  frame.src = '../../site/playground/?test';
  $('page').append(frame);
  await withTimeout(loaded, 'Playground iframe');
  const hook = frame.contentWindow.__playground;
  if (!hook) throw new Error('Playground test hook unavailable');
  await withTimeout(hook.ready, 'Playground ready');
  hook.setReducedMotion(!animationsOn);
  const result = {animations_on: animationsOn, fire_ms: [], rebuild_ms: [], counts_after_1: null, counts_after_50: null, pass: false};
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
  if (largeCase) {
    const doc = frame.contentDocument;
    doc.querySelector('[data-weapon="meteor"]').click();
    const large = doc.querySelector(`[name="meteor-size"][value="${largeCase.radius_m}"]`);
    if (!large) throw new Error('Large Meteor control unavailable');
    large.click();
    // Omit radius deliberately: exercise the selected radio, not just the explicit hook argument.
    await withTimeout(hook.fireMeteor(largeCase.lat, largeCase.lon), 'Large Meteor draw');
    const expected = oracle.outputs[largeCase.id];
    const difference = firstDifference(routing(hook.result()), expected);
    const hitDifference = firstDifference(hook.hitWayIds(),
      meteorHits(a, meta, largeCase));
    result.large_meteor = {id: largeCase.id, equal: !difference && !hitDifference,
      first_difference: difference ?? hitDifference};
    addRow('Real page Large Meteor', result.large_meteor.equal, '', '', difference ?? hitDifference ?? '');
    await withTimeout(hook.rebuild(), 'Large Meteor Rebuild');
  }
  result.animation_checks = await animationChecks(frame, hook, cases, oracle);
  result.page_cases = [];
  if (animationsOn) for (const edit of cases) {
    hook.setReducedMotion(false);
    if (edit.weapon === 'meteor') await hook.fireMeteor(edit.lat,edit.lon,edit.radius_m);
    else await hook.fireRoad(edit.weapon,edit.way_id ?? edit.way_ids);
    result.page_cases.push({id:edit.id,equal:!firstDifference(routing(hook.result()),oracle.outputs[edit.id])});
    await hook.rebuild();
  }
  result.fx_checks = await fxChecks(frame,hook);
  result.hidden_traffic = await hiddenTrafficCheck(hook,frame.contentDocument);
  result.pass &&= result.animation_checks.pass && result.page_cases.every(row => row.equal) && result.fx_checks.pass && result.hidden_traffic.pass!==false;
  return result;
}

async function waitUntil(check,label) {
  const deadline=performance.now()+30000;
  while (!check()) {
    if (performance.now()>deadline) throw new Error(`${label} timed out`);
    await new Promise(resolve => setTimeout(resolve,50));
  }
}

async function fxChecks(frame,hook) {
  await waitUntil(() => hook.fxStats().enabled,'FX load');
  const first=hook.fxStats(), doc=frame.contentDocument, radii=[];
  hook.setReducedMotion(false);
  const meteor=hook.fireMeteor(37.7946,-122.3999,500);
  await new Promise(resolve => setTimeout(resolve,540));
  for (const zoom of [13,14]) {
    hook.camera({lng:-122.3999,lat:37.7946,zoom,pitch:0});
    await new Promise(resolve => frame.contentWindow.requestAnimationFrame(resolve));
    radii.push({zoom,fx:hook.fxRingRadiusPx(),overlay:hook.fxRingRadiusPx(true)});
  }
  await meteor;
  const scale=radii.every(r => r.fx>0 && Math.abs(r.fx-r.overlay)<=2) && Math.abs(radii[1].fx/radii[0].fx-2)<=0.06;
  await hook.rebuild();
  for (let i=0;i<3;i++) {
    doc.getElementById('theme').click();
    await waitUntil(() => {try{return hook.fxStats().enabled && hook.counts().fx_layers===1;}catch{return false;}},'Theme FX');
  }
  hook.loseContext();
  await waitUntil(() => !hook.fxStats().enabled,'Context loss');
  hook.restoreContext();
  await waitUntil(() => {try{return hook.fxStats().enabled && hook.counts().fx_layers===1;}catch{return false;}},'Context restore');
  hook.fxRing(37.7946,-122.3999,500,1000);
  await waitUntil(() => hook.fxStats().drawnLastFrame>0,'Restored FX drawing');
  const last=hook.fxStats(), lifecycle=hook.counts().fx_layers===1 && last.buffers===first.buffers && last.programs===first.programs;
  await hook.rebuild();
  addRow('FX metre scale',scale); addRow('FX lifecycle',lifecycle);
  return {radii,scale,first,last,lifecycle,pass:scale && lifecycle};
}

async function animationChecks(frame, hook, cases, oracle) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const doc = frame.contentDocument;
  const announcement = doc.getElementById('announcement');
  const weapons = [];
  for (const weapon of ['stomp', 'flip']) {
    const edit = cases.find(edit => edit.weapon === weapon && edit.way_id !== undefined);
    if (!edit) throw new Error(`Missing ${weapon} oracle case`);
    hook.setReducedMotion(true);
    await hook.fireRoad(weapon, edit.way_id);
    const result = routing(hook.result()), hit = hook.hitWayIds();
    const text = doc.getElementById('results').textContent;
    await hook.rebuild();
    hook.setReducedMotion(false);
    const pending = hook.fireRoad(weapon, edit.way_id);
    const running = hook.animationsRunning();
    await pending;
    const pass = running && !firstDifference(routing(hook.result()), oracle.outputs[edit.id])
      && !firstDifference(routing(hook.result()), result)
      && !firstDifference(hook.hitWayIds(), hit) && doc.getElementById('results').textContent === text;
    weapons.push({weapon, pass});
    addRow(`${weapon} animation result`, pass);
    await hook.rebuild();
  }
  hook.setReducedMotion(true);
  await hook.fireMeteor(37.7946, -122.3999);
  const expected = routing(hook.result()), expectedHits = hook.hitWayIds();
  await hook.rebuild();
  const announcements = [];
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const text = record.target.textContent;
      if (text) announcements.push(text);
    }
  });
  observer.observe(announcement, {childList: true, characterData: true, subtree: true});
  try {
    hook.setReducedMotion(false);
    const first = hook.fireMeteor(37.825, -122.315).then(() => false, () => true);
    await sleep(100);
    const firstRunning = hook.animationsRunning();
    const second = await hook.fireMeteor(37.7946, -122.3999);
    await sleep(0); // Flush MutationObserver delivery.
    const rapid = firstRunning && await first && second.phase === 'showing'
      && !firstDifference(routing(hook.result()), expected)
      && !firstDifference(hook.hitWayIds(), expectedHits) && announcements.length === 1
      && !hook.animationsRunning();
    await hook.rebuild();
    announcements.length = 0;
    const interrupted = hook.fireMeteor(37.825, -122.315).then(() => false, () => true);
    await sleep(100);
    const rebuildRunning = hook.animationsRunning();
    await hook.rebuild();
    await sleep(1100); // Past both size deadlines: no stale completion may restore anything.
    const rebuilt = rebuildRunning && await interrupted && hook.result() === null
      && hook.hitWayIds().length === 0 && !hook.staticOutline()
      && !hook.animationsRunning() && announcements.length === 0 && announcement.textContent === '';
    hook.setReducedMotion(true);
    hook.camera({lng:-122.3999,lat:37.7946,zoom:16,pitch:40});
    await waitUntil(() => hook.buildingIdProbe().sample.some(b => b.hasId),'Reduced-motion buildings');
    const framesBefore = hook.animationFramesScheduled();
    const reduced = await hook.fireMeteor(37.7946, -122.3999);
    const positions=hook.trafficSample(20), trafficFrames=hook.trafficFramesRequested();
    await sleep(1000);
    const endState=hook.fxEndState();
    const stillTraffic=!firstDifference(hook.trafficSample(20),positions)
      && hook.trafficFramesRequested()===trafficFrames && !hook.trafficStats().moving;
    const staticFx=endState.crater && endState.sunk>0 && endState.sinkK===0 && hook.fxStats().drawnLastFrame>=2;
    const reducedPass = reduced.phase === 'showing' && !hook.animationsRunning()
      && hook.animationFramesScheduled() === framesBefore && hook.staticOutline() && stillTraffic && staticFx
      && !firstDifference(routing(hook.result()), expected)
      && !firstDifference(hook.hitWayIds(), expectedHits) && announcements.length === 1;
    await hook.rebuild();
    announcements.length = 0;
    hook.setReducedMotion(false);
    const changing = hook.fireMeteor(37.7946, -122.3999);
    await sleep(100);
    hook.setReducedMotion(true);
    await changing;
    await sleep(0);
    const changed = !hook.animationsRunning() && hook.staticOutline()
      && !firstDifference(routing(hook.result()), expected) && announcements.length === 1;
    await hook.rebuild();
    const checks = {weapon_results: weapons.every(check => check.pass), rapid_edit: rapid, rebuild: rebuilt, reduced_motion: reducedPass,
      preference_change: changed, pass: weapons.every(check => check.pass) && rapid && rebuilt && reducedPass && changed};
    for (const [name, pass] of Object.entries(checks)) if (name !== 'pass') addRow(name, pass);
    return checks;
  } finally { observer.disconnect(); }
}
// Opt in with &visibility=1, switch away, then return. Visibility is never simulated.
async function hiddenTrafficCheck(hook, doc) {
  if (params.get('visibility')!=='1') return {skipped:'Requires a real tab switch; opt in with visibility=1'};
  addRow('Switch to another tab for at least one second, then return', true);
  return new Promise(resolve => {
    let before, hiddenAt;
    const timeout=setTimeout(() => finish({pass:false,reason:'No complete tab switch within 60 s'}),60000);
    function finish(result) { clearTimeout(timeout); doc.removeEventListener('visibilitychange',change); resolve(result); }
    async function change() {
      if (doc.hidden) { before=hook.trafficFramesRequested(); hiddenAt=performance.now(); }
      else if (before!==undefined) {
        const paused=hook.trafficFramesRequested()===before, elapsed=performance.now()-hiddenAt;
        await sleep(100);
        finish({pass:paused && elapsed>=1000 && hook.trafficFramesRequested()>before,hidden_ms:elapsed});
      }
    }
    hook.setReducedMotion(false);
    doc.addEventListener('visibilitychange',change);
  });
}
async function main() {
  const [set, oracle, metaBytes] = await Promise.all([
    fetchBytes(setPath).then(decode),
    fetchBytes(oraclePath).then(decode), fetchBytes(dataBase + 'meta.json'),
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
  const largeCase = set.cases.find(edit => edit.weapon === 'meteor' && edit.radius_m === 1500);
  if (expectedCases > 15 && !largeCase) throw new Error('Missing Large Meteor oracle case');
  report.cycles = await cycles(largeCase, oracle, a, meta, set.cases);
  addRow('50 page cycles', report.cycles.pass);
  report.totals = {cases_equal: report.cases.filter(row => row.equal).length, cases: report.cases.length,
    presets_equal: report.presets.filter(row => row.equal).length,
    drawn_valid: report.cases.reduce((sum, row) => sum + row.drawn_valid, 0),
    drawn_total: report.cases.reduce((sum, row) => sum + row.drawn_paths, 0)};
  const totals = report.totals;
  const pass = totals.cases === expectedCases && totals.cases_equal === expectedCases && totals.presets_equal === 2
    && totals.drawn_valid === totals.drawn_total && report.cycles.pass
    && (!largeCase || report.cycles.large_meteor.equal);
  $('verdict').textContent = pass ? 'PASS' : 'FAIL';
  $('verdict').style.color = pass ? '#176a32' : '#b02020';
  $('status').textContent = `${totals.cases_equal}/${totals.cases} cases; ${totals.presets_equal}/2 presets; ${totals.drawn_valid}/${totals.drawn_total} drawn paths valid.`;
  window.__p2result = report;
  $('download').disabled = false;
  $('download').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = outputFilename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
main().catch(error => {
  $('verdict').textContent = 'FAIL';
  $('verdict').style.color = '#b02020';
  $('status').textContent = error.stack || String(error);
});
