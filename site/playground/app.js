import {createFx} from './fx.js';
import {monochrome} from './core/mono.js';
import {createLatest} from './core/latest.js';
import {summarize} from './core/summary.js';
import {parseShare, serializeShare} from './core/share.js';

// All page Meteor radii live here: removing a size also removes its control and hook support.
const METEOR_SIZES = [
  {name: 'Small', radius_m: 500},
  {name: 'Large', radius_m: 1500},
// scale = √(r / 500 m) sets the fall's duration, marker size and drop height together (decision 18 amendment),
// so every Meteor falls at the same speed and a bigger one starts higher and lands later.
].map(size => {
  const scale = Math.sqrt(size.radius_m / 500);
  return {...size, scale, duration_ms: Math.round(60 * scale) * 10};
});
const timing = new URLSearchParams(location.search).has('timing');
const perf = new URLSearchParams(location.search).has('perf');
// Frozen P2 stress centers; runEdit canonicalizes these before any drawing or request.
const PHONE_CASES = [
  {id: 'bay_bridge_toll_plaza', lat: 37.825, lon: -122.315},
  {id: 'sf_financial', lat: 37.7946, lon: -122.3999},
  {id: 'sf_union_square', lat: 37.787936, lon: -122.40752},
];

const $ = id => document.getElementById(id);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let motionOverride;
const reducedMotion = () => motionOverride ?? motionPreference.matches;
const desktop = matchMedia('(min-width: 900px)');
const testMode = new URLSearchParams(location.search).has('test');
const isShare = hash => /^#(stomp|flip|meteor|preset)=/.test(hash);
const skipHome = testMode || isShare(location.hash || '');
const styles = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const state = {
  phase: 'loading',
  meteorRadius: METEOR_SIZES[0].radius_m,
  fireMs: null,
  gateRunning: false,
  theme: 'dark',
  home: !skipHome,
  loaded: 0,
  total: 0,
  preparing: false,
  showAll: false,
  sheetHeight: 'summary',
  meta: null,
  baseline: null,
  presets: [],
  load_ms: null,
  result: null,
  drawn: null,
  summary: null,
  weapon: 'stomp',
  ring: null,
  meteorCenter: null,
  hint: null,
  selection: null,
  error: null,
  mapError: null,
  shareHash: null,
  shareNotice: null,
};
const latest = createLatest();
let map;
let worker;
let fx;
let fxContextLost = false;
let trafficData;
let fxTimeScale = 1;
const fxClock = () => fx?.clock?.() ?? performance.now();
let contextExtension;
let styleReady = false;
let firstMapLoad = false;
let fitted = false;
let pendingRequest;
let editToken = 0;
let animation;
let pendingReveal;
let revealFrame;
let revealProgress = 1;
let fadingDrawing;
let fadeProgress = 1;
let animationFramesScheduled = 0;
let pendingShareHash = isShare(location.hash || '') ? location.hash : '';
let shareVersion = 0;
let wayLookupPromise;
let metaVersion = 0;
async function loadHomeMeta() {
  const version = ++metaVersion;
  try {
    const response = await fetch('./data/meta.json');
    if (!response.ok) return;
    const meta = await response.json();
    if (version === metaVersion && !state.meta) { state.meta = meta; renderSheet(); renderButtons(); }
  } catch { /* The worker supplies its verified metadata on load. */ }
}
let mapCreation;
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

function textWithNumbers(node, text) {
  node.replaceChildren();
  for (const part of text.split(/(\d[\d,.]*(?: min| ms| m| km)?)/)) {
    node.append(/^\d/.test(part) ? element('span', part, 'tabular') : document.createTextNode(part));
  }
}

function snapshotDate() {
  const raw = state.meta?.snapshot;
  if (!/^\d{6}$/.test(raw || '')) return '';
  return new Date(`20${raw.slice(0,2)}-${raw.slice(2,4)}-${raw.slice(4,6)}T12:00:00Z`)
    .toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
}

function showHome(visible) {
  state.home = visible;
  document.documentElement.dataset.home = String(visible);
  $('game').inert = visible;
  $('home').inert = !visible;
  if (visible) {
    $('home').hidden = false;
    $('home').classList.remove('leaving');
    $('start').focus();
  } else {
    $('home').classList.add('leaving');
    if (reducedMotion()) $('home').hidden = true;
    else setTimeout(() => { if (!state.home) $('home').hidden = true; }, 200);
    const focus = () => { if (!state.home) document.querySelector(`[data-weapon="${state.weapon}"]`).focus(); };
    if (reducedMotion()) focus(); else setTimeout(focus, 220);
  }
  syncMap();
  positionCrosshair();
}

function renderSheet() {
  const open = desktop.matches || state.sheetHeight === 'details';
  document.documentElement.dataset.sheetHeight = open ? 'details' : 'summary';
  $('details-button').setAttribute('aria-expanded', String(open));
  $('details-label').textContent = open ? 'Hide details' : 'Details';
  $('details-content').inert = !open;
  $('details-content').hidden = !open;
  const showResult = Boolean(state.summary) && !state.hint && !state.error;
  const showCard = showResult || (timing || perf) && state.phase === 'ready';
  $('sheet').hidden = !showCard;
  $('status-area').hidden = showCard;
  $('snapshot').textContent = state.meta
    ? `Sampled trips only. Roads outside the Bay box aren't modelled. Snapshot ${snapshotDate()}.${state.ring ? ' Whole roads close if any part is inside the circle.' : ''}` : '';
  if (state.meta?.counts) {
    const trips = state.meta.counts.trips.toLocaleString('en-US'), roads = state.meta.counts.ways.toLocaleString('en-US');
    $('home-description').textContent = `${trips} real trips across the Bay Area, routed in your browser on OpenStreetMap data from ${snapshotDate()}. Close a road and see which trips detour, which break, and which road caused it.`;
    $('home-stats').replaceChildren(...[`${trips} trips`, `${roads} roads`, 'no server'].map(text => element('span', text)));
  }
}

