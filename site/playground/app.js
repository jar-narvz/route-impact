import {createLatest} from './core/latest.js';
import {summarize} from './core/summary.js';

// PLAN decision B / results/playground/feasibility.json: largest passing stress radius.
const METEOR_RADIUS_M = 500;

const $ = id => document.getElementById(id);
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const desktop = matchMedia('(min-width: 900px)');
const heights = ['peek', 'half', 'full'];
const styles = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const state = {
  phase: 'loading',
  theme: systemTheme.matches ? 'dark' : 'light',
  themeOverride: false,
  sheetHeight: 'peek',
  meta: null,
  baseline: null,
  presets: [],
  load_ms: null,
  result: null,
  drawn: null,
  summary: null,
  weapon: null,
  ring: null,
  meteorCenter: null,
  hint: null,
  selection: null,
  error: null,
  mapError: null,
};
const latest = createLatest();
let map;
let worker;
let styleReady = false;
let firstMapLoad = false;
let fitted = false;
let pendingRequest;
let ringFrame;
let resolveReady;
const ready = new Promise(resolve => { resolveReady = resolve; });
const drawWaiters = new Map();
const afterDraw = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function finishRequest(id, error) {
  const waiter = drawWaiters.get(id);
  if (!waiter) return;
  drawWaiters.delete(id);
  if (error) waiter.reject(new Error(error));
  else {
    const style = styleReady ? Promise.resolve() : new Promise((resolve, reject) => {
      if (!map) reject(new Error('Map unavailable'));
      else map.once('style.load', resolve);
    });
    style.then(afterDraw)
      .then(() => waiter.resolve({ms: performance.now() - waiter.start, phase: state.phase}), waiter.reject);
  }
}

function measured(action) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const id = action();
    drawWaiters.set(id, {start, resolve, reject});
  });
}

function renderSheet() {
  document.documentElement.dataset.sheetHeight = state.sheetHeight;
  document.querySelectorAll('[data-height]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.height === state.sheetHeight));
  });
  const next = heights[(heights.indexOf(state.sheetHeight) + 1) % heights.length];
  $('grabber').setAttribute('aria-label', `Change sheet to ${next} height`);
  for (const [id, visible] of [
    ['half-content', state.sheetHeight !== 'peek'],
    ['full-content', state.sheetHeight === 'full'],
  ]) {
    $(id).inert = !visible;
    $(id).hidden = !visible;
  }
  $('snapshot').textContent = state.meta
    ? `Snapshot ${state.meta.snapshot} · routed in your browser · sampled trips only` : '';
}

function renderButtons() {
  document.querySelectorAll('[data-weapon]').forEach(button => {
    button.disabled = !['ready', 'pending', 'showing'].includes(state.phase);
    button.setAttribute('aria-pressed', String(button.dataset.weapon === state.weapon));
  });
  $('rebuild').disabled = !['pending', 'showing'].includes(state.phase);
  $('recenter').disabled = !map || !state.meta;
  const label = `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`;
  $('theme').setAttribute('aria-label', label);
  $('theme').title = label;
}

function renderStatus() {
  const messages = {
    loading: 'Loading the Bay road network…',
    ready: 'Pick a weapon and tap a road',
    pending: 'Routing sampled trips…',
    showing: 'Results ready',
    error: '',
  };
  const status = state.hint ?? (state.phase === 'showing' ? (state.summary?.headline ?? state.summary?.message) : null) ?? messages[state.phase];
  // Keep the visible peek line short; results are announced in the separate live region.
  if ($('status').textContent !== status) $('status').textContent = status;
  $('progress').hidden = state.phase !== 'loading';
  $('sheet').setAttribute('aria-busy', String(['loading', 'pending'].includes(state.phase)));
  $('error').hidden = !state.error;
  $('error').textContent = state.error?.message ?? '';
  $('retry').hidden = !state.error?.retryable;
  $('map-error').hidden = !state.mapError;
  $('map-error').textContent = state.mapError ?? '';
}

function render() {
  renderSheet();
  renderButtons();
  renderStatus();
  renderResults();
}

