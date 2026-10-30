/* P0 measurement worker: fixed endpoints, all parallel edges, one active edit. */
'use strict';
let meta, a, labels, names, mask, wayEdges, edgeTrips, grid, wayIndex;
let distances, pred, touched, touchedCount, heap, reverseOffsets, reverseEdges, presetResults = {};
const R = 6371008.8, DEG = Math.PI / 180;
const GRID_LAT = 250 / (R * DEG), GRID_LON = GRID_LAT / Math.cos(37.65 * DEG);
const constructors = {'<f8': Float64Array, '<u4': Uint32Array, '<i4': Int32Array, u1: Uint8Array};
const now = () => performance.now();

class Heap {
  constructor() { this.vertices = new Int32Array(1024); this.keys = new Float64Array(1024); this.length = 0; }
  push(node, cost) {
    if (this.length === this.vertices.length) {
      const vertices = new Int32Array(this.length * 2), keys = new Float64Array(this.length * 2);
      vertices.set(this.vertices); keys.set(this.keys); this.vertices = vertices; this.keys = keys;
    }
    let i = this.length++;
    while (i > 0) {
      const p = (i - 1) >> 1, k = this.keys[p], v = this.vertices[p];
      if (k < cost || (k === cost && v <= node)) break;
      this.vertices[i] = v; this.keys[i] = k; i = p;
    }
    this.vertices[i] = node; this.keys[i] = cost;
  }
  pop() {
    this.node = this.vertices[0]; this.cost = this.keys[0];
    const size = --this.length, node = this.vertices[size], cost = this.keys[size];
    let i = 0;
    while (2 * i + 1 < size) {
      let c = 2 * i + 1;
      if (c + 1 < size && (this.keys[c + 1] < this.keys[c] ||
          (this.keys[c + 1] === this.keys[c] && this.vertices[c + 1] < this.vertices[c]))) c++;
      if (this.keys[c] > cost || (this.keys[c] === cost && this.vertices[c] >= node)) break;
      this.vertices[i] = this.vertices[c]; this.keys[i] = this.keys[c]; i = c;
    }
    this.vertices[i] = node; this.keys[i] = cost;
  }
}

function path(trip) {
  return a.trip_path_edges.subarray(a.trip_path_offsets[trip], a.trip_path_offsets[trip + 1]);
}

function geometry(way) {
  const result = [];
  for (let p = a.geometry_offsets[way]; p < a.geometry_offsets[way + 1]; p++) {
    result.push([a.geometry_coords[2 * p + 1] / 1e6, a.geometry_coords[2 * p] / 1e6]);
  }
  return result;
}

function cells(minLat, maxLat, minLon, maxLon, visit) {
  for (let y = Math.floor(minLat / GRID_LAT); y <= Math.floor(maxLat / GRID_LAT); y++) {
    for (let x = Math.floor(minLon / GRID_LON); x <= Math.floor(maxLon / GRID_LON); x++) visit(`${x},${y}`);
  }
}

function buildIndices() {
  wayIndex = new Map(Array.from(a.way_osm_id, (id, i) => [id, i]));
  wayEdges = Array.from({length: meta.counts.ways}, () => []);
  edgeTrips = Array.from({length: meta.counts.edges}, () => []);
  for (let e = 0; e < meta.counts.edges; e++) wayEdges[a.edge_way[e]].push(e);
  for (let t = 0; t < meta.counts.trips; t++) {
    for (const e of new Set(path(t))) edgeTrips[e].push(t);
  }
  grid = new Map();
  for (let w = 0; w < meta.counts.ways; w++) {
    const points = geometry(w);
    const keys = new Set();
    for (let p = 1; p < points.length; p++) {
      const [x, y] = points[p - 1], [xx, yy] = points[p];
      cells(Math.min(y, yy), Math.max(y, yy), Math.min(x, xx), Math.max(x, xx), k => keys.add(k));
    }
    for (const key of keys) {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(w);
    }
  }
  mask = a.edge_initially_active.slice();
  distances = new Float64Array(meta.counts.vertices).fill(Infinity);
  pred = new Int32Array(meta.counts.vertices).fill(-1);
  touched = new Int32Array(meta.counts.vertices); touchedCount = 0; heap = new Heap();
  reverseOffsets = new Uint32Array(meta.counts.vertices + 1);
  for (const v of a.edge_target) reverseOffsets[v + 1]++;
  for (let v = 1; v < reverseOffsets.length; v++) reverseOffsets[v] += reverseOffsets[v - 1];
  const cursor = reverseOffsets.slice(); reverseEdges = new Uint32Array(meta.counts.edges);
  for (let e = 0; e < meta.counts.edges; e++) reverseEdges[cursor[a.edge_target[e]]++] = e;
}

