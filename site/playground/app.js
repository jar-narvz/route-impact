import {createLatest} from './core/latest.js';
import {summarize} from './core/summary.js';

// All page Meteor radii live here: removing a size also removes its control and hook support.
const METEOR_SIZES = [
  {name: 'Small', radius_m: 500},
  {name: 'Large', radius_m: 1500},
].map(size => ({...size, duration_ms: Math.round(600 * Math.sqrt(size.radius_m / 500))}));
const timing = new URLSearchParams(location.search).has('timing');
// Frozen P2 stress centers; runEdit canonicalizes these before any drawing or request.
const PHONE_CASES = [
  {id: 'bay_bridge_toll_plaza', lat: 37.825, lon: -122.315},
  {id: 'sf_financial', lat: 37.7946, lon: -122.3999},
  {id: 'sf_union_square', lat: 37.787936, lon: -122.40752},
];

const $ = id => document.getElementById(id);
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let motionOverride;
const reducedMotion = () => motionOverride ?? motionPreference.matches;
const desktop = matchMedia('(min-width: 900px)');
const heights = ['peek', 'half', 'full'];
const styles = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const state = {
  phase: 'loading',
  meteorRadius: METEOR_SIZES[0].radius_m,
  fireMs: null,
  gateRunning: false,
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
let editToken = 0;
let animation;
let pendingReveal;
let effectCanvas;
let animationFramesScheduled = 0;
let resolveReady;
const ready = new Promise(resolve => { resolveReady = resolve; });
const drawWaiters = new Map();
const afterDraw = () => !map?.once ? Promise.resolve() : new Promise(resolve => {
  map.once('render', resolve);
  map.triggerRepaint();
});

function finishRequest(id, error) {
  const waiter = drawWaiters.get(id);
  if (!waiter) return;
  const token = editToken;
  if (error) drawWaiters.delete(id);
  if (error) waiter.reject(new Error(error));
  else {
    const style = styleReady ? Promise.resolve() : new Promise((resolve, reject) => {
      if (!map) reject(new Error('Map unavailable'));
      else map.once('style.load', resolve);
    });
    style.then(afterDraw)
      .then(() => {
        drawWaiters.delete(id);
        if (token !== editToken) waiter.reject(new Error('Edit cancelled'));
        else waiter.resolve({ms: performance.now() - waiter.start, fire_ms: state.fireMs, phase: state.phase});
      }, error => { drawWaiters.delete(id); waiter.reject(error); });
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
    button.disabled = state.gateRunning || !['ready', 'pending', 'showing'].includes(state.phase);
    button.setAttribute('aria-pressed', String(button.dataset.weapon === state.weapon));
  });
  $('rebuild').disabled = state.gateRunning || !['pending', 'showing'].includes(state.phase);
  $('meteor-sizes').hidden = state.weapon !== 'meteor';
  document.querySelectorAll('[name="meteor-size"]').forEach(input => {
    input.disabled = state.gateRunning || !['ready', 'pending', 'showing'].includes(state.phase);
  });
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
  $('fire-timing').hidden = !timing || state.fireMs === null;
  $('fire-timing').textContent = state.fireMs === null ? '' : `fire → result: ${Math.round(state.fireMs)} ms`;
}

function render() {
  renderSheet();
  renderButtons();
  renderStatus();
  renderResults();
}

function fail(message, retryable = false) {
  cancelEdit();
  latest.next();
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
  cancelEdit();
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
          cancelAnimation();
          state.phase = state.result ? 'showing' : 'ready';
          state.hint = picked ? 'This road is two-way' : 'No road here — zoom in';
        } else {
          runEdit({weapon: request.weapon, way_id: picked.way_id}, request.tap, request.started, request.token, picked.line);
          return;
        }
      } else if (request.type === 'edit') {
        if (request.token !== editToken) return;
        pendingReveal = {request, data};
        revealResult();
        return;
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
    button.disabled = state.gateRunning || !['ready', 'pending', 'showing'].includes(state.phase);
    button.dataset.preset = preset.name;
    button.addEventListener('click', () => runEdit({preset: preset.name, label}));
    presets.append(button);
    if (preset.name === focusedPreset) button.focus();
  }
}

