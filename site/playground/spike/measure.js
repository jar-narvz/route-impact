/* Real browser measurements only. Never writes feasibility.json in the repository. */
'use strict';
import {RoutingPool} from './pool.mjs';
const statusLine = document.getElementById('status');
const errorLine = document.getElementById('error');
const runButton = document.getElementById('run');
const downloadButton = document.getElementById('download');
const retryButton = document.getElementById('retry');
let running = false;
const P = Math.min(Math.max((navigator.hardwareConcurrency || 2) - 1, 1), 8);
let pool, map, loadData, measurements, nextId = 0;
const heapSamples = [];
const heap = () => performance.memory ? {
  usedJSHeapSize: performance.memory.usedJSHeapSize,
  totalJSHeapSize: performance.memory.totalJSHeapSize,
  jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
} : null;
function sampleHeap() {
  const value = heap();
  if (value) heapSamples.push(value.usedJSHeapSize);
  return value;
}
function fail(error) {
  errorLine.textContent = error.message || String(error);
  statusLine.textContent = 'Failed. See the error above.';
  retryButton.hidden = false;
}
function createClient() {
  const worker = new Worker('worker.js'), pending = new Map();
  worker.onmessage = ({data}) => {
    const item = pending.get(data.requestId);
    if (!item) return;
    pending.delete(data.requestId);
    if (data.type === 'error') item.reject(new Error(data.error));
    else item.resolve(data);
  };
  worker.onerror = event => {
    const error = new Error(event.message || 'Worker failed');
    for (const item of pending.values()) item.reject(error);
    pending.clear(); fail(error);
  };
  return payload => new Promise((resolve, reject) => {
    const requestId = ++nextId;
    pending.set(requestId, {resolve, reject});
    worker.postMessage({...payload, requestId});
  });
}
const request = payload => pool.edit(payload);
function resourceRows() {
  return performance.getEntriesByType('resource').filter(e =>
    e.name.includes('/data/playground-spike/') || /maplibre-gl@4\.7\.1\/dist\/maplibre-gl\.(js|css)/.test(e.name)
  ).map(e => ({name: e.name, transferSize: e.transferSize, encodedBodySize: e.encodedBodySize,
    decodedBodySize: e.decodedBodySize}));
}
async function initialize() {
  try {
    performance.setResourceTimingBufferSize(2000);
    if (!window.Worker) throw new Error('Web Workers unavailable. Use a current Chrome, Firefox, Edge or Safari.');
    if (!window.maplibregl) throw new Error('MapLibre failed to load from the pinned CDN. Check the network and retry.');
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2') && !probe.getContext('webgl')) throw new Error('WebGL is unavailable. Enable WebGL or use a browser/device supporting MapLibre.');
    map = new maplibregl.Map({container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
      center: [-122.25, 37.72], zoom: 9});
    map.addControl(new maplibregl.NavigationControl());
    // Include explicit credits in addition to source attribution from the provider.
    map.addControl(new maplibregl.AttributionControl({compact: false,
      customAttribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> | <a href="https://openmaptiles.org/">OpenMapTiles</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}));
    const mapReady = new Promise((resolve, reject) => {
      map.once('load', resolve);
      map.on('error', event => {
        const error = event.error || new Error('Map resource failed');
        fail(error); reject(error);
      });
    });
    const clients = Array.from({length: P}, createClient);
    pool = new RoutingPool(clients);
    const beforeHeap = sampleHeap(), start = performance.now();
    const [workers] = await Promise.all([Promise.all(clients.map(client => client({type: 'load'}))), mapReady]);
    const loaded = workers[0];
    map.addSource('affected-routes', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    map.addLayer({id: 'before-routes', type: 'line', source: 'affected-routes',
      filter: ['==', ['get', 'phase'], 'before'], paint: {'line-color': '#777', 'line-width': 3, 'line-opacity': 0.65}});
    map.addLayer({id: 'after-routes', type: 'line', source: 'affected-routes',
      filter: ['==', ['get', 'phase'], 'after'], paint: {'line-color': '#007aff', 'line-width': 3}});
    loadData = {P, workers, page_ready_ms: performance.now() - start, worker_timings: loaded.timings,
      files: loaded.meta.files, meta: {snapshot: loaded.meta.snapshot, git_commit: loaded.meta.git_commit,
        counts: loaded.meta.counts, simplification_tolerance_m: loaded.meta.simplification_tolerance_m,
        presets: loaded.meta.presets},
      resources: [...resourceRows(), ...loaded.resources], heap_before: beforeHeap, heap_after: sampleHeap(),
      resource_size_note: 'Browser Resource Timing values; zero may mean cache or missing Timing-Allow-Origin. Excludes tiles.',
      cold_load_verified: false,
      cold_load_note: 'Harness cannot verify a cold cache. Disable cache and reload before measuring.'};
    statusLine.textContent = `Ready: ${loaded.meta.counts.vertices} vertices, ${loaded.meta.counts.trips} trips. Run the stress set to measure.`;
    runButton.disabled = false;
  } catch (error) { fail(error); }
}

async function runStressSet() {
  if (running) return;
  running = true;
  document.getElementById('budget').disabled = true;
  runButton.disabled = true; downloadButton.disabled = true; errorLine.textContent = '';
  const sampler = setInterval(sampleHeap, 100);
  try {
    const budgetSelection = document.getElementById('budget').value;
    const meteorBudgets = budgetSelection === 'all' ? [undefined, 100, 40, 15] :
      [budgetSelection === 'unlimited' ? undefined : Number(budgetSelection)];
    const response = await fetch('../../../results/playground/stress_set.json');
    if (!response.ok) throw new Error(`Stress set: HTTP ${response.status}`);
    const stress = await response.json();
    const cases = stress.cases.flatMap(test => {
      if (test.id === 'bay_bridge' || test.id === 'university_ramp') return [
        {caseId: `${test.id}_live`, edit: {...test, preset: undefined}},
        {caseId: `${test.id}_preset`, edit: {...test, preset: test.id}}
      ];
      if (test.weapon === 'meteor') return meteorBudgets.map(budget => ({
        caseId: `${test.id}_b${budget === undefined ? 'unlimited' : budget}`, edit: {...test, budget}
      }));
      return [{caseId: test.id, edit: test}];
    });
    measurements = {format_version: 0, measured_at: new Date().toISOString(),
      environment: {userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemory: navigator.deviceMemory || null, devicePixelRatio: window.devicePixelRatio,
        viewport: {width: innerWidth, height: innerHeight}, url: location.href},
      protocol: 'Five sequential repeats, reset before each edit; performance.now send to setData plus next requestAnimationFrame. No warm-up edits.',
      draw_note: 'Ends after setData and next animation frame as specified; does not wait for GPU completion or source idle.',
      meteor_budgets: meteorBudgets.map(b => b === undefined ? null : b), seed: stress.seed, load: loadData,
      licenses: {
        source: 'https://github.com/hyperknot/openfreemap/blob/main/LICENSE.md',
        tiles: {provider: 'OpenFreeMap', data: 'OpenStreetMap ODbL', schema_code: 'OpenMapTiles BSD-3-Clause',
          schema_design: 'CC BY 4.0', data_license: 'https://www.openstreetmap.org/copyright'},
        style: {url: 'https://tiles.openfreemap.org/styles/positron', code: 'BSD-3-Clause', design: 'CC BY 4.0',
          derived_from: 'CartoDB Basemaps by Stamen and Paul Norman, CC BY 3.0'},
        icons: {ui: 'No application icon set', basemap: 'Maki CC0 1.0'},
        attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
        raster_fallback: {enabled: false, policy: 'https://operations.osmfoundation.org/policies/tiles/',
          requirements: 'Visible attribution, honour cache headers, valid Referer, no bulk download or offline prefetch; heavy usage may be blocked.'}
      },
      cases: [], heap_after: null, sampled_peak_usedJSHeapSize: null};
    for (const {caseId, edit: test} of cases) {
      const runs = [];
      for (let repeat = 0; repeat < 5; repeat++) {
        statusLine.textContent = `Running ${caseId}, repeat ${repeat + 1}/5 (${measurements.cases.length + 1}/${cases.length})…`;
        await request({type: 'edit', weapon: 'reset'});
        const start = performance.now();
        const result = await request({type: 'edit', ...test});
        map.getSource('affected-routes').setData(result.geojson);
        await new Promise(resolve => requestAnimationFrame(resolve));
        const latency_ms = performance.now() - start;
        sampleHeap();
        const {geojson, requestId, type, ...details} = result;
        runs.push({latency_ms, worker_only_ms: result.timings.total_ms, ...details});
      }
      const times = runs.map(r => r.latency_ms), sorted = [...times].sort((x, y) => x - y);
      const first = runs[0];
      measurements.cases.push({id: caseId, preset: test.preset || null, budget: test.budget ?? null, weapon: test.weapon, ways_hit: first.ways_hit,
        affected_trips: first.affected_trips, affected_origins: first.affected_origins,
        candidate_trips: first.candidate_trips, rerouted_origins: first.rerouted_origins,
        broken: first.broken, slowed: first.slowed, added_seconds: first.added_seconds,
        settled_vertices: first.settled_vertices, settled_total: first.settled_total,
        search_compute_ms: runs.map(r => r.timings.search_compute_ms),
        searches: first.searches, bound_searches: first.bound_searches, reroute_searches: first.reroute_searches,
        attribution_searches: first.attribution_searches, single_searches: first.single_searches, run_searches: first.run_searches,
        attribution_complete: runs.every(r => r.attribution_complete),
        worker_only_ms: runs.map(r => r.worker_only_ms),
        median_worker_only_ms: runs.map(r => r.worker_only_ms).sort((a, b) => a - b)[2],
        latency_ms: times, median_latency_ms: sorted[2], runs});
      document.getElementById('result').textContent = JSON.stringify(measurements, null, 2);
    }
    measurements.heap_after = sampleHeap();
    measurements.sampled_peak_usedJSHeapSize = heapSamples.length ? Math.max(...heapSamples) : null;
    measurements.heap_note = 'Main-page performance.memory only, sampled every 100 ms and at phase boundaries; not an instrumented worker/process peak. Null when unavailable.';
    document.getElementById('result').textContent = JSON.stringify(measurements, null, 2);
    console.log(measurements);
    statusLine.textContent = `Complete: ${measurements.cases.length} cases × 5 repeats. Measurements are ready to download.`;
    downloadButton.disabled = false;
  } catch (error) { fail(error); }
  finally { clearInterval(sampler); running = false; runButton.disabled = false; document.getElementById('budget').disabled = false; }
}
runButton.addEventListener('click', runStressSet);
retryButton.addEventListener('click', () => location.reload());
downloadButton.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(measurements, null, 2) + '\n'], {type: 'application/json'});
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'playground-browser-measurements.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
initialize();