async function load(message) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is unavailable. Use a current Chrome, Firefox, Edge or Safari.');
  }
  // Typed-array views require a little-endian host; fail explicitly on other hosts.
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) throw new Error('Little-endian browser required');
  const start = now(), base = new URL(message.baseUrl || '../../../data/playground-spike/', self.location.href);
  const fetchFile = async file => {
    const response = await fetch(new URL(file, base));
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    return response;
  };
  meta = await (await fetchFile('meta.json')).json();
  if (meta.format_version !== 0) throw new Error(`Unsupported format ${meta.format_version}`);
  const packed = await Promise.all(meta.files.map(async file => {
    const resp = await fetchFile(file.file);
    const bytes = await resp.arrayBuffer();
    if (bytes.byteLength !== file.gzip_bytes) throw new Error(`${file.file}: gzip byte length mismatch`);
    return [file.file, bytes];
  }));
  const fetched = now();
  const decoded = new Map(await Promise.all(packed.map(async ([file, bytes]) => {
    const resp = new Response(bytes);
    const buffer = await new Response(resp.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return [file, buffer];
  })));
  const decompressed = now();
  a = {};
  for (const desc of meta.arrays) {
    const Type = constructors[desc.dtype];
    if (!Type) throw new Error(`Unknown dtype ${desc.dtype}`);
    a[desc.name] = new Type(decoded.get(desc.file), desc.byte_offset, desc.length);
  }
  names = JSON.parse(new TextDecoder().decode(decoded.get('way_names.json.gz')));
  labels = JSON.parse(new TextDecoder().decode(decoded.get('trip_labels.json.gz')));
  if (decoded.has('presets.json.gz')) presetResults = JSON.parse(new TextDecoder().decode(decoded.get('presets.json.gz')));
  buildIndices();
  return {type: 'loaded', meta, timings: {fetch_ms: fetched - start,
    decompress_ms: decompressed - fetched, index_build_ms: now() - decompressed, total_ms: now() - start},
    resources: performance.getEntriesByType('resource').map(e => ({name: e.name,
      transferSize: e.transferSize, encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize}))};
}

function meteor(lat, lon, radius) {
  if (![lat, lon, radius].every(Number.isFinite) || radius < 0) throw new Error('Invalid meteor coordinates/radius');
  const dy = radius / (R * DEG), dx = dy / Math.cos(lat * DEG), candidates = new Set();
  cells(lat - dy, lat + dy, lon - dx, lon + dx, key => {
    for (const w of grid.get(key) || []) candidates.add(w);
  });
  const hit = [];
  const scaleX = R * DEG * Math.cos(lat * DEG), scaleY = R * DEG;
  for (const w of candidates) {
    const points = geometry(w);
    for (let p = 1; p < points.length; p++) {
      const x = (points[p - 1][0] - lon) * scaleX, y = (points[p - 1][1] - lat) * scaleY;
      const vx = (points[p][0] - points[p - 1][0]) * scaleX;
      const vy = (points[p][1] - points[p - 1][1]) * scaleY;
      const norm = vx * vx + vy * vy;
      const t = norm ? Math.max(0, Math.min(1, -(x * vx + y * vy) / norm)) : 0;
      if ((x + t * vx) ** 2 + (y + t * vy) ** 2 <= radius ** 2) { hit.push(w); break; }
    }
  }
  return hit.sort((x, y) => x - y);
}