function clearDrawing() {
  Object.assign(state, {result: null, drawn: null, summary: null, selection: null, ring: null, meteorCenter: null, fireMs: null});
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

function drawRing(tap, radius) {
  const k = state.meta.earth_radius_m * Math.PI / 180, kx = k * Math.cos(tap.lat * Math.PI / 180);
  const coordinates = Array.from({length: 64}, (_, i) => {
    const angle = i * 2 * Math.PI / 64;
    return [tap.lon + Math.cos(angle)*radius/kx, tap.lat + Math.sin(angle)*radius/k];
  });
  coordinates.push(coordinates[0]);
  state.meteorCenter = {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [tap.lon, tap.lat]}};
  state.ring = {type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [coordinates]}};
  if (map && styleReady) {
    map.getSource('meteor-ring')?.setData(state.ring);
    map.getSource('meteor-center')?.setData(state.meteorCenter);
  }
}

function cancelAnimation() {
  if (animation) {
    cancelAnimationFrame(animation.frame);
    clearTimeout(animation.timer);
    animation = undefined;
  }
  effectCanvas?.remove();
  effectCanvas = undefined;
}

function cancelEdit() {
  editToken++;
  pendingReveal = undefined;
  cancelAnimation();
  for (const id of drawWaiters.keys()) finishRequest(id, 'Edit cancelled');
  return editToken;
}

function finishAnimation() {
  const current = animation;
  if (!current || current.token !== editToken) return;
  cancelAnimation();
  if (current.edit.weapon === 'meteor') drawRing(current.tap, current.edit.radius_m);
  revealResult();
}

function revealResult() {
  if (!pendingReveal || animation) return;
  const {request, data} = pendingReveal;
  pendingReveal = undefined;
  if (request.token !== editToken) return;
  const {display, ...result} = data.result;
  state.result = result;
  state.drawn = {before: linesToFeatures(display.before, 'trip'),
    after: linesToFeatures(display.after, 'trip'), hit: linesToFeatures(display.hit, 'way_id')};
  state.summary = summarize(data.result, {meta: state.meta, edit: request.edit});
  state.phase = 'showing';
  state.hint = null;
  setHeight('half');
  if (request.tap) panToTap(request.tap);
  syncMap();
  render();
  if (timing) {
    state.fireMs = performance.now() - request.started;
    renderStatus();
  }
  // Future hash writes must use this same guard.
  if (request.token !== editToken) return;
  $('announcement').textContent = state.summary.announcement;
  finishRequest(data.id);
}

function paintEffect(effect, fraction) {
  if (!map?.project) return;
  if (!effectCanvas) {
    effectCanvas = element('canvas', undefined, 'impact-effect');
    effectCanvas.setAttribute('aria-hidden', 'true');
    $('map').append(effectCanvas);
  }
  const rect = $('map').getBoundingClientRect();
  effectCanvas.width = rect.width;
  effectCanvas.height = rect.height;
  const ctx = effectCanvas.getContext('2d');
  if (!ctx) return;
  ctx.strokeStyle = '#e9a23b'; ctx.fillStyle = '#e9a23b'; ctx.lineWidth = 3;
  const point = effect.tap && map.project([effect.tap.lon, effect.tap.lat]);
  const pulse = Math.min(1, (performance.now() - effect.tapStarted) / 220);
  if (point && pulse < 1) {
    ctx.beginPath(); ctx.arc(point.x, point.y, 5 + 17*pulse, 0, Math.PI*2); ctx.stroke();
  }
  if (effect.edit.weapon === 'meteor') {
    const fall = Math.min(1, fraction / 0.65);
    ctx.beginPath(); ctx.arc(point.x, point.y - 110*(1-fall), 7, 0, Math.PI*2); ctx.fill();
  } else if (effect.line?.length > 1) {
    const points = effect.line.map(p => map.project(p));
    if (effect.edit.weapon === 'stomp') {
      // Steady highlight: no flashing or opacity cycling.
      ctx.beginPath();
      points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
    } else if (effect.edit.weapon === 'flip') {
      // Export polylines retain OSM order. Reverse them for the flipped direction.
      // The boolean one-way export cannot distinguish original oneway=-1 roads.
      for (let i = 1; i < points.length; i++) {
        const a = points[i], b = points[i-1], length = Math.hypot(b.x-a.x, b.y-a.y);
        for (let d = fraction*28; d < length; d += 28) {
          const x = a.x + (b.x-a.x)*d/length, y = a.y + (b.y-a.y)*d/length;
          const angle = Math.atan2(b.y-a.y, b.x-a.x);
          ctx.beginPath();
          ctx.moveTo(x-7*Math.cos(angle-0.6), y-7*Math.sin(angle-0.6));
          ctx.lineTo(x, y);
          ctx.lineTo(x-7*Math.cos(angle+0.6), y-7*Math.sin(angle+0.6));
          ctx.stroke();
        }
      }
    }
  }
}