function renderButtons() {
  document.querySelectorAll('[data-weapon]').forEach(button => {
    button.disabled = false;
    button.setAttribute('aria-disabled', String(state.gateRunning || !['ready', 'pending', 'showing'].includes(state.phase)));
    button.title = state.phase === 'loading' ? loadingLabel() : '';
    button.setAttribute('aria-describedby', 'status');
    button.setAttribute('aria-pressed', String(button.dataset.weapon === state.weapon));
  });
  $('home-preset').disabled = state.gateRunning || !['ready','pending','showing'].includes(state.phase);
  $('rebuild').hidden = !['pending', 'showing'].includes(state.phase);
  $('rebuild').disabled = state.gateRunning || !['pending', 'showing'].includes(state.phase);
  $('meteor-sizes').hidden = state.weapon !== 'meteor';
  document.querySelectorAll('[name="meteor-size"]').forEach(input => {
    input.disabled = state.gateRunning || !['ready', 'pending', 'showing'].includes(state.phase);
  });
  $('recenter').disabled = !map || !state.meta;
  const label = `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`;
  $('theme').setAttribute('aria-label', label);
  $('theme').title = label;
  $('theme-label').textContent = state.theme === 'dark' ? 'Light theme' : 'Dark theme';
}

function loadPercent() { return state.total ? Math.min(state.preparing ? 100 : 99, Math.round(100*state.loaded/state.total)) : 0; }
function loadingLabel() { return state.preparing ? 'Preparing roads…' : `Loading roads ${loadPercent()}%`; }
function renderProgress(data) {
  state.loaded = data.loaded_bytes;
  state.total = data.total_bytes;
  state.preparing = data.preparing ?? (state.total > 0 && state.loaded >= state.total);
  $('start-progress').style.transform = `scaleX(${loadPercent()/100})`;
  $('start-progress').setAttribute('aria-valuenow', String(loadPercent()));
  $('progress').firstElementChild.style.width = `${loadPercent()}%`;
  renderButtons();
  renderStatus();
}
function renderStatus() {
  const messages = {
    loading: loadingLabel(),
    ready: state.weapon === 'meteor' ? `Tap anywhere to drop a ${state.meteorRadius === 500 ? '500 m' : '1.5 km'} meteor` : state.weapon === 'flip' ? 'Tap a one-way road to reverse it' : 'Tap a road to close it',
    pending: `Routing ${(state.meta?.counts?.trips ?? 0).toLocaleString('en-US')} trips…`,
    showing: 'Results ready',
    error: '',
  };
  const status = state.hint ?? (state.phase === 'showing' ? (state.summary?.headline ?? state.summary?.message) : null) ?? messages[state.phase];
  // Keep the visible peek line short; results are announced in the separate live region.
  if ($('status').textContent !== status) textWithNumbers($('status'), status);
  for (const id of ['start-progress', 'progress']) {
    $(id).dataset.preparing = String(state.preparing);
  }
  $('start-progress').setAttribute('aria-label', loadingLabel());
  if (state.preparing) $('start-progress').removeAttribute('aria-valuenow');
  else $('start-progress').setAttribute('aria-valuenow', String(loadPercent()));
  $('progress').hidden = state.phase !== 'loading';
  $('start-progress').hidden = state.phase !== 'loading';
  $('sheet').setAttribute('aria-busy', String(['loading', 'pending'].includes(state.phase)));
  $('error').hidden = !state.error;
  $('error').textContent = state.error?.message ?? '';
  $('retry').hidden = !state.error?.retryable;
  $('home-error').hidden = !state.error;
  $('home-error').textContent = state.error?.message ?? '';
  $('home-retry').hidden = !state.error?.retryable;
  $('map-error').hidden = !state.mapError;
  $('map-error').textContent = state.mapError ?? '';
  $('share-notice').hidden = !state.shareNotice;
  $('share-notice').textContent = state.shareNotice ?? '';
  if (!state.shareHash) $('share-link').hidden = true;
  $('share-link').href = state.shareHash || '#';
  $('copy-link').hidden = !state.shareHash;
  $('share-link').value = location.href;
  $('fire-timing').hidden = !timing || state.fireMs === null;
  $('fire-timing').textContent = state.fireMs === null ? '' : `fire → result: ${Math.round(state.fireMs)} ms`;
}

function render() {
  renderSheet();
  renderButtons();
  renderStatus();
  renderResults();
  positionCrosshair();
}

function fail(message, retryable = false) {
  cancelEdit();
  latest.next();
  state.phase = 'error';
  state.error = {message, retryable};
  state.sheetHeight = 'summary';
  render();
}

function setHeight(height) {
  const closing = height !== 'details' && state.sheetHeight === 'details';
  state.sheetHeight = height;
  if (closing && !desktop.matches) $('details-button').focus();
  renderSheet();
  positionCrosshair();
}

// Geometry is in map-container pixels; the fixed overlay uses viewport pixels.
function positionCrosshair() {
  const bounds = $('map').getBoundingClientRect();
  const panel = $('panel').getBoundingClientRect();
  const dock = $('dock').getBoundingClientRect();
  document.documentElement.style?.setProperty('--dock-height', `${dock.height}px`);
  document.documentElement.style?.setProperty('--panel-bottom', `${panel.bottom}px`);
  const sheet = !$('sheet').hidden ? $('sheet').getBoundingClientRect()
    : !$('status-area').hidden ? $('status-area').getBoundingClientRect() : dock;
  document.documentElement.style?.setProperty('--map-footer-bottom', `${Math.max(0, bounds.bottom - sheet.top + 8)}px`);
  const left = desktop.matches ? Math.min(bounds.width, Math.max(0, panel.right + 16 - bounds.left)) : 0;
  const bottom = desktop.matches ? bounds.height : Math.min(bounds.height, Math.max(0, sheet.top - bounds.top));
  const point = {x: (left + bounds.width) / 2, y: bottom / 2};
  const crosshair = document.querySelector('.crosshair');
  crosshair.style.left = `${bounds.left + point.x}px`;
  crosshair.style.top = `${bounds.top + point.y}px`;
  return point;
}

function crosshairPoint() {
  const point = positionCrosshair();
  const {lng, lat} = map.unproject([point.x, point.y]);
  return {...point, lng, lat};
}

