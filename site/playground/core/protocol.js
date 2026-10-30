/** Pure request protocol over an already decoded export. */
import {createEngine} from './engine.js';
import {createPicker} from './pick.js';

export function createProtocol({meta, a, order, presets, loadMs}) {
  const engine = createEngine(meta, a, order, presets);
  const picker = createPicker(meta, a);
  // Visit (way index, display id) twice: count first, then fill without coordinate objects.
  function lines(visit) {
    let count = 0, points = 0;
    visit(w => {
      const size = a.geometry_offsets[w+1] - a.geometry_offsets[w];
      if (size >= 2) { count++; points += size; }
    });
    const coords = new Float32Array(points * 2), offsets = new Uint32Array(count + 1);
    const ids = new Float64Array(count);
    let line = 0, point = 0;
    visit((w, id) => {
      if (a.geometry_offsets[w+1] - a.geometry_offsets[w] < 2) return;
      offsets[line] = point;
      ids[line++] = id;
      for (let p = a.geometry_offsets[w]; p < a.geometry_offsets[w+1]; p++) {
        coords[2*point] = a.geometry_coords[2*p+1] / meta.geometry_scale;
        coords[2*point+1] = a.geometry_coords[2*p] / meta.geometry_scale;
        point++;
      }
    });
    offsets[line] = point;
    return {coords, offsets, ids};
  }
  function pathLines(rows, edges) {
    return lines(emit => {
      for (const row of rows) {
        const seen = new Set();
        for (const edge of edges(row)) {
          const w = a.edge_way[edge];
          if (!seen.has(w)) { seen.add(w); emit(w, row.trip); }
        }
      }
    });
  }
  function baseline() {
    const used = new Uint8Array(meta.counts.ways);
    for (let trip = 0; trip < meta.counts.trips; trip++)
      for (let p = a.trip_path_offsets[trip]; p < a.trip_path_offsets[trip+1]; p++)
        used[a.edge_way[a.trip_path_edges[p]]] = 1;
    let lines = 0, points = 0;
    for (let w = 0; w < used.length; w++) {
      const count = a.geometry_offsets[w+1] - a.geometry_offsets[w];
      if (used[w] && count >= 2) { lines++; points += count; }
    }
    const coords = new Float32Array(points * 2), offsets = new Uint32Array(lines + 1);
    let line = 0, point = 0;
    for (let w = 0; w < used.length; w++) {
      if (!used[w] || a.geometry_offsets[w+1] - a.geometry_offsets[w] < 2) continue;
      offsets[line++] = point;
      for (let p = a.geometry_offsets[w]; p < a.geometry_offsets[w+1]; p++) {
        coords[2*point] = a.geometry_coords[2*p+1] / meta.geometry_scale;
        coords[2*point+1] = a.geometry_coords[2*p] / meta.geometry_scale;
        point++;
      }
    }
    offsets[line] = point;
    return {coords, offsets};
  }

  function edit(test, debug) {
    const result = engine.edit(test);
    let hits;
    if (test.preset) {
      const definition = meta.presets?.[test.preset] || presets[test.preset];
      const ids = definition.ids || definition.way_ids || (definition.way_id !== undefined ? [definition.way_id] : []);
      hits = ids.map(id => a.way_osm_id.indexOf(id)).filter(w => w >= 0);
    } else if (test.weapon === 'meteor') hits = picker.waysWithin(test.lat, test.lon, test.radius_m);
    else hits = (test.way_ids || [test.way_id]).map(id => a.way_osm_id.indexOf(id));
    result.ways = hits.map(w => ({way_id: a.way_osm_id[w], name: a.way_names.get(w) || null}));
    result.display = {
      before: pathLines(result.rows.slice(0, 25), row =>
        a.trip_path_edges.subarray(a.trip_path_offsets[row.trip], a.trip_path_offsets[row.trip+1])),
      after: pathLines(result.drawn || [], row => row.edges),
      hit: lines(emit => { for (const w of hits) emit(w, a.way_osm_id[w]); }),
    };
    if (debug === true) result.debug = {drawn: (result.drawn || []).map(({trip, edges}) => ({trip, edges: Array.from(edges)}))};
    delete result.drawn;
    // Display fields sit beside the engine's row; `label` stays the attribution label.
    result.rows = result.rows.map(row => {
      // Engine runs are way sets; restore baseline path order for their display names and link.
      const pathOrder = new Map();
      for (let p = a.trip_path_offsets[row.trip]; row.confirmed_runs.length && p < a.trip_path_offsets[row.trip+1]; p++) {
        const id = a.way_osm_id[a.edge_way[a.trip_path_edges[p]]];
        if (!pathOrder.has(id)) pathOrder.set(id, p);
      }
      return {...row, confirmed_runs: row.confirmed_runs.map(run => [...run]
        .sort((x, y) => pathOrder.get(x) - pathOrder.get(y))),
      trip_label: a.trip_labels.get(row.trip), trip_ms: a.trip_ms[row.trip]};
    });
    return result;
  }
  function handle(message) {
    const id = message?.id;
    try {
      let result;
      switch (message.type) {
        case 'load': result = {meta, presets: Object.keys(presets).map(name => ({name, label: meta.presets?.[name]?.label ?? name})),
          load_ms: loadMs, baseline: baseline()}; break;
        case 'pick': {
          const picked = picker.nearestWay(message.lat, message.lon, message.max_m);
          result = picked ? {way_id: a.way_osm_id[picked.way], name: a.way_names.get(picked.way) || null,
            oneway: Boolean(a.way_oneway[picked.way])} : null;
          break;
        }
        case 'edit': result = edit(message.edit, message.debug); break;
        case 'reset': result = engine.edit({weapon: 'reset'}); break;
        default: throw new Error(`Unknown message type ${message.type}`);
      }
      return {id, ok: true, result};
    } catch (error) { return {id, ok: false, error: String(error)}; }
  }
  return {handle, stats: engine.stats};
}