function groupTrips(trips) {
  const remaining = new Set(trips), origins = new Map(), destinations = new Map(), groups = [];
  for (const t of trips) {
    for (const [map, vertex] of [[origins, a.trip_origin[t]], [destinations, a.trip_destination[t]]]) {
      if (!map.has(vertex)) map.set(vertex, new Set());
      map.get(vertex).add(t);
    }
  }
  while (remaining.size) {
    let best, vertex, reverse = false;
    for (const [map, backwards] of [[origins, false], [destinations, true]]) {
      for (const [v, group] of map) if (!best || group.size > best.size) { best = group; vertex = v; reverse = backwards; }
    }
    const group = [...best]; groups.push({vertex, trips: group, reverse});
    for (const t of group) {
      remaining.delete(t); origins.get(a.trip_origin[t]).delete(t); destinations.get(a.trip_destination[t]).delete(t);
    }
  }
  // Never use more searches than either pure orientation.
  const pure = reverse => {
    const map = new Map();
    for (const t of trips) {
      const v = reverse ? a.trip_destination[t] : a.trip_origin[t];
      if (!map.has(v)) map.set(v, []);
      map.get(v).push(t);
    }
    return [...map].map(([vertex, trips]) => ({vertex, trips, reverse}));
  };
  let chosen = groups;
  for (const reverse of [false, true]) { const candidate = pure(reverse); if (candidate.length < chosen.length) chosen = candidate; }
  return chosen;
}

function walk(origin, targets, reverse = false, limit = Infinity, wantPaths = false) {
  // Keep hot-loop references local as well as reusing their backing buffers.
  const distance = distances, predecessor = pred, queue = heap, visited = touched;
  const active = mask, sources = a.edge_source, targetsByEdge = a.edge_target, costs = a.edge_seconds;
  const reversed = reverseEdges;
  let count = touchedCount;
  for (let i = 0; i < count; i++) { const v = visited[i]; distance[v] = Infinity; predecessor[v] = -1; }
  count = 0; queue.length = 0;
  distance[origin] = 0; visited[count++] = origin; queue.push(origin, 0);
  const offsets = reverse ? reverseOffsets : a.csr_offsets;
  while (queue.length && targets.size) {
    queue.pop(); const u = queue.node, cost = queue.cost;
    if (cost !== distance[u]) continue;
    if (cost > limit) break;
    targets.delete(u); if (!targets.size) break;
    for (let i = offsets[u]; i < offsets[u + 1]; i++) {
      const e = reverse ? reversed[i] : i;
      if (!active[e]) continue;
      const v = reverse ? sources[e] : targetsByEdge[e], next = cost + costs[e];
      if (next <= limit && next < distance[v]) {
        if (distance[v] === Infinity) visited[count++] = v;
        distance[v] = next; if (wantPaths) predecessor[v] = e; queue.push(v, next);
      }
    }
  }
  touchedCount = count;
}

function search(origin, trips, wantPaths = false, reverse = false) {
  const endpoint = t => reverse ? a.trip_origin[t] : a.trip_destination[t];
  walk(origin, new Set(trips.map(endpoint)), reverse, Infinity, wantPaths);
  const result = new Map();
  for (const t of trips) {
    const seconds = distances[endpoint(t)]; let edges = null;
    if (wantPaths && Number.isFinite(seconds)) {
      edges = []; let v = endpoint(t);
      while (v !== origin) {
        const e = pred[v]; if (e < 0) throw new Error('Missing predecessor/successor');
        edges.push(e); v = reverse ? a.edge_target[e] : a.edge_source[e];
      }
      if (!reverse) edges.reverse();
    }
    result.set(t, {seconds, edges});
  }
  return result;
}