$('sheet').addEventListener('transitionend', event => {
  if (event.target === $('sheet')) positionCrosshair();
});
window.addEventListener('resize', positionCrosshair);
if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(positionCrosshair);
  for (const id of ['sheet', 'dock', 'panel', 'status-area']) observer.observe($(id));
}
desktop.addEventListener('change', () => { renderSheet(); positionCrosshair(); });

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
  for (const layer of layers) if (layer.type === 'symbol' && layer.layout?.['text-field']) map.setPaintProperty(layer.id, 'text-opacity', state.home ? 0 : 1);
  const lastShape = layers.findLastIndex(layer => layer.type === 'line' || layer.type === 'fill');
  const beforeId = layers.slice(lastShape + 1).find(layer => layer.type === 'symbol')?.id;
  const overlays = [
    {id: 'bay-box', data: boxGeoJSON(), color: '--fg-3', width: 1, opacity: state.home ? 0 : 0.65, dash: [4, 3]},
    {id: 'baseline', data: state.baseline, color: '--fg-3', width: 1, opacity: state.theme === 'light' ? 0.35 : 0.18},
    {id: 'before', data: state.drawn?.before, color: '--fg-3', width: 1.5, opacity: 0.8},
    {id: 'after', data: state.drawn?.after, color: '--route', width: 3*revealProgress, opacity: 0.85 * revealProgress},
    // Destroyed roads draw above the routes that used them, or 'before' would hide them.
    {id: 'hit', data: state.drawn?.hit ?? fadingDrawing?.hit, color: state.flipped ? '--route' : '--broken', dash: state.flipped ? [2, 2] : [1, 0], width: 4, opacity: 0.8 * fadeProgress},
    {id: 'meteor-ring', data: state.ring, color: '--route', width: 2, opacity: 0.9},
    {id: 'selected', data: {type: 'FeatureCollection', features: (state.drawn?.hit?.features || [])
      .filter(feature => state.selection?.includes(feature.properties.way_id))}, color: '--route', width: 6, opacity: 1},
  ];
  for (const overlay of overlays) {
    const data = overlay.data ?? emptyCollection();
    if (map.getSource(overlay.id)) map.getSource(overlay.id).setData(data);
    else map.addSource(overlay.id, {type: 'geojson', data});
    const paint = {
      'line-color': color(overlay.color),
      'line-width': overlay.width,
      'line-opacity': overlay.opacity,
      'line-opacity-transition': {duration:0},
      'line-width-transition': {duration:0},
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
    paint: {'circle-radius': 6, 'circle-color': 'transparent', 'circle-stroke-color': color('--route'),
      'circle-stroke-width': 2}}, beforeId);
  else map.setPaintProperty('meteor-center', 'circle-stroke-color', color('--route'));
  map.moveLayer('selected', beforeId);
}

function cameraPadding() {
  const bounds = $('map').getBoundingClientRect();
  if (desktop.matches) return {top: 16, bottom: 16, left: $('panel').getBoundingClientRect().right-bounds.left+16, right: 16};
  const obstruction = $('sheet').hidden ? $('dock') : $('sheet');
  return {top: 16, left: 16, right: 16, bottom: Math.max(16, bounds.bottom-obstruction.getBoundingClientRect().top+8)};
}

function recenter() {
  if (testMode || reducedMotion() || !map || !state.meta) return;
  const {min_lat, max_lat, min_lon, max_lon} = state.meta.box;
  map.fitBounds([[min_lon, min_lat], [max_lon, max_lat]], {
    padding: cameraPadding(), pitch: 0, duration: reducedMotion() ? 0 : 600,
  });
}

function syncMap() {
  if (!map || !styleReady) return;
  addOverlays(map);
  ensureFx();
  if (state.meta && !fitted) {
    recenter();
    fitted = true;
  }
}

function ensureFx() {
  if (!map || !styleReady || !state.meta || fxContextLost) return;
  const creating = !fx;
  fx ??= createFx(map, {theme: state.theme, reducedMotion, earthRadius: state.meta.earth_radius_m, colors: () =>
    ['--route','--fg-3','--broken',state.theme === 'dark' ? '--bg' : '--fg']
      .map(name => token(name).slice(1).match(/../g).map(v => parseInt(v,16)/255))});
  if (creating) fx.timeScale?.(fxTimeScale);
  if (creating && trafficData) fx.setTraffic(trafficData,state.meta.highway_classes);
  fx.setTheme(state.theme);
  if (!map.getLayer('fx')) {
    const layers = map.getStyle().layers;
    const lastShape = layers.findLastIndex(layer => ['line', 'fill', 'fill-extrusion'].includes(layer.type));
    map.addLayer(fx.layer, layers.slice(lastShape+1).find(layer => layer.type === 'symbol')?.id);
  }
}

function buildingIdProbe() {
  if (map?.isStyleLoaded && !map.isStyleLoaded()) return {sourceId: null, sourceLayer: null, sample: []};
  const building = map?.getStyle().layers.find(layer => layer.type === 'fill-extrusion' && layer['source-layer'] === 'building')
    ?? map?.getStyle().layers.find(layer => layer['source-layer'] === 'building');
  if (!building) return {sourceId: null, sourceLayer: null, sample: []};
  return {sourceId: building.source, sourceLayer: building['source-layer'],
    sample: map.querySourceFeatures(building.source, {sourceLayer: building['source-layer']}).slice(0, 20)
      .map(feature => ({id: feature.id ?? null, hasId: feature.id !== undefined && feature.id !== null,
        render_height: feature.properties?.render_height ?? null}))};
}

let styleController;
async function fetchStyle(theme) {
  styleController?.abort();
  const controller = new AbortController();
  styleController = controller;
  try {
    const response = await fetch(styles[theme], {signal: controller.signal});
    if (!response.ok) throw new Error('Style unavailable');
    const style = monochrome(await response.json());
    if (controller.signal.aborted) return null;
    const building = style.layers.find(layer => layer['source-layer'] === 'building');
    if (building) {
      const index = style.layers.findIndex(layer => layer.type === 'symbol' && layer.layout?.['text-field']);
      style.layers.splice(index < 0 ? style.layers.length : index, 0, {id: 'playground-buildings', type: 'fill-extrusion',
      source: building.source, 'source-layer': 'building', minzoom: 14,
      paint: {'fill-extrusion-color': theme === 'dark' ? '#1a1a1a' : '#e6e6e6', 'fill-extrusion-vertical-gradient': true,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0]}});
    }
    return style;
  } catch { return controller.signal.aborted ? null : styles[theme]; }
}
function token(name) { return typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : 'currentColor'; }
async function setTheme(theme) {
  settleTails();
  finishAnimation();
  const style = await fetchStyle(theme);
  if (!map || !style) return;
  if (typeof style === 'string') {
    state.mapError = "The basemap couldn't load. Check your connection and retry. Routing still works.";
    renderStatus();
    syncMap();
    return;
  }
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  renderButtons();
  styleReady = false;
  map.once('style.load', () => {
    styleReady = true;
    state.mapError = null;
    renderStatus();
    syncMap();
  });
  map.setStyle(style, {diff: false});
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

// Mouse pitch is independent of bearing; native touch pitch stays enabled.
function enableMousePitch(map) {
  const canvas = map.getCanvas();
  let drag;
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 2 && !(event.button === 0 && event.ctrlKey)) return;
    event.preventDefault();
    event.stopPropagation();
    drag = {id: event.pointerId, y: event.clientY, pitch: map.getPitch()};
    canvas.setPointerCapture(event.pointerId);
  }, true);
  canvas.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    map.setPitch(Math.max(0, Math.min(60, drag.pitch + (drag.y-event.clientY)*0.5)));
  }, true);
  const end = event => { if (drag?.id === event.pointerId) drag = undefined; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', event => event.preventDefault());
}