function fail(message, retryable = false) {
  state.phase = 'error';
  state.error = {message, retryable};
  // Peek is too short for the message and Retry.
  if (state.sheetHeight === 'peek') state.sheetHeight = 'half';
  render();
}

function setHeight(height) {
  state.sheetHeight = height;
  renderSheet();
}

const emptyCollection = () => ({type: 'FeatureCollection', features: []});

function baselineGeoJSON({coords, offsets}) {
  const coordinates = [];
  for (let line = 0; line < offsets.length - 1; line++) {
    const points = [];
    for (let p = offsets[line]; p < offsets[line+1]; p++) points.push([coords[2*p], coords[2*p+1]]);
    coordinates.push(points);
  }
  return {type: 'Feature', properties: {}, geometry: {type: 'MultiLineString', coordinates}};
}

function linesToFeatures({coords, offsets, ids}, idProperty) {
  const features = [];
  for (let line = 0; line < ids.length; line++) {
    const coordinates = [];
    for (let p = offsets[line]; p < offsets[line+1]; p++) coordinates.push([coords[2*p], coords[2*p+1]]);
    features.push({type: 'Feature', properties: {[idProperty]: ids[line]},
      geometry: {type: 'LineString', coordinates}});
  }
  return {type: 'FeatureCollection', features};
}

function boxGeoJSON() {
  if (!state.meta) return emptyCollection();
  const {min_lat, max_lat, min_lon, max_lon} = state.meta.box;
  return {type: 'Feature', properties: {}, geometry: {
    type: 'LineString', coordinates: [
      [min_lon, min_lat], [max_lon, min_lat], [max_lon, max_lat],
      [min_lon, max_lat], [min_lon, min_lat],
    ],
  }};
}

function addOverlays(map) {
  const tokens = getComputedStyle(document.documentElement);
  const color = name => tokens.getPropertyValue(name).trim();
  // Sit above every basemap road and area but below the labels. Some styles (dark) put a
  // symbol layer before their roads, so take the first symbol after the last line/fill layer.
  const layers = map.getStyle().layers ?? [];
  const lastShape = layers.findLastIndex(layer => layer.type === 'line' || layer.type === 'fill');
  const beforeId = layers.slice(lastShape + 1).find(layer => layer.type === 'symbol')?.id;
  const overlays = [
    {id: 'bay-box', data: boxGeoJSON(), color: '--muted', width: 1.5, opacity: 0.65, dash: [4, 3]},
    {id: 'baseline', data: state.baseline, color: '--before', width: 1, opacity: 0.18},
    {id: 'before', data: state.drawn?.before, color: '--before', width: 3, opacity: 0.8},
    {id: 'after', data: state.drawn?.after, color: '--accent', width: 3, opacity: 0.95},
    // Destroyed roads draw above the routes that used them, or 'before' would hide them.
    {id: 'hit', data: state.drawn?.hit, color: '--broken', width: 4, opacity: 0.8},
    {id: 'meteor-ring', data: state.ring, color: '--accent', width: 2, opacity: 0.9},
    {id: 'selected', data: {type: 'FeatureCollection', features: (state.drawn?.hit?.features || [])
      .filter(feature => state.selection?.includes(feature.properties.way_id))}, color: '--accent', width: 6, opacity: 1},
  ];
  for (const overlay of overlays) {
    const data = overlay.data ?? emptyCollection();
    if (map.getSource(overlay.id)) map.getSource(overlay.id).setData(data);
    else map.addSource(overlay.id, {type: 'geojson', data});
    const paint = {
      'line-color': color(overlay.color),
      'line-width': overlay.width,
      'line-opacity': overlay.opacity,
    };
    if (overlay.dash) paint['line-dasharray'] = overlay.dash;
    if (!map.getLayer(overlay.id)) {
      map.addLayer({id: overlay.id, type: 'line', source: overlay.id,
        layout: {'line-join': 'round', 'line-cap': 'round'}, paint}, beforeId);
    } else {
      for (const [key, value] of Object.entries(paint)) map.setPaintProperty(overlay.id, key, value);
    }
  }
  const center = state.meteorCenter ?? emptyCollection();
  if (map.getSource('meteor-center')) map.getSource('meteor-center').setData(center);
  else map.addSource('meteor-center', {type: 'geojson', data: center});
  if (!map.getLayer('meteor-center')) map.addLayer({id: 'meteor-center', type: 'circle', source: 'meteor-center',
    paint: {'circle-radius': 6, 'circle-color': 'transparent', 'circle-stroke-color': color('--accent'),
      'circle-stroke-width': 2}}, beforeId);
  else map.setPaintProperty('meteor-center', 'circle-stroke-color', color('--accent'));
  map.moveLayer('selected', beforeId);
}

