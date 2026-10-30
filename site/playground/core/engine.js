/** The single CCH engine used by worker, Node checks and isolated RSS measurement. */
import {buildCCH} from './cch.js';
import {createProcedure} from './procedure.js';
export function deriveSources(a, n) {
  const tail = new Uint32Array(a.edge_target.length);
  for (let v = 0; v < n; v++) tail.fill(v, a.csr_offsets[v], a.csr_offsets[v + 1]);
  a.edge_source = tail;
}
// Own every outstanding update log so a replacing edit needs no base copy.
export function createEditSession(cch, a, mask, procedure) {
  const logs = [];
  let initialLog;
  function recover() {
    logs.length = 0; initialLog = undefined;
    mask.set(a.edge_initially_active);
    cch.customize(a.edge_ms, mask);
  }
  const adapter = {mask, search: cch.queryMany, unpack: cch.unpack,
    update(changed) {
      const result = cch.update(changed);
      if (!initialLog) initialLog = result.undo;
      logs.push(result.undo);
      return result;
    },
    undo(log) {
      if (!logs.length || logs[logs.length - 1] !== log) throw new Error('Inconsistent edit log stack');
      cch.undo(log); logs.pop();
    }};
  function reset() {
    try { while (logs.length) adapter.undo(logs[logs.length - 1]); }
    catch { recover(); }
    initialLog = undefined;
  }
  function run(test) {
    initialLog = undefined;
    try {
      const result = procedure.run(test, adapter);
      if (logs.length !== 1 || logs[0] !== initialLog) throw new Error('Inconsistent edit log stack after procedure');
      return result;
    } catch (error) { recover(); throw error; }
  }
  return {reset, run};
}
export function createEngine(meta, a, order, presets) {
  deriveSources(a, meta.counts.vertices);
  const cch = buildCCH({n: meta.counts.vertices, order, tail: a.edge_source, head: a.edge_target, precomputeTriangles: false});
  const mask = a.edge_initially_active.slice();
  cch.customize(a.edge_ms, mask);
  const procedure = createProcedure(meta, a);
  const session = createEditSession(cch, a, mask, procedure);
  function edit(test) {
    if (test.weapon === 'reset') { session.reset(); return {reset: true}; }
    const start = performance.now();
    // Each edit replaces the previous edit. Measurements also report an explicit reset.
    session.reset();
    let result;
    if (test.preset) {
      if (!presets[test.preset]) throw new Error(`Unknown preset ${test.preset}`);
      result = structuredClone(presets[test.preset]);
      result.precomputed = true;
    } else result = session.run(test);
    result.geojson = geojson(result);
    result.timings ||= {};
    result.timings.total_ms = performance.now() - start;
    return result;
  }
  function geojson(result) {
    const features = [];
    function feature(edges, trip, phase) {
      // Draw shipped simplified way polylines. Whole ways can extend beyond the routed segment.
      const coordinates = [...new Set(Array.from(edges, e => a.edge_way[e]))].map(w => {
        const line = [];
        for (let p = a.geometry_offsets[w]; p < a.geometry_offsets[w + 1]; p++)
          line.push([a.geometry_coords[2*p+1] / meta.geometry_scale, a.geometry_coords[2*p] / meta.geometry_scale]);
        return line;
      }).filter(line => line.length >= 2);
      if (coordinates.length) features.push({type: 'Feature', properties: {trip, phase}, geometry: {type: 'MultiLineString', coordinates}});
    }
    for (const row of result.rows.slice(0, 25)) feature(procedure.path(row.trip), row.trip, 'before');
    for (const row of result.drawn || []) feature(row.edges, row.trip, 'after');
    return {type: 'FeatureCollection', features};
  }
  return {edit, stats: cch.stats};
}
