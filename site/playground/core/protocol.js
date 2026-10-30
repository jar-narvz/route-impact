/** Pure request protocol over an already decoded export. */
import {createEngine} from './engine.js';
import {createProcedure} from './procedure.js';

export function createProtocol({meta, a, order, presets, loadMs}) {
  const engine = createEngine(meta, a, order, presets);
  const procedure = createProcedure(meta, a);
  const collection = features => ({type: 'FeatureCollection', features});
  function line(w) {
    const coordinates = [];
    for (let p = a.geometry_offsets[w]; p < a.geometry_offsets[w + 1]; p++)
      coordinates.push([a.geometry_coords[2*p+1] / meta.geometry_scale, a.geometry_coords[2*p] / meta.geometry_scale]);
    return coordinates;
  }
  function baseline() {
    return collection(Array.from(a.trip_origin, (_, trip) => ({type: 'Feature', properties: {trip},
      geometry: {type: 'MultiLineString', coordinates: [...new Set(Array.from(procedure.path(trip), e => a.edge_way[e]))]
        .map(line).filter(points => points.length >= 2)}})));
  }
  function edit(test) {
    const result = engine.edit(test);
    let hits;
    if (test.preset) {
      const definition = meta.presets?.[test.preset] || presets[test.preset];
      const ids = definition.ids || definition.way_ids || (definition.way_id !== undefined ? [definition.way_id] : []);
      hits = ids.map(id => a.way_osm_id.indexOf(id)).filter(w => w >= 0);
    } else hits = procedure.hitWays(test);
    result.ways = hits.map(w => ({way_id: a.way_osm_id[w], name: a.way_names.get(w) || null}));
    result.hit_geojson = collection(hits.map(w => ({type: 'Feature', properties: {way_id: a.way_osm_id[w]},
      geometry: {type: 'LineString', coordinates: line(w)}})));
    // Display fields sit beside the engine's row; `label` stays the attribution label.
    result.rows = result.rows.map(row => ({...row, trip_label: a.trip_labels.get(row.trip), trip_ms: a.trip_ms[row.trip]}));
    return result;
  }
  function handle(message) {
    const id = message?.id;
    try {
      let result;
      switch (message.type) {
        case 'load': result = {meta, presets: Object.keys(presets).map(name => ({name, label: meta.presets?.[name]?.label ?? name})),
          load_ms: loadMs, baseline: baseline()}; break;
        // P2c replaces this stub with core/pick.js.
        case 'pick': result = null; break;
        case 'edit': result = edit(message.edit); break;
        case 'reset': result = engine.edit({weapon: 'reset'}); break;
        default: throw new Error(`Unknown message type ${message.type}`);
      }
      return {id, ok: true, result};
    } catch (error) { return {id, ok: false, error: String(error)}; }
  }
  return {handle};
}
