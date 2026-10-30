import {createLatest} from './core/latest.js';

const $ = id => document.getElementById(id);
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
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
  $('status').textContent = messages[state.phase];
  $('progress').hidden = state.phase !== 'loading';
  $('sheet').setAttribute('aria-busy', String(state.phase === 'loading'));
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
    {id: 'hit', data: state.result?.hit_geojson, color: '--broken', width: 4, opacity: 0.8},
    {id: 'before', data: null, color: '--before', width: 3, opacity: 0.8},
    {id: 'after', data: null, color: '--accent', width: 3, opacity: 0.95},
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
}

function recenter() {
  if (!map || !state.meta) return;
  const {min_lat, max_lat, min_lon, max_lon} = state.meta.box;
  const sheetHeight = $('sheet').getBoundingClientRect().height;
  map.fitBounds([[min_lon, min_lat], [max_lon, max_lat]], {
    padding: desktop.matches
      ? {top: 48, bottom: 48, left: 428, right: 80}
      : {top: 16, bottom: sheetHeight + 8, left: 24, right: 64},
    duration: reducedMotion.matches ? 0 : 600,
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
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({compact: false}), 'bottom-right');
    map.once('style.load', () => {
      styleReady = true;
      state.mapError = null;
      renderStatus();
      syncMap();
    });
    map.once('load', () => { firstMapLoad = true; });
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
  worker.postMessage({...payload, id, type});
  return id;
}

function loadNetwork() {
  worker?.terminate();
  // Invalidate even replies already queued by the terminated worker.
  latest.next();
  state.phase = 'loading';
  state.error = null;
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
        fail(`The Bay road network could not load: ${String(data.error).replace(/^Error: /, '')}`, true);
        return;
      }
      const {meta, presets, load_ms, baseline} = data.result;
      Object.assign(state, {meta, presets, load_ms, baseline, phase: 'ready', error: null});
      syncMap();
      render();
    };
    worker.onerror = event => {
      if (worker !== activeWorker) return;
      event.preventDefault();
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