function recenter() {
  if (!map || !state.meta) return;
  const {min_lat, max_lat, min_lon, max_lon} = state.meta.box;
  const sheetHeight = $('sheet').getBoundingClientRect().height;
  map.fitBounds([[min_lon, min_lat], [max_lon, max_lat]], {
    padding: desktop.matches
      ? {top: 48, bottom: 48, left: 428, right: 80}
      : {top: 16, bottom: sheetHeight + 8, left: 24, right: 64},
    duration: reducedMotion() ? 0 : 600,
  });
}

function syncMap() {
  if (!map || !styleReady) return;
  addOverlays(map);
  if (state.meta && !fitted) {
    recenter();
    fitted = true;
  }
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  renderButtons();
  if (!map) return;
  styleReady = false;
  map.once('style.load', () => {
    styleReady = true;
    state.mapError = null;
    renderStatus();
    syncMap();
  });
  // A diffed swap drops our layers without firing 'style.load', so reload the style whole.
  map.setStyle(styles[theme], {diff: false});
}

function hasWebGL() {
  if (new URLSearchParams(location.search).has('nowebgl')) return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function createMap() {
  if (!hasWebGL()) {
    document.documentElement.dataset.noMap = 'true';
    fail('WebGL is unavailable. Enable WebGL in a current browser to view the playground.');
    return false;
  }
  if (typeof maplibregl === 'undefined') {
    document.documentElement.dataset.noMap = 'true';
    state.mapError = "The basemap couldn't load because MapLibre is unavailable; routing still works.";
    return true;
  }
  try {
    map = new maplibregl.Map({
      container: 'map', style: styles[state.theme],
      center: [-122.15, 37.65], zoom: 8.5,
      dragRotate: false, attributionControl: false,
    });
    map.keyboard.disable();
    map.getCanvas().tabIndex = -1;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({compact: false}), 'bottom-right');
    map.once('style.load', () => {
      styleReady = true;
      state.mapError = null;
      renderStatus();
      syncMap();
    });
    map.on('click', onMapClick);
    map.once('load', () => {
      firstMapLoad = true;
      // Attribution remains pointer-accessible without inserting links into the map's Tab stop.
      $('map').querySelectorAll('a, button').forEach(node => { node.tabIndex = -1; });
    });
    map.on('error', event => {
      if (firstMapLoad) return;
      state.mapError = `The basemap couldn't load: ${event.error?.message ?? 'style load failed'}. Routing still works.`;
      renderStatus();
    });
    return true;
  } catch (error) {
    map?.remove();
    map = undefined;
    document.documentElement.dataset.noMap = 'true';
    fail(`The map could not start: ${error.message}`);
    return false;
  }
}

function sendRequest(type, payload = {}) {
  const id = latest.next();
  pendingRequest = {id, type, ...payload};
  worker.postMessage({...payload, id, type});
  return id;
}