function startAnimation(edit, tap, token, tapStarted = performance.now(), line = null) {
  cancelAnimation();
  const duration = edit.weapon === 'meteor'
    ? METEOR_SIZES.find(size => size.radius_m === edit.radius_m).duration_ms : 500;
  if (!edit.weapon || timing || reducedMotion()) {
    if (edit.weapon === 'meteor') drawRing(tap, edit.radius_m);
    return;
  }
  const effect = {edit, tap, token, tapStarted, start: performance.now(),
    line};
  animation = effect;
  const frame = now => {
    if (token !== editToken || animation !== effect) return;
    if (reducedMotion()) { finishAnimation(); return; }
    const fraction = Math.min(1, (now - effect.start) / duration);
    if (edit.weapon === 'meteor') drawRing(tap, edit.radius_m*fraction);
    paintEffect(effect, fraction);
    if (fraction >= 1) { finishAnimation(); return; }
    animationFramesScheduled++;
    effect.frame = requestAnimationFrame(frame);
  };
  effect.timer = setTimeout(() => { if (animation === effect) finishAnimation(); }, duration);
  frame(effect.start);
}

function runEdit(edit, tap, started = performance.now(), token, line) {
  if (edit.weapon === 'meteor') {
    if (!METEOR_SIZES.some(size => size.radius_m === edit.radius_m)) throw new Error('Unsupported Meteor radius');
    edit = {...edit, lat: Number(edit.lat.toFixed(5)), lon: Number(edit.lon.toFixed(5))};
    tap = {lat: edit.lat, lon: edit.lon};
  }
  if (token === undefined) { token = cancelEdit(); clearDrawing(); }
  if (token !== editToken) return;
  state.phase = 'pending';
  state.hint = null;
  startAnimation(edit, tap, token, started, line);
  const id = sendRequest('edit', {edit, tap, started, token});
  render();
  return id;
}

function onMapClick(event) {
  fireAt({lat: event.lngLat.lat, lon: event.lngLat.lng});
}

function fireAt(tap) {
  const started = performance.now();
  if (state.gateRunning) return;
  if (!['ready', 'showing', 'pending'].includes(state.phase)) return;
  if (!state.weapon) {
    state.hint = 'Pick a weapon first';
    renderStatus();
    return;
  }
  if (state.weapon === 'meteor') runEdit({weapon: 'meteor', ...tap, radius_m: state.meteorRadius}, tap, started);
  else {
    const metresPerPixel = 40075016.686 * Math.cos(tap.lat * Math.PI / 180) / (512 * 2 ** map.getZoom());
    const token = cancelEdit();
    clearDrawing();
    startAnimation({weapon: 'pick'}, tap, token, started);
    sendRequest('pick', {...tap, max_m: 20 * metresPerPixel, weapon: state.weapon, tap, started, token});
    state.phase = 'pending';
    state.hint = null;
    render();
  }
}