function collapseAttribution() {
  const control = $('map').querySelector('.maplibregl-ctrl-attrib');
  if (!control) return;
  control.classList.remove('maplibregl-compact-show');
  control.open = false;
  control.querySelector('button')?.setAttribute('aria-expanded', 'false');
}

async function createMap() {
  if (!hasWebGL()) {
    document.documentElement.dataset.noMap = 'true';
    fail('WebGL is unavailable. Enable WebGL and retry.', true);
    return false;
  }
  if (typeof maplibregl === 'undefined') {
    document.documentElement.dataset.noMap = 'true';
    state.mapError = "The basemap couldn't load because MapLibre is unavailable; routing still works.";
    return true;
  }
  try {
    map = new maplibregl.Map({
      container: 'map', style: await fetchStyle(state.theme),
      center: [-122.15, 37.65], zoom: 8.5,
      dragRotate: false, doubleClickZoom: false, maxPitch: 60, attributionControl: false,
    });
    enableMousePitch(map);
    map.touchPitch?.enable();
    map.keyboard.disable();
    map.getCanvas().tabIndex = -1;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({compact: true}), 'bottom-right');
    map.on('style.load', collapseAttribution);
    map.once('style.load', () => {
      styleReady = true;
      state.mapError = null;
      renderStatus();
      syncMap();
    });
    map.on('webglcontextlost', () => {
      fxContextLost = true;
      fx?.layer.onRemove();
      settleTails();
      finishAnimation();
    });
    map.on('webglcontextrestored', () => {
      fxContextLost = false;
      setTheme(state.theme);
    });
    map.on('click', onMapClick);
    map.once('load', () => {
      firstMapLoad = true;
      collapseAttribution();
      // Attribution remains pointer-accessible without inserting links into the map's Tab stop.
      $('map').querySelectorAll('a, button').forEach(node => { node.tabIndex = -1; });
    });
    map.on('error', event => {
      state.mapError = "The basemap couldn't load. Check your connection and retry. Routing still works.";
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
  state.loaded = state.total = 0;
  state.preparing = false;
  state.error = null;
  state.shareNotice = null;
  state.hint = null;
  clearDrawing();
  $('announcement').textContent = '';
  setHeight('summary');
  render();
  if (typeof Worker === 'undefined') {
    fail('This browser cannot load roads. Update it and retry.', true);
    return;
  }
  try {
    worker = new Worker('./worker.js', {type: 'module'});
    const activeWorker = worker;
    worker.onmessage = ({data}) => {
      if (worker !== activeWorker) return;
      if (data.type === 'progress') { renderProgress(data); return; }
      if (!latest.isLatest(data.id)) return;
      if (!data.ok) {
        finishRequest(data.id, data.error);
        fail("Couldn't load the road data. Check your connection and retry.", true);
        return;
      }
      const request = pendingRequest;
      if (request.type === 'load') {
        const {meta, presets, load_ms, baseline} = data.result;
        Object.assign(state, {meta, presets, load_ms, baseline: baselineGeoJSON(baseline), phase: 'ready', error: null});
        trafficData=['way_ids','oneway','weights','highway'].every(key => baseline[key]?.length === baseline.offsets.length-1) ? baseline : null;
        if (trafficData) fx?.setTraffic?.(trafficData,meta.highway_classes);
        Promise.resolve(mapCreation).then(resolveReady);
      } else if (request.type === 'pick') {
        const picked = data.result;
        if (!picked || request.weapon === 'flip' && !picked.oneway) {
          cancelAnimation();
          state.phase = 'ready';
          state.hint = picked ? 'This road is two-way. Flip needs a one-way road' : 'No road here. Zoom in and tap a road';
        } else {
          runEdit({weapon: request.weapon, way_id: picked.way_id}, request.tap, request.started, request.token, picked.line);
          return;
        }
      } else if (request.type === 'edit') {
        if (request.token !== editToken) return;
        if (animation && !animation.line && ['stomp','flip'].includes(request.edit.weapon)) {
          const line = linesToFeatures(data.result.display.hit,'way_id').features[0]?.geometry.coordinates;
          if (line?.length) {
            animation.line = line;
            const tap = {lon:line[0][0],lat:line[0][1]};
            fx?.fire({weapon:request.edit.weapon,lngLat:line[0],line,seed:request.edit.way_id,duration:500,started:animation.start});
            hitCamera(request.edit,tap);
          }
        }
        pendingReveal = {request, data};
        revealResult();
        return;
      }
      syncMap();
      render();
      finishRequest(data.id);
      if (request.type === 'load' && pendingShareHash) {
        const hash = pendingShareHash;
        pendingShareHash = '';
        replayShare(hash);
      }
    };
    worker.onerror = event => {
      if (worker !== activeWorker) return;
      event.preventDefault();
      for (const id of drawWaiters.keys()) finishRequest(id, event.message || 'Worker failed');
      fail("Couldn't load the road data. Check your connection and retry.", true);
    };
    worker.onmessageerror = () => {
      if (worker === activeWorker) fail("Couldn't load the road data. Check your connection and retry.", true);
    };
    sendRequest('load');
  } catch (error) {
    fail("Couldn't load the road data. Check your connection and retry.", true);
  }
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function roadRow(item) {
  const {ways, name, caption, share} = item;
  const row = element('div', undefined, 'road-row'), button = element('button');
  button.type = 'button';
  button.title = `${name}${item.secondary ? ` · ${item.secondary}` : ''}`;
  button.dataset.ways = ways.map(way => way.way_id).join(',');
  button.setAttribute('aria-label', `${button.title}, ${caption}`);
  button.setAttribute('aria-pressed', String(ways.every(way => state.selection?.includes(way.way_id))));
  const bar = element('span', undefined, 'road-bar');
  bar.style.width = `${share*100}%`;
  const heading = element('span', undefined, 'road-name');
  heading.append(element('span', name), element('span', item.secondary ?? '', 'road-secondary'));
  button.append(heading, element('span', caption, 'trip-count'), bar);
  button.addEventListener('click', () => {
    state.selection = ways.map(way => way.way_id);
    syncMap();
    const coords = state.drawn?.hit.features.filter(f => state.selection.includes(f.properties.way_id)).flatMap(f => f.geometry.coordinates) ?? [];
    if (!testMode && coords.length && map) {
      const xs = coords.map(p => p[0]), ys = coords.map(p => p[1]);
      map.fitBounds([[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]],
        {padding: cameraPadding(), maxZoom: 16, duration: reducedMotion() ? 0 : 600});
    }
    renderResults();
    const selected = [...$('roads').querySelectorAll('button')].find(control => control.dataset.ways === button.dataset.ways);
    selected?.focus();
  });
  const link = element('a', '↗');
  link.href = `https://www.openstreetmap.org/way/${ways[0].way_id}`;
  link.target = '_blank'; link.rel = 'noopener';
  link.setAttribute('aria-label', `Open ${name} on OpenStreetMap`);
  row.append(button, link);
  return row;
}

function renderResults() {
  const root = $('results'), trips = $('trips'), roads = $('roads');
  root.replaceChildren(); trips.replaceChildren(); roads.replaceChildren();
  const summary = state.summary;
  root.title = summary?.message ?? summary?.detail ?? '';
  if (!summary && (timing || perf)) root.append(element('p', $('status').textContent, 'message'));
  if (summary) {
    if (summary.message) {
      if (state.result?.candidate_trips && !state.result.affected_trips) {
        root.append(element('strong', state.result.candidate_trips.toLocaleString('en-US'), 'result-number'), element('span', summary.rerouted_label, 'label'));
        root.append(element('p', summary.message.replace(/^[\d,]+ /, ''), state.flipped ? 'message flip-message' : 'message'));
      } else root.append(element('p', summary.message, state.flipped ? 'message flip-message' : 'message'));
      root.setAttribute('aria-label', summary.message);
    }
    if (summary.numbers) {
      root.removeAttribute?.('aria-label');
      const numbers = element('div', undefined, 'numbers');
      for (const [key, label] of [['broken',summary.labels.broken], ['slowed',summary.labels.slowed], ['added_minutes',summary.labels.added_minutes]]) {
        const number = element('div', undefined, summary.numbers[key] ? key : 'zero');
        number.append(element('strong', `${key === 'added_minutes' ? '+' : ''}${summary.numbers[key].toLocaleString('en-US')}`), element('span', label));
        numbers.append(number);
      }
      const detail = element('p', summary.detail, state.flipped ? 'flip-message' : undefined);
      detail.title = summary.detail;
      textWithNumbers(detail, summary.detail);
      root.append(numbers, detail);
    }
    if (summary.mattered) {
      roads.append(element('h3', 'Roads that mattered'));
      const items = summary.mattered.rows;
      for (const item of state.showAll ? items : items.slice(0,5)) roads.append(roadRow(item));
      if (items.length > 5 && !state.showAll) {
        const more = element('button', summary.mattered.more_text);
        more.addEventListener('click', () => { state.showAll = true; renderResults(); $('roads').querySelector('button')?.focus(); });
        roads.append(more);
      }

    }
    for (const trip of summary.trips) {
      const row = element('li');
      row.append(element('span', trip.title, 'trip-kind'), element('span', trip.status, `trip-status ${trip.status}`),
        element('span', trip.duration_text, 'trip-duration tabular'), element('span', trip.id_text, 'trip-id mono'));
      trips.append(row);
    }
  }
  $('affected').hidden = !summary?.trips.length;
  $('affected-label').textContent = `Affected trips (${summary?.trips.length ?? 0})`;
  const presets = $('presets');
  const focusedPreset = presets.contains(document.activeElement) ? document.activeElement.dataset.preset : null;
  presets.replaceChildren();
  for (const preset of state.presets) {
    const label = presetLabel(preset.name), button = element('button', preset.name === 'bay_bridge' ? 'Bay Bridge closed' : label);
    button.type = 'button'; button.dataset.preset = preset.name;
    button.disabled = state.gateRunning || !['ready','pending','showing'].includes(state.phase);
    button.addEventListener('click', () => runEdit({preset: preset.name, label}));
    presets.append(button);
    if (preset.name === focusedPreset) button.focus();
  }
}

function clearDrawing() {
  if (state.shareHash) writeShareHash('');
  Object.assign(state, {flipped: false, result: null, drawn: null, summary: null, selection: null, showAll: false, ring: null, meteorCenter: null, fireMs: null});
  syncMap();
}

function panToTap(tap) {
  if (testMode || reducedMotion() || !map) return;
  map.easeTo({center: [tap.lon, tap.lat], pitch: 40, padding: cameraPadding(), duration: 600});
}

function fitResult() {
  if (testMode || reducedMotion() || !map || !state.drawn) return;
  const bounds = [[Infinity, Infinity], [-Infinity, -Infinity]];
  for (const collection of [state.drawn.hit, state.drawn.after]) {
    for (const feature of collection.features) {
      for (const [lon, lat] of feature.geometry.coordinates) {
        bounds[0][0] = Math.min(bounds[0][0], lon);
        bounds[0][1] = Math.min(bounds[0][1], lat);
        bounds[1][0] = Math.max(bounds[1][0], lon);
        bounds[1][1] = Math.max(bounds[1][1], lat);
      }
    }
  }
  if (!Number.isFinite(bounds[0][0])) return;
  map.fitBounds(bounds, {padding: cameraPadding(), pitch: 40, maxZoom: 14, duration: 600});
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
}

function cancelEdit(rebuilding = false) {
  settleTails(!rebuilding);
  if (rebuilding) fx?.rebuild();
  else fx?.clear();
  editToken++;
  shareVersion++;
  pendingReveal = undefined;
  cancelAnimation();
  for (const id of drawWaiters.keys()) finishRequest(id, 'Edit cancelled');
  return editToken;
}

function finishAnimation() {
  const current = animation;
  if (!current || current.token !== editToken) return;
  cancelAnimation();
  $('map').style.transform = '';
  if (current.edit.weapon === 'meteor') drawRing(current.tap, current.edit.radius_m);
  revealResult();
}

function revealResult() {
  if (!pendingReveal || animation) return;
  const {request, data} = pendingReveal;
  pendingReveal = undefined;
  if (request.token !== editToken) return;
  const {display, ...result} = data.result;
  state.flipped = request.edit.weapon === 'flip' || request.edit.preset === 'university_ramp';
  state.result = result;
  state.drawn = {before: linesToFeatures(display.before, 'trip'),
    after: linesToFeatures(display.after, 'trip'), hit: linesToFeatures(display.hit, 'way_id')};
  fx?.editTraffic?.(display.hit.ids, request.edit.weapon === 'flip' || request.edit.preset === 'university_ramp', display.after);
  state.summary = summarize(data.result, {meta: state.meta, edit: request.edit});
  state.phase = 'showing';
  state.hint = null;
  setHeight('summary');
  syncMap();
  render();
  revealRoutes();
  if (!request.edit.weapon) fitResult();
  if (timing || perf) {
    state.fireMs = performance.now() - request.started;
    renderStatus();
  }
  if (request.token !== editToken) return;
  // A successful road edit has already been validated by the worker.
  if (window.history?.replaceState) {
    const shared = serializeShare(request.edit, shareOptions(() => ({oneway: true})));
    writeShareHash(shared.ok ? shared.hash : '');
  }
  $('announcement').textContent = state.summary.announcement;
  finishRequest(data.id);
}

function settleTails(settleFx = true) {
  if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
  revealFrame = undefined;
  revealProgress = fadeProgress = 1;
  if (fadingDrawing && styleReady) map?.getSource('hit')?.setData(state.drawn?.hit ?? emptyCollection());
  fadingDrawing = undefined;
  if (settleFx) fx?.settle();
  if (map?.setPaintProperty && styleReady) {
    if (map.getLayer('after')) {
      map.setPaintProperty('after','line-opacity',0.85);
      map.setPaintProperty('after','line-width',3);
    }
    if (map.getLayer('hit')) map.setPaintProperty('hit','line-opacity',0.8);
  }
  $('map').style.transform = '';
}

function revealRoutes(rebuilding = false) {
  if (!map?.setPaintProperty || !styleReady || reducedMotion() || timing) return;
  const start = fxClock(), duration = rebuilding ? 320 : 400;
  const frame = now => {
    const t = Math.min(1,(fxClock()-start)/duration);
    if (rebuilding) {
      fadeProgress = 1-t;
      if (map.getLayer('hit')) map.setPaintProperty('hit','line-opacity',0.8*fadeProgress);
    } else {
      revealProgress = t;
      if (map.getLayer('after')) {
        map.setPaintProperty('after','line-opacity',0.85*t);
        map.setPaintProperty('after','line-width',3*t);
      }
    }
    if (t<1) revealFrame = requestAnimationFrame(frame);
    else { revealFrame = undefined; if (rebuilding) { fadingDrawing = undefined; fadeProgress = 1; syncMap(); } }
  };
  frame(start);
}

function hitCamera(edit, tap) {
  if (!tap || testMode || reducedMotion() || !map) return;
  if (edit.weapon === 'meteor') {
    const k = state.meta.earth_radius_m*Math.PI/180, dy=edit.radius_m/k, dx=dy/Math.cos(tap.lat*Math.PI/180);
    map.fitBounds([[tap.lon-dx,tap.lat-dy],[tap.lon+dx,tap.lat+dy]], {pitch:40,padding:cameraPadding(),duration:600});
  } else panToTap(tap);
}

function startAnimation(edit, tap, token, tapStarted = performance.now(), line = null) {
  cancelAnimation();
  const size = METEOR_SIZES.find(size => size.radius_m === edit.radius_m);
  const duration = edit.weapon === 'meteor' ? size.duration_ms : edit.weapon === 'pick' ? 180 : 500;
  tap ??= edit.weapon === 'meteor' ? {lat:edit.lat,lon:edit.lon} : line?.length ? {lon:line[0][0],lat:line[0][1]} : null;
  if (tap && !timing && (edit.weapon === 'pick' || edit.weapon === 'meteor')) fx?.ring([tap.lon,tap.lat],40,180);
  const still = timing || reducedMotion();
  const deadline = tap && edit.weapon !== 'pick' ? fx?.fire({weapon:edit.weapon,lngLat:[tap.lon,tap.lat],
    radius:edit.radius_m,scale:size?.scale,duration,line,seed:edit.way_id,still}) : undefined;
  if (edit.weapon !== 'pick') hitCamera(edit,tap);
  if (!edit.weapon || still) {
    if (edit.weapon === 'meteor') drawRing(tap, edit.radius_m);
    return;
  }
  const effect = {edit,tap,token,tapStarted,start:performance.now(),fxStart:fxClock(),duration,line};
  animation = effect;
  const frame = now => {
    if (token !== editToken || animation !== effect) return;
    if (reducedMotion()) { fx?.settle(); finishAnimation(); return; }
    const elapsed = fxClock()-effect.fxStart, fraction = Math.min(1,elapsed/duration);
    if (edit.weapon === 'meteor') drawRing(tap,edit.radius_m * (1-(1-Math.max(0,(fraction-0.65)/0.35))**3));
    if (edit.weapon === 'stomp') $('map').style.transform = elapsed<150 ? `translate(${4*Math.sin(elapsed*0.13)}px,${4*Math.cos(elapsed*0.17)}px)` : '';
    if (fraction>=1) { finishAnimation(); return; }
    animationFramesScheduled++;
    effect.frame=requestAnimationFrame(frame);
  };
  scheduleDeadline(effect,deadline ?? duration);
  frame(effect.start);
}

function scheduleDeadline(effect, duration = effect.duration) {
  clearTimeout(effect.timer);
  effect.timer=setTimeout(() => { if (animation===effect) finishAnimation(); },
    Math.max(0,duration-(fxClock()-effect.fxStart))/fxTimeScale);
}

function runEdit(edit, tap, started = performance.now(), token, line) {
  const fromTap = Boolean(tap);
  if (edit.weapon === 'meteor') {
    if (!METEOR_SIZES.some(size => size.radius_m === edit.radius_m)) throw new Error('Unsupported Meteor radius');
    edit = {...edit, lat: Number(edit.lat.toFixed(5)), lon: Number(edit.lon.toFixed(5))};
    tap = {lat: edit.lat, lon: edit.lon};
  }
  if (token === undefined) { token = cancelEdit(); clearDrawing(); }
  state.shareNotice = null;
  if (token !== editToken) return;
  state.phase = 'pending';
  state.hint = null;
  startAnimation(edit, tap, token, started, line);
  const id = sendRequest('edit', {edit, tap, started, token, fromTap});
  render();
  return id;
}

function onMapClick(event) {
  if (state.home || !map?.isStyleLoaded()) return;
  fireAt({lat: event.lngLat.lat, lon: event.lngLat.lng});
}

function fireAt(tap) {
  const started = performance.now();
  if (state.gateRunning) return;
  if (!['ready', 'showing', 'pending'].includes(state.phase)) return;
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
    renderStatus();
    $('announcement').textContent = `Meteor size: ${size.name} ${size.radius_m.toLocaleString('en-US')} m`;
  });
  label.append(input, document.createTextNode(size.radius_m === 500 ? '500 m' : '1.5 km'));
  $('meteor-sizes').append(label);
}

document.querySelectorAll('[data-weapon]').forEach(button => {
  button.addEventListener('click', () => {
    if (state.gateRunning || !['ready', 'pending', 'showing'].includes(state.phase)) return;
    state.weapon = button.dataset.weapon;
    renderButtons();
    renderStatus();
    positionCrosshair();
  });
});
function rebuild() {
  pendingShareHash = '';
  state.shareNotice = null;
  writeShareHash('');
  const previous = state.drawn;
  cancelEdit(true);
  fadingDrawing = reducedMotion() || timing ? undefined : previous;
  // Rebuild disables itself, which would drop keyboard focus to the page; hand it to the weapons.
  const hadFocus = document.activeElement === $('rebuild');
  const id = sendRequest('reset');
  $('announcement').textContent = '';
  clearDrawing();
  revealRoutes(true);
  state.phase = 'ready';
  state.hint = null;
  setHeight('summary');
  render();
  if (hadFocus) (document.querySelector('[data-weapon][aria-pressed="true"]') ?? document.querySelector('[data-weapon]')).focus();
  return id;
}
$('rebuild').addEventListener('click', rebuild);

// Preset buttons and replayed preset links must show the same title.
function presetLabel(name) {
  const fallback = {bay_bridge: 'Bay Bridge', university_ramp: 'University Ave ramp'};
  return state.meta.presets?.[name]?.label ?? fallback[name]
    ?? state.presets.find(preset => preset.name === name)?.label;
}

function shareOptions(lookupWay) {
  return {box: state.meta?.box, sizes: METEOR_SIZES,
    presetNames: state.presets.map(preset => preset.name), lookupWay};
}

function writeShareHash(hash) {
  state.shareHash = hash;
  // replaceState creates no Back entries and dispatches no hashchange event.
  window.history?.replaceState(null, '', location.pathname + location.search + hash);
  $('share-link').hidden = true;
  $('share-link').href = hash || '#';
  $('copy-link').hidden = !hash;
  $('share-link').value = location.href;
}

async function loadWayLookup() {
  // Only road-link replay needs these two small arrays. Reuse the shipped URLs/cache;
  // geometry and the rest of the graph stay in the worker.
  if (!wayLookupPromise) wayLookupPromise = (async () => {
    const read = async (name, Type) => {
      const spec = state.meta.arrays.find(array => array.name === name);
      const response = await fetch(`./data/${spec.file}`);
      if (!response.ok) throw new Error('Way lookup unavailable');
      const packed = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', packed);
      const sha = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
      if (sha !== state.meta.files.find(file => file.file === spec.file).sha256) throw new Error('Way lookup hash mismatch');
      const raw = await new Response(new Blob([packed]).stream()
        .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const offset = spec.byte_offset ?? 0;
      if (raw.byteLength - offset !== spec.length * Type.BYTES_PER_ELEMENT) throw new Error('Way lookup length mismatch');
      return new Type(raw.slice(offset));
    };
    const [ids, oneway] = await Promise.all([read('way_osm_id', Float64Array), read('way_oneway', Uint8Array)]);
    return id => {
      const index = ids.indexOf(id);
      return index < 0 ? null : {oneway: Boolean(oneway[index])};
    };
  })().catch(error => { wayLookupPromise = undefined; throw error; });
  return wayLookupPromise;
}

async function replayShare(hash) {
  if (hash) showHome(false);
  // Cancel an older edit immediately, so its late result cannot overwrite this link.
  cancelEdit();
  const version = shareVersion;
  latest.next();
  clearDrawing();
  state.phase = 'ready';
  state.hint = null;
  state.shareNotice = null;
  render();
  if (!hash) { rebuild(); return; }
  try {
    // Validate raw syntax before fetching a lookup for road ids.
    let parsed = parseShare(hash, shareOptions(() => ({oneway: true})));
    if (parsed.ok && parsed.edit.way_id !== undefined) {
      const lookup = await loadWayLookup();
      if (version !== shareVersion) return;
      parsed = parseShare(hash, shareOptions(lookup));
    }
    if (version !== shareVersion) return;
    if (!parsed.ok) { rejectShare(); return; }
    const edit = parsed.edit;
    if (edit.preset) edit.label = presetLabel(edit.preset);
    if (edit.weapon) state.weapon = edit.weapon;
    if (edit.weapon === 'meteor') {
      state.meteorRadius = edit.radius_m;
      document.querySelectorAll('[name="meteor-size"]').forEach(input => {
        input.checked = Number(input.value) === edit.radius_m;
      });
    }
    runEdit(edit);
    showHome(false);
  } catch {
    if (version === shareVersion) rejectShare();
  }
}

function rejectShare() {
  rebuild();
  state.shareNotice = 'This share link is invalid or unavailable. Pick a new edit.';
  renderStatus();
}

window.addEventListener('hashchange', event => {
  // Skip superseded events if several hashes changed before their events arrived.
  const hash = location.hash || '';
  if (event.newURL && new URL(event.newURL).hash !== hash) return;
  if (hash && !isShare(hash)) return;
  if (hash && state.home) showHome(false);
  if (state.phase === 'loading') pendingShareHash = hash;
  else if (['ready', 'pending', 'showing'].includes(state.phase)) replayShare(hash);
});

$('details-button').addEventListener('click', () => setHeight(state.sheetHeight === 'details' ? 'summary' : 'details'));
let dragStart, dragging = false;
$('summary').addEventListener('pointerdown', event => { dragStart = {x: event.clientX, y: event.clientY}; dragging = false; });
$('summary').addEventListener('pointermove', event => {
  if (!dragStart) return;
  if (Math.abs(event.clientY-dragStart.y) > 10 && Math.abs(event.clientY-dragStart.y) > Math.abs(event.clientX-dragStart.x)) {
    dragging = true;
    $('summary').setPointerCapture?.(event.pointerId);
  }
});
$('summary').addEventListener('pointerup', event => {
  if (dragging && Math.abs(event.clientY-dragStart.y) > 24) setHeight(event.clientY < dragStart.y ? 'details' : 'summary');
  dragStart = undefined;
});
$('summary').addEventListener('pointercancel', () => { dragStart = undefined; });
$('start').addEventListener('click', () => showHome(false));
$('back').addEventListener('click', () => showHome(true));
function startPreset(name) {
  if (state.gateRunning || !['ready','pending','showing'].includes(state.phase)) return;
  showHome(false);
  const hash = `#preset=${name}`;
  if (state.phase === 'loading') pendingShareHash = hash;
  else replayShare(hash);
}
$('home-preset').addEventListener('click', () => startPreset('bay_bridge'));
let copyTimer;
$('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $('copy-link').textContent = 'Copied';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { $('copy-link').textContent = 'Copy link'; }, 2000);
  } catch { $('share-link').hidden = false; $('share-link').value = location.href; $('share-link').focus(); $('share-link').select(); }
});
$('recenter').addEventListener('click', recenter);
for (const id of ['retry','home-retry']) $(id).addEventListener('click', async () => { if (!map && !await createMap()) return; loadNetwork(); });
$('theme').addEventListener('click', () => {
  setTheme(state.theme === 'light' ? 'dark' : 'light');
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
    setHeight('summary');
    render();
  }
}