function loadNetwork() {
  worker?.terminate();
  // Invalidate even replies already queued by the terminated worker.
  latest.next();
  state.phase = 'loading';
  state.error = null;
  state.hint = null;
  clearDrawing();
  $('announcement').textContent = '';
  setHeight('peek');
  render();
  if (typeof Worker === 'undefined') {
    fail('Web Workers are unavailable. Use a current Safari, Firefox, Chrome or Edge browser.');
    return;
  }
  try {
    worker = new Worker('./worker.js', {type: 'module'});
    const activeWorker = worker;
    worker.onmessage = ({data}) => {
      if (worker !== activeWorker || !latest.isLatest(data.id)) return;
      if (!data.ok) {
        finishRequest(data.id, data.error);
        fail(`The Bay road network could not load: ${String(data.error).replace(/^Error: /, '')}`, true);
        return;
      }
      const request = pendingRequest;
      if (request.type === 'load') {
        const {meta, presets, load_ms, baseline} = data.result;
        Object.assign(state, {meta, presets, load_ms, baseline: baselineGeoJSON(baseline), phase: 'ready', error: null});
        resolveReady();
      } else if (request.type === 'pick') {
        const picked = data.result;
        if (!picked || request.weapon === 'flip' && !picked.oneway) {
          state.phase = state.result ? 'showing' : 'ready';
          state.hint = picked ? 'This road is two-way' : 'No road here — zoom in';
        } else {
          runEdit({weapon: request.weapon, way_id: picked.way_id}, request.tap);
          return;
        }
      } else if (request.type === 'edit') {
        const {display, ...result} = data.result;
        state.result = result;
        state.drawn = {before: linesToFeatures(display.before, 'trip'),
          after: linesToFeatures(display.after, 'trip'), hit: linesToFeatures(display.hit, 'way_id')};
        state.summary = summarize(data.result, {meta: state.meta, edit: request.edit});
        $('announcement').textContent = state.summary.announcement;
        state.phase = 'showing';
        state.hint = null;
        setHeight('half');
        if (request.tap) panToTap(request.tap);
      }
      syncMap();
      render();
      finishRequest(data.id);
    };
    worker.onerror = event => {
      if (worker !== activeWorker) return;
      event.preventDefault();
      for (const id of drawWaiters.keys()) finishRequest(id, event.message || 'Worker failed');
      fail(`The road network worker failed: ${event.message || 'worker script could not load'}`, true);
    };
    worker.onmessageerror = () => {
      if (worker === activeWorker) fail('The road network worker returned an unreadable message.', true);
    };
    sendRequest('load');
  } catch (error) {
    fail(`The road network worker could not start: ${error.message}`, true);
  }
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function roadRow(ways, tripText, name) {
  const row = element('div', undefined, 'road-row');
  const button = element('button', name ?? ways.map(way => way.name || 'unnamed road').join(' + '));
  button.type = 'button';
  button.setAttribute('aria-pressed', String(ways.every(way => state.selection?.includes(way.way_id))));
  button.addEventListener('click', () => {
    state.selection = ways.map(way => way.way_id);
    syncMap();
    document.querySelectorAll('.road-row button').forEach(control => {
      const ids = JSON.parse(control.dataset.ways);
      control.setAttribute('aria-pressed', String(ids.every(id => state.selection.includes(id))));
    });
  });
  button.dataset.ways = JSON.stringify(ways.map(way => way.way_id));
  row.append(button);
  if (tripText !== undefined) row.append(element('span', tripText, 'trip-count'));
  for (const way of ways.slice(0, 1)) {
    const link = element('a', 'OSM ↗');
    link.href = `https://www.openstreetmap.org/way/${way.way_id}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', `View ${way.name || 'unnamed road'} on OpenStreetMap`);
    row.append(link);
  }
  if (ways.length > 1) row.append(element('span', `and ${ways.length - 1} more`, 'trip-count'));
  return row;
}

function renderResults() {
  const root = $('results'), trips = $('trips');
  root.replaceChildren();
  trips.replaceChildren();
  const summary = state.summary;
  if (summary) {
    if (summary.headline) root.append(element('h2', summary.headline));
    if (summary.precomputed) root.append(element('span', 'precomputed', 'tag'));
    if (summary.message) root.append(element('p', summary.message));
    if (summary.note) root.append(element('p', summary.note, 'caveat'));
    if (summary.numbers) {
      const numbers = element('div', undefined, 'numbers');
      for (const [key, label] of [['broken', 'broken'], ['slowed', 'slowed ≥ 2 min'], ['added_minutes', 'added min']]) {
        const number = element('div', undefined, key);
        number.append(element('strong', summary.numbers[key].toLocaleString('en-US')), element('span', label));
        numbers.append(number);
      }
      root.append(numbers, element('p', summary.numbers.sample, 'sample'));
    }
    if (summary.mattered) {
      root.append(element('h3', 'Roads that mattered'));
      const mattered = summary.mattered;
      if (mattered.kind === 'one-road') root.append(element('p', mattered.text), roadRow([mattered.way]));
      else {
        if (mattered.singles.length) root.append(element('h4', 'Single roads'));
        for (const single of mattered.singles) root.append(roadRow([single], single.trip_text));
        if (mattered.runs.length) root.append(element('h4', 'Road groups'));
        for (const run of mattered.runs) root.append(roadRow(run.ways, run.trip_text, run.name));
        if (mattered.several_together)
          root.append(element('p', `Several roads together: ${mattered.several_together.toLocaleString('en-US')}`));
      }
    }
    for (const trip of summary.trips) {
      const row = element('li');
      row.append(element('strong', trip.title), element('span', trip.status, trip.status),
        element('span', trip.after_min === null ? `${trip.before_min} min → no route` : `${trip.before_min} → ${trip.after_min} min`));
      trips.append(row);
    }
  }
  const presets = $('presets');
  // Re-rendering replaces the buttons, so keep keyboard focus on the preset just pressed.
  const focusedPreset = presets.contains(document.activeElement) ? document.activeElement.dataset.preset : null;
  presets.replaceChildren();
  const fallback = {bay_bridge: 'Bay Bridge', university_ramp: 'University Ave ramp'};
  for (const preset of state.presets) {
    const label = state.meta.presets?.[preset.name]?.label ?? fallback[preset.name] ?? preset.label;
    const button = element('button', label);
    button.type = 'button';
    button.disabled = !['ready', 'pending', 'showing'].includes(state.phase);
    button.dataset.preset = preset.name;
    button.addEventListener('click', () => runEdit({preset: preset.name, label}));
    presets.append(button);
    if (preset.name === focusedPreset) button.focus();
  }
}

function clearDrawing() {
  cancelAnimationFrame(ringFrame);
  Object.assign(state, {result: null, drawn: null, summary: null, selection: null, ring: null, meteorCenter: null});
  syncMap();
}

function panToTap(tap) {
  if (!map) return;
  const rect = $('sheet').getBoundingClientRect();
  // Results target half height; the current CSS transition may start at peek or full.
  const bottom = window.innerHeight / 2;
  map.easeTo({center: [tap.lon, tap.lat], padding: desktop.matches
    ? {left: rect.width + 32, right: 16, top: 16, bottom: 16}
    : {left: 16, right: 16, top: 16, bottom: bottom + 8},
  duration: reducedMotion() ? 0 : 600});
}

function drawRing(tap) {
  state.meteorCenter = {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [tap.lon, tap.lat]}};
  syncMap();
  const start = performance.now(), k = state.meta.earth_radius_m * Math.PI / 180;
  const kx = k * Math.cos(tap.lat * Math.PI / 180);
  function frame(now) {
    const fraction = reducedMotion() ? 1 : Math.min(1, (now - start) / 600);
    const radius = METEOR_RADIUS_M * fraction;
    const coordinates = Array.from({length: 64}, (_, i) => {
      const angle = i * 2 * Math.PI / 64;
      return [tap.lon + Math.cos(angle) * radius / kx, tap.lat + Math.sin(angle) * radius / k];
    });
    coordinates.push(coordinates[0]);
    state.ring = {type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [coordinates]}};
    if (map && styleReady) {
      if (map.getSource('meteor-ring')) map.getSource('meteor-ring').setData(state.ring);
      else syncMap();
    }
    if (fraction < 1) ringFrame = requestAnimationFrame(frame);
  }
  frame(start);
}

function runEdit(edit, tap) {
  clearDrawing();
  state.phase = 'pending';
  state.hint = null;
  if (edit.weapon === 'meteor') drawRing(tap);
  const id = sendRequest('edit', {edit, tap});
  render();
  return id;
}

function onMapClick(event) {
  fireAt({lat: event.lngLat.lat, lon: event.lngLat.lng});
}

function fireAt(tap) {
  if (!['ready', 'showing', 'pending'].includes(state.phase)) return;
  if (!state.weapon) {
    state.hint = 'Pick a weapon first';
    renderStatus();
    return;
  }
  if (state.weapon === 'meteor') runEdit({weapon: 'meteor', ...tap, radius_m: METEOR_RADIUS_M}, tap);
  else {
    const metresPerPixel = 40075016.686 * Math.cos(tap.lat * Math.PI / 180) / (512 * 2 ** map.getZoom());
    sendRequest('pick', {...tap, max_m: 20 * metresPerPixel, weapon: state.weapon, tap});
    state.phase = 'pending';
    state.hint = null;
    render();
  }
}

document.querySelectorAll('[data-weapon]').forEach(button => {
  button.addEventListener('click', () => {
    state.weapon = button.dataset.weapon;
    renderButtons();
  });
});
function rebuild() {
  // Rebuild disables itself, which would drop keyboard focus to the page; hand it to the weapons.
  const hadFocus = document.activeElement === $('rebuild');
  const id = sendRequest('reset');
  $('announcement').textContent = '';
  clearDrawing();
  state.phase = 'ready';
  state.hint = null;
  setHeight('peek');
  render();
  if (hadFocus) (document.querySelector('[data-weapon][aria-pressed="true"]') ?? document.querySelector('[data-weapon]')).focus();
  return id;
}
$('rebuild').addEventListener('click', rebuild);

$('grabber').addEventListener('click', () => {
  setHeight(heights[(heights.indexOf(state.sheetHeight) + 1) % heights.length]);
});
document.querySelectorAll('[data-height]').forEach(button => {
  button.addEventListener('click', () => setHeight(button.dataset.height));
});
$('recenter').addEventListener('click', recenter);
$('retry').addEventListener('click', loadNetwork);
$('theme').addEventListener('click', () => {
  state.themeOverride = true;
  setTheme(state.theme === 'light' ? 'dark' : 'light');
});
systemTheme.addEventListener('change', event => {
  if (!state.themeOverride) setTheme(event.matches ? 'dark' : 'light');
});

document.documentElement.dataset.theme = state.theme;
render();
if (createMap()) loadNetwork();

$('map').addEventListener('keydown', event => {
  if (event.target !== $('map')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    document.querySelector(`[data-weapon="${state.weapon || 'stomp'}"]`).focus();
    return;
  }
  if (!map) return;
  const pans = {ArrowLeft: [-100, 0], ArrowRight: [100, 0], ArrowUp: [0, -100], ArrowDown: [0, 100]};
  const duration = reducedMotion() ? 0 : 200;
  if (pans[event.key]) map.panBy(pans[event.key], {duration});
  else if (event.key === '+' || event.key === '=') map.zoomIn({duration});
  else if (event.key === '-') map.zoomOut({duration});
  else if (event.key === 'Enter') {
    const center = map.getCenter();
    fireAt({lat: center.lat, lon: center.lng});
  } else return;
  event.preventDefault();
});

if (new URLSearchParams(location.search).has('test')) {
  window.__playground = {
    ready,
    fireMeteor: (lat, lon) => measured(() => runEdit({weapon: 'meteor', lat, lon, radius_m: METEOR_RADIUS_M}, {lat, lon})),
    rebuild: () => measured(rebuild),
    counts() {
      if (!map || !styleReady) throw new Error('Map style is not ready');
      const style = map.getStyle();
      const own = [boxGeoJSON(), state.baseline, state.drawn?.before, state.drawn?.after,
        state.drawn?.hit, state.ring, state.meteorCenter,
        {type: 'FeatureCollection', features: (state.drawn?.hit?.features || [])
          .filter(feature => state.selection?.includes(feature.properties.way_id))}];
      return {sources: Object.keys(style.sources).length, layers: style.layers.length,
        features: own.reduce((sum, data) => sum + (data?.type === 'Feature' ? 1 : data?.features?.length || 0), 0)};
    },
  };
}
