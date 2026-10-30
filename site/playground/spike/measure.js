/** Browser acceptance harness. Every edit is checked against the integer oracle. */
import {canonical} from '../core/procedure.js';
const status = document.getElementById('status'), error = document.getElementById('error');
const run = document.getElementById('run'), download = document.getElementById('download');
let sequence = 0, map, loadData, measurements, reference, stress;
const worker = new Worker('worker.js', {type: 'module'}), pending = new Map();
worker.onmessage = ({data}) => {
  const entry = pending.get(data.requestId); if (!entry) return;
  pending.delete(data.requestId);
  if (data.error) entry.reject(new Error(data.error)); else entry.resolve(data.result);
};
worker.onerror = event => {
  for (const entry of pending.values()) entry.reject(new Error(event.message));
  pending.clear(); fail(new Error(event.message));
};
function request(payload) {
  return new Promise((resolve, reject) => {
    const requestId = ++sequence; pending.set(requestId, {resolve, reject});
    worker.postMessage({...payload, requestId});
  });
}
function fail(e) { error.textContent = e.stack || String(e); status.textContent = 'Failed'; }
async function coldJSON(path) {
  const response = await fetch(`${path}?cold=${crypto.randomUUID()}`, {cache: 'no-store'});
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
async function memory() {
  if (!crossOriginIsolated) return {value: null, reason: 'crossOriginIsolated is false'};
  if (!performance.measureUserAgentSpecificMemory) return {value: null, reason: 'measureUserAgentSpecificMemory unavailable'};
  try { return {value: await performance.measureUserAgentSpecificMemory(), reason: null,
    scope: 'Whole isolated page including its dedicated worker and map workers; browser does not expose an engine-only total.'}; }
  catch (e) { return {value: null, reason: String(e)}; }
}
function draw(geojson) {
  return new Promise((resolve, reject) => {
    // Listener precedes setData; wait for a source event marking this update loaded.
    let timeout;
    const loaded = event => {
      if (event.sourceId !== 'affected-routes' || !map.isSourceLoaded('affected-routes')) return;
      map.off('sourcedata', loaded); clearTimeout(timeout);
      requestAnimationFrame(resolve);
    };
    map.on('sourcedata', loaded);
    timeout = setTimeout(() => { map.off('sourcedata', loaded); reject(new Error('Routes source load timed out')); }, 30000);
    map.getSource('affected-routes').setData(geojson);
  });
}
const resources = () => performance.getEntriesByType('resource').map(r => ({name: r.name,
  transferSize: r.transferSize, encodedBodySize: r.encodedBodySize, decodedBodySize: r.decodedBodySize}));
const median = values => [...values].sort((a,b) => a-b)[2];
function publish() {
  document.getElementById('result').textContent = JSON.stringify(measurements, null, 2);
  const compactMemory = sample => sample ? {bytes: sample.value?.bytes ?? null, reason: sample.reason, scope: sample.scope} : null;
  const {resources: resourceDetails, memory_after_load: loadMemory, ...compactLoad} = measurements.load;
  window.__summary = {...measurements, load: {...compactLoad,
      resource_count: resourceDetails.length, memory_after_load: compactMemory(loadMemory)},
    memory_after_50_edits: compactMemory(measurements.memory_after_50_edits),
    cases: measurements.cases.map(({runs, ...summary}) => summary)};
  if (new TextEncoder().encode(JSON.stringify(window.__summary)).length > 100000) throw new Error('__summary exceeds 100 KB');
}
async function initialize() {
  try {
    performance.setResourceTimingBufferSize(5000);
    map = new maplibregl.Map({container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
      center: [-122.25, 37.72], zoom: 9});
    map.addControl(new maplibregl.NavigationControl());
    map.addControl(new maplibregl.AttributionControl({compact: false,
      customAttribution: 'OpenFreeMap | OpenMapTiles | © OpenStreetMap contributors'}));
    const mapReady = new Promise((resolve, reject) => { map.once('load', resolve); map.once('error', e => reject(e.error)); });
    const [loaded, frozen, tests] = await Promise.all([request({type: 'load'}),
      coldJSON('../../../data/playground-spike/reference-ms.json'),
      coldJSON('../../../results/playground/stress_set.json'), mapReady]);
    for (const [file, hash] of Object.entries(frozen.data_hashes || {}))
      if (loaded.hashes[file] !== hash) throw new Error(`Stale integer reference: ${file}`);
    if (!frozen.data_hashes) throw new Error('Integer reference has no data hashes; rerun check.mjs');
    reference = frozen.outputs; stress = tests;
    map.addSource('affected-routes', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    for (const [phase, color] of [['before', '#777'], ['after', '#007aff']])
      map.addLayer({id: `${phase}-routes`, type: 'line', source: 'affected-routes', filter: ['==', ['get', 'phase'], phase],
        paint: {'line-color': color, 'line-width': 3}});
    const pageReady = performance.now(); // Navigation start is performance time zero.
    const rows = [...resources(), ...loaded.resources];
    loadData = {snapshot: loaded.meta.snapshot, git_commit: loaded.meta.git_commit, counts: loaded.meta.counts,
      page_ready_ms: pageReady, worker_load_ms: loaded.load_ms, stats: loaded.stats,
      shipped_total_bytes: loaded.meta.total_shipped_bytes, files: loaded.meta.files,
      resources: rows, transfer_size_total: rows.reduce((sum,r) => sum+r.transferSize, 0),
      graph_transfer_size_total: loaded.resources.reduce((sum,r) => sum+r.transferSize, 0),
      cache: 'Graph, oracle and stress fetches use no-store and unique query strings; server also sends no-store.',
      cold_graph_verified: loaded.resources.length === loaded.meta.files.length && loaded.resources.every(r => r.transferSize > 0),
      transfer_note: 'All resource entries retained; third-party zeros mean timing unavailable. Tile transfers included where exposed.',
      hashes: loaded.hashes, order_hash: loaded.order_hash};
    loadData.memory_after_load = await memory();
    status.textContent = 'Ready. Run all stress cases with full attribution.'; run.disabled = false;
  } catch (e) { fail(e); }
}
run.onclick = async () => {
  run.disabled = true; download.disabled = true;
  try {
    measurements = {measured_at: new Date().toISOString(), load: loadData,
      environment: {userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory ?? null, crossOriginIsolated, devicePixelRatio,
        viewport: {width: innerWidth, height: innerHeight}, url: location.href},
      protocol: '50-edit memory exercise precedes timing repeats. 5 repeats; send edit → full attribution, unpack ≤25, transfer, GeoJSON source loaded, next animation frame. Rebuild timed separately.',
      seed: stress.seed, cases: []};
    status.textContent = 'Measuring memory after 50 repeated toll-plaza edits…';
    for (let i = 0; i < 50; i++) await request(stress.cases.find(test => test.id === 'bay_bridge_toll_plaza_500'));
    measurements.memory_after_50_edits = await memory();
    const cases = stress.cases.flatMap(test => ['bay_bridge', 'university_ramp'].includes(test.id)
      ? [{id: `${test.id}_live`, test}, {id: `${test.id}_preset`, test: {...test, preset: test.id}}]
      : [{id: test.id, test}]);
    for (const {id, test} of cases) {
      const runs = [];
      for (let repeat = 0; repeat < 5; repeat++) {
        status.textContent = `${id}: ${repeat+1}/5`;
        let start = performance.now();
        await request({weapon: 'reset'});
        await draw({type: 'FeatureCollection', features: []});
        const reset_ms = performance.now()-start;
        start = performance.now(); // Timer starts immediately before sending the edit.
        const result = await request(test);
        await draw(result.geojson);
        const latency_ms = performance.now()-start;
        const actual = canonical(result), expected = reference[test.id];
        const reference_match = JSON.stringify(actual) === JSON.stringify(expected);
        const {geojson, ...details} = result;
        runs.push({latency_ms, reset_ms, reference_match, ...details});
        // Keep failed results reviewable before stopping the acceptance run.
        if (!reference_match) {
          measurements.cases.push({id, runs, failed: true}); publish();
          throw new Error(`Integer reference mismatch: ${id} repeat ${repeat+1}`);
        }
      }
      const first = runs[0];
      measurements.cases.push({id, median_ms: median(runs.map(r => r.latency_ms)),
        latency_ms: runs.map(r => r.latency_ms), reset_ms: runs.map(r => r.reset_ms),
        reference_match: runs.map(r => r.reference_match),
        counts: {ways_hit: first.ways_hit, candidate_trips: first.candidate_trips, affected_trips: first.affected_trips,
          broken: first.broken, slowed: first.slowed, added_ms: first.added_ms, phases: first.counts ?? null}, runs});
      publish();
    }
    publish(); status.textContent = 'Complete. All repeats match the integer reference.'; download.disabled = false;
  } catch (e) { fail(e); }
  finally { run.disabled = false; }
};
download.onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(measurements, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'playground-browser-measurements.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.getElementById('retry').onclick = () => location.reload();
initialize();