async function runPerfCheck() {
  state.gateRunning=true; $('perf-check').disabled=true; render();
  const intervals=[], meteorTimes=[];
  let frame, previous, recording=true;
  const record=now => {
    if (previous!==undefined && !document.hidden) intervals.push(now-previous);
    previous=document.hidden ? undefined : now;
    if (recording) frame=requestAnimationFrame(record);
  };
  const pause=ms => new Promise(resolve => setTimeout(resolve,ms));
  const visibility=() => { previous=undefined; };
  document.addEventListener('visibilitychange',visibility);
  try {
    if (state.phase==='showing') await measured(rebuild);
    await waitForReady();
    frame=requestAnimationFrame(record);
    for (const pitch of [0,40]) {
      map.jumpTo({center:[-122.315,37.825],zoom:13,pitch});
      await pause(10000);
    }
    for (let cycle=0;cycle<4;cycle++) {
      if (cycle) { await measured(rebuild); await pause(400); }
      const result=await measured(() => runEdit({weapon:'meteor',lat:37.825,lon:-122.315,radius_m:1500}));
      meteorTimes.push(result.fire_ms);
      await pause(2600);
    }
    const sorted=intervals.sort((a,b) => a-b), at=p => sorted[Math.max(0,Math.ceil(sorted.length*p)-1)] ?? 0;
    $('perf-json').value=JSON.stringify({page_url:location.href,user_agent:navigator.userAgent,
      timestamp_utc:new Date().toISOString(),export_git_commit:state.meta.git_commit,
      viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},...fx.perfStats(),
      frame_ms:{p50:at(.5),p95:at(.95),p99:at(.99),max:at(1),over_50:intervals.filter(n => n>50).length},
      meteor_fire_to_result_ms:meteorTimes},null,2);
  } catch (error) { $('perf-json').value=`Perf check failed: ${error.message}`; }
  finally { recording=false; cancelAnimationFrame(frame); document.removeEventListener('visibilitychange',visibility); state.gateRunning=false; $('perf-check').disabled=false; render(); }
}
if (perf) { $('perf-tools').hidden=false; $('perf-check').addEventListener('click',runPerfCheck); }