// A constructed active route is an upper bound, never an estimate of the shortest route.
function detourOK(t, cache, counters) {
  let extra = 0, run = [];
  function flush() {
    if (!run.length) return true;
    const source = a.edge_source[run[0]], target = a.edge_target[run[run.length - 1]];
    const cost = run.reduce((sum, e) => sum + a.edge_seconds[e], 0), key = `${source},${target}`;
    if (!cache.has(key)) {
      const started = now();
      walk(source, new Set([target]), false, cost + meta.slow_seconds);
      counters.bound_ms += now() - started;
      cache.set(key, distances[target]); counters.bound++;
    }
    const detour = cache.get(key); run = [];
    if (!Number.isFinite(detour)) return false;
    extra += detour - cost; return true;
  }
  for (const e of path(t)) {
    if (!mask[e]) run.push(e);
    else if (!flush()) return false;
  }
  return flush() && extra < meta.slow_seconds - 1e-8;
}

function classify(t, seconds) {
  return !Number.isFinite(seconds) ? 'broken' : seconds - a.trip_seconds[t] >= meta.slow_seconds ? 'slowed' : 'ok';
}

function attribution(affected, destroyed, budget, counters) {
  const rows = new Map(), singleJobs = new Map();
  for (const [t, impact] of affected) {
    const candidates = [...new Set(Array.from(path(t), e => a.edge_way[e]).filter(w => destroyed.has(w)))];
    const row = {trip_id: labels[t].trip_id, candidates, confirmed_singles: [], confirmed_runs: [],
      tested_candidates: [], unchecked_candidates: [], runs: [], testedRuns: 0, impact};
    rows.set(t, row);
    for (const w of candidates) {
      if (!singleJobs.has(w)) singleJobs.set(w, []);
      singleJobs.get(w).push(t);
    }
  }
  const recovers = (t, seconds) => rows.get(t).impact === 'broken' ? Number.isFinite(seconds) :
    Number.isFinite(seconds) && seconds - a.trip_seconds[t] < meta.slow_seconds;
  function test(ways, trips, phase, record) {
    const saved = [];
    for (const w of ways) for (const e of wayEdges[w]) {
      saved.push([e, mask[e]]); mask[e] = a.edge_initially_active[e];
    }
    try {
      const remaining = [];
      for (const t of trips) {
        if (path(t).every(e => mask[e])) record(t, true);
        else remaining.push(t);
      }
      for (const {vertex: origin, trips: group, reverse} of groupTrips(remaining)) {
        if (counters.attribution >= budget) break;
        const results = search(origin, group, false, reverse);
        counters.attribution++; counters[phase]++;
        for (const t of group) record(t, recovers(t, results.get(t).seconds));
      }
    } finally { for (const [e, active] of saved) mask[e] = active; }
  }
  // Most widely used candidates first; stable way index resolves ties.
  const jobs = [...singleJobs].sort((x, y) => y[1].length - x[1].length || x[0] - y[0]);
  for (const [w, trips] of jobs) test([w], trips, 'single', (t, recovered) => {
    rows.get(t).tested_candidates.push(w);
    if (recovered) rows.get(t).confirmed_singles.push(w);
  });
  const runJobs = new Map();
  for (const [t, row] of rows) {
    row.unchecked_candidates = row.candidates.filter(w => !row.tested_candidates.includes(w));
    if (row.confirmed_singles.length || row.unchecked_candidates.length) continue;
    let run = new Set();
    function flush() {
      if (run.size >= 2) {
        const ways = [...run].sort((x, y) => x - y), key = ways.join(',');
        row.runs.push(ways);
        if (!runJobs.has(key)) runJobs.set(key, {ways, trips: new Set()});
        runJobs.get(key).trips.add(t);
      }
      run = new Set();
    }
    for (const e of path(t)) { if (!mask[e]) run.add(a.edge_way[e]); else flush(); }
    flush();
    // Identical runs require just one counterfactual search per trip.
    row.runs = [...new Map(row.runs.map(r => [r.join(','), r])).values()];
  }
  for (const {ways, trips} of [...runJobs.values()].sort((x, y) => y.trips.size - x.trips.size)) {
    test(ways, [...trips], 'run', (t, recovered) => {
      rows.get(t).testedRuns++;
      if (recovered) rows.get(t).confirmed_runs.push(ways);
    });
  }
  return [...rows.values()].map(row => {
    const incomplete = row.unchecked_candidates.length > 0 || row.testedRuns < row.runs.length;
    const label = incomplete ? 'incomplete' : row.confirmed_singles.length ? 'single' :
      row.confirmed_runs.length ? 'run' : 'several_together';
    const osm = w => a.way_osm_id[w];
    return {trip_id: row.trip_id, candidates: row.candidates.map(osm),
      confirmed_singles: row.confirmed_singles.map(osm), confirmed_runs: row.confirmed_runs.map(r => r.map(osm)),
      tested_candidates: row.tested_candidates.map(osm), unchecked_candidates: row.unchecked_candidates.map(osm),
      tested_runs: row.testedRuns, total_runs: row.runs.length, label};
  });
}