for (const size of METEOR_SIZES) {
  const label = element('label');
  const input = element('input');
  input.type = 'radio';
  input.name = 'meteor-size';
  input.value = String(size.radius_m);
  input.checked = size.radius_m === state.meteorRadius;
  input.addEventListener('change', () => {
    if (!input.checked) return;
    state.meteorRadius = size.radius_m;
    $('announcement').textContent = `Meteor size: ${size.name} ${size.radius_m.toLocaleString('en-US')} m`;
  });
  label.append(input, document.createTextNode(`${size.name} ${size.radius_m.toLocaleString('en-US')} m`));
  $('meteor-sizes').append(label);
}

document.querySelectorAll('[data-weapon]').forEach(button => {
  button.addEventListener('click', () => {
    state.weapon = button.dataset.weapon;
    renderButtons();
  });
});
function rebuild() {
  cancelEdit();
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

async function waitForReady() {
  const deadline = performance.now() + 120000;
  while (state.phase !== 'ready') {
    if (state.phase === 'error') throw new Error(state.error?.message ?? 'Engine failed');
    if (performance.now() > deadline) throw new Error('Waiting for ready timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function runPhoneGate() {
  state.gateRunning = true;
  $('phone-gate').disabled = true;
  $('phone-gate-json').value = '';
  render();
  try {
    // Wait out a live edit/load before resetting; never interrupt an in-flight request.
    const deadline = performance.now() + 120000;
    while (['loading', 'pending'].includes(state.phase)) {
      if (performance.now() > deadline) throw new Error('Engine busy timed out');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (state.phase === 'showing') await measured(rebuild);
    await waitForReady();
    const radius_m = METEOR_SIZES.find(size => size.name === 'Large')?.radius_m;
    if (radius_m === undefined) throw new Error('Large Meteor is unavailable');
    const runs = [];
    for (const test of PHONE_CASES) {
      for (let repeat = 0; repeat < 3; repeat++) {
        await waitForReady();
        const result = await measured(() => runEdit({weapon: 'meteor', lat: test.lat, lon: test.lon, radius_m}));
        runs.push({case: test.id, ms: result.fire_ms});
        await measured(rebuild);
      }
    }
    const medians = Object.fromEntries(PHONE_CASES.map(test => [test.id,
      runs.filter(run => run.case === test.id).map(run => run.ms).sort((a, b) => a - b)[1]]));
    $('phone-gate-json').value = JSON.stringify({
      export_git_commit: state.meta.git_commit, page_url: location.href, user_agent: navigator.userAgent,
      timestamp_utc: new Date().toISOString(), radius_m, runs, medians, gate_ms: 2000,
      verdict: Object.values(medians).every(ms => ms <= 2000) ? 'pass' : 'fail',
    }, null, 2);
  } catch (error) {
    $('phone-gate-json').value = `Phone gate failed: ${error.message}`;
  } finally {
    state.gateRunning = false;
    $('phone-gate').disabled = false;
    setHeight('half');
    render();
  }
}
if (timing) {
  $('timing-tools').hidden = false;
  $('phone-gate').addEventListener('click', runPhoneGate);
}

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

motionPreference.addEventListener('change', () => {
  if (reducedMotion()) finishAnimation();
});

if (new URLSearchParams(location.search).has('test')) {
  window.__playground = {
    ready,
    setReducedMotion(value) { motionOverride = value; if (reducedMotion()) finishAnimation(); },
    animationsRunning: () => Boolean(animation),
    animationFramesScheduled: () => animationFramesScheduled,
    staticOutline: () => Boolean(state.ring),
    fireAt,
    fireRoad: (weapon, way_id) => measured(() => runEdit({weapon, way_id})),
    fireMeteor: (lat, lon, radius_m = state.meteorRadius) => measured(() => runEdit({weapon: 'meteor', lat, lon, radius_m})),
    result: () => structuredClone(state.result),
    hitWayIds: () => [...new Set(state.drawn?.hit.features.map(feature => feature.properties.way_id) ?? [])].sort((a, b) => a - b),
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