if (timing) {
  $('timing-tools').hidden = false;
  $('phone-gate').addEventListener('click', runPhoneGate);
}

document.documentElement.dataset.theme = state.theme;
document.documentElement.dataset.home = String(state.home);
render();
$('home').hidden = !state.home;
$('home').inert = !state.home;
$('game').inert = state.home;
if (state.home) $('start').focus();
if (!skipHome) loadHomeMeta();
loadNetwork();
mapCreation = createMap();

$('game').addEventListener('keydown', event => {
  if (event.key === 'Escape' && !state.home) {
    event.preventDefault();
    document.querySelector(`[data-weapon="${state.weapon}"]`).focus();
  }
});

$('map').addEventListener('keydown', event => {
  if (event.target !== $('map') || state.home) return;
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
    const point = crosshairPoint();
    fireAt({lat: point.lat, lon: point.lng});
  } else return;
  event.preventDefault();
});

motionPreference.addEventListener('change', () => {
  settleTails();
  if (reducedMotion()) finishAnimation();
});

if (new URLSearchParams(location.search).has('test')) {
  window.__playground = {
    ready,
    fxTimeScale(k) {
      if (!Number.isFinite(k) || k<=0) throw new Error('Time scale must be positive');
      fx?.timeScale(k); fxTimeScale=k;
      if (animation) scheduleDeadline(animation);
    },
    trafficStats:() => fx?.trafficStats(),
    trafficSample:n => fx?.trafficSample(n),
    trafficFramesRequested:() => fx?.trafficFramesRequested() ?? 0,
    fxEndState:() => fx?.endState(),
    fxStats: () => fx?.stats() ?? {enabled: false, buffers: 0, programs: 0, textures: 0, drawnLastFrame: 0},
    fxRing: (lat, lon, radius_m, ms) => fx?.ring([lon, lat], radius_m, ms),
    fxParticle: (lat, lon) => fx?.particle([lon, lat]),
    loseContext() {
      const canvas = map?.getCanvas();
      contextExtension = (canvas?.getContext('webgl2') || canvas?.getContext('webgl'))?.getExtension('WEBGL_lose_context');
      contextExtension?.loseContext();
    },
    restoreContext: () => contextExtension?.restoreContext(),
    buildingIdProbe,
    crosshairPoint,
    setReducedMotion(value) { motionOverride = value; settleTails(); if (reducedMotion()) finishAnimation(); },
    camera({lng,lat,zoom,pitch}) { map.jumpTo({center:[lng,lat],zoom,pitch}); },
    fxRingRadiusPx: (overlay = false) => {
      if (!overlay) {
        const ring=fx?.ringRadius();
        if (!ring) return 0;
        const [lng,lat]=ring.center, k=2*Math.PI*state.meta.earth_radius_m*Math.cos(lat*Math.PI/180);
        const a=map.project(ring.center), b=map.project([lng+ring.radius*360/k,lat]);
        return Math.hypot(b.x-a.x,b.y-a.y);
      }
      if (!state.ring) return 0;
      const a=map.project(state.meteorCenter.geometry.coordinates), b=map.project(state.ring.geometry.coordinates[0][0]);
      return Math.hypot(b.x-a.x,b.y-a.y);
    },
    animationsRunning: () => Boolean(animation),
    animationFramesScheduled: () => animationFramesScheduled,
    staticOutline: () => Boolean(state.ring),
    fireAt,
    fireRoad: (weapon, way_id) => measured(() => runEdit(Array.isArray(way_id) ? {weapon,way_ids:way_id} : {weapon,way_id})),
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
      return {sources: Object.keys(style.sources).length, layers: style.layers.length, fx_layers: map.getLayer('fx') ? 1 : 0,
        features: own.reduce((sum, data) => sum + (data?.type === 'Feature' ? 1 : data?.features?.length || 0), 0)};
    },
  };
}