function routeFeature(edges, trip, phase, status) {
  const coordinates = [];
  if (edges.length) {
    const u = a.edge_source[edges[0]];
    coordinates.push([a.vertex_lon[u], a.vertex_lat[u]]);
    for (const e of edges) {
      const v = a.edge_target[e]; coordinates.push([a.vertex_lon[v], a.vertex_lat[v]]);
    }
  }
  return coordinates.length >= 2 ? {type: 'Feature', properties: {trip_id: labels[trip].trip_id, phase, status},
    geometry: {type: 'LineString', coordinates}} : null;
}

function edit(message) {
  if (!mask) throw new Error('Load the graph before editing');
  const start = now(); mask.set(a.edge_initially_active);
  if (message.preset) {
    const result = presetResults[message.preset];
    if (!result) throw new Error(`Unknown precomputed preset: ${message.preset}`);
    const features = [];
    for (const row of result.trips) {
      const t = row.trip_index;
      const before = routeFeature(Array.from(path(t)), t, 'before', row.status);
      const after = row.new_path && routeFeature(row.new_path, t, 'after', row.status);
      if (before) features.push(before); if (after) features.push(after);
    }
    return {...result, precomputed: true, searches: 0, bound_searches: 0, reroute_searches: 0,
      attribution_searches: 0, single_searches: 0, run_searches: 0,
      geojson: {type: 'FeatureCollection', features},
      timings: {lookup_ms: now() - start, bound_ms: 0, reroute_ms: 0, attribution_ms: 0, total_ms: now() - start}};
  }
  const weapon = message.weapon;
  if (weapon === 'reset') return {type: 'reset', timings: {lookup_ms: now() - start, reroute_ms: 0, attribution_ms: 0}, searches: 0};
  let ways;
  if (weapon === 'meteor') ways = meteor(message.lat, message.lon, message.radius_m);
  else if (weapon === 'stomp' || weapon === 'flip') {
    const ids = weapon === 'flip' ? [message.way_id] : message.way_ids;
    if (!Array.isArray(ids)) throw new Error('way_ids must be an array');
    ways = [...new Set(ids.map(id => {
      if (!wayIndex.has(id)) throw new Error(`Way ${id} missing from exported graph`);
      return wayIndex.get(id);
    }))];
  } else throw new Error(`Unknown weapon: ${weapon}`);
  if (weapon === 'flip') {
    const w = ways[0];
    if (!a.way_oneway[w]) throw new Error('This road is two-way');
    const before = mask.slice();
    for (const e of wayEdges[w]) mask[e] = 0;
    for (const e of wayEdges[w]) if (before[e]) {
      if (a.edge_twin[e] < 0) throw new Error('One-way edge has no reverse twin');
      mask[a.edge_twin[e]] = 1;
    }
  } else for (const w of ways) for (const e of wayEdges[w]) mask[e] = 0;
  const candidates = new Set();
  for (const w of ways) for (const e of wayEdges[w]) {
    if (a.edge_initially_active[e] && !mask[e]) for (const t of edgeTrips[e]) candidates.add(t);
  }
  const lookupEnd = now();
  const counters = {reroute: 0, attribution: 0, single: 0, run: 0, bound: 0, bound_ms: 0}, affected = new Map(), features = [], tripResults = [];
  const cache = new Map();
  const full = [...candidates].sort((x, y) => x - y).filter(t => !detourOK(t, cache, counters));
  const groups = groupTrips(full);
  let broken = 0, slowed = 0, added = 0;
  for (const {vertex: origin, trips, reverse} of groups) {
    const results = search(origin, trips, tripResults.length < 25, reverse); counters.reroute++;
    for (const t of trips) {
      const result = results.get(t), status = classify(t, result.seconds);
      if (status === 'ok') continue;
      affected.set(t, status);
      if (status === 'broken') broken++;
      else { slowed++; added += result.seconds - a.trip_seconds[t]; }
      if (tripResults.length < 25) {
        tripResults.push({trip_id: labels[t].trip_id, status, seconds: Number.isFinite(result.seconds) ? result.seconds : null,
          baseline_seconds: a.trip_seconds[t], new_path: result.edges});
        const before = routeFeature(Array.from(path(t)), t, 'before', status);
        const after = result.edges && routeFeature(result.edges, t, 'after', status);
        if (before) features.push(before);
        if (after) features.push(after);
      }
    }
  }
  const rerouteEnd = now();
  const budget = message.budget === undefined ? Infinity : message.budget;
  if (!(budget >= 0)) throw new Error('Attribution budget must be nonnegative');
  const compound = weapon === 'meteor' || message.id === 'bay_bridge' || (weapon === 'stomp' && ways.length > 1);
  const causes = compound ? attribution(affected, new Set(ways), budget, counters) :
    [...affected].map(([t]) => ({trip_id: labels[t].trip_id, confirmed_singles: ways.map(w => a.way_osm_id[w]),
      confirmed_runs: [], label: 'single'}));
  return {type: 'edited', weapon, ways_hit: ways.length, way_ids: ways.map(w => a.way_osm_id[w]),
    candidate_trips: candidates.size, affected_trips: affected.size, affected_origins: new Set([...affected.keys()].map(t => a.trip_origin[t])).size,
    rerouted_origins: groups.length, broken, slowed, added_seconds: added,
    searches: counters.reroute + counters.attribution + counters.bound, bound_searches: counters.bound, reroute_searches: counters.reroute,
    attribution_searches: counters.attribution, single_searches: counters.single, run_searches: counters.run, attribution_complete: causes.every(c => c.label !== 'incomplete'),
    attribution: causes, trips: tripResults, geojson: {type: 'FeatureCollection', features},
    timings: {lookup_ms: lookupEnd - start, bound_ms: counters.bound_ms, reroute_ms: rerouteEnd - lookupEnd, attribution_ms: now() - rerouteEnd, total_ms: now() - start}};
}

if (typeof module !== 'undefined') module.exports = {initialize(data) {
  meta = data.meta; a = data.arrays; labels = data.labels; presetResults = data.presets || {}; buildIndices();
}, edit};

if (typeof self !== 'undefined') self.onmessage = async ({data: message}) => {
  try {
    const result = message.type === 'load' ? await load(message) : message.type === 'edit' ? edit(message) :
      (() => { throw new Error(`Unknown message type: ${message.type}`); })();
    self.postMessage({...result, requestId: message.requestId});
  } catch (error) { self.postMessage({type: 'error', requestId: message.requestId, error: error.message, stack: error.stack}); }
};
