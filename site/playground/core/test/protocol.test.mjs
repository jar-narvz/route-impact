import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import {load} from '../load.mjs';
import {createEngine} from '../engine.js';
import {canonical, createProcedure} from '../procedure.js';
import {createProtocol} from '../protocol.js';
import {createLatest} from '../latest.js';
import {packJsonArray} from '../packed.js';

const root = new URL('../../../../tests/fixtures/playground/', import.meta.url);
const json = url => JSON.parse(readFileSync(url));
test('empty and null way names display as unnamed roads', () => {
  const decoded = load(new URL('meteor_ring/', root));
  decoded.a.way_names = packJsonArray(new TextEncoder().encode('["", null, "Third", "Fourth", "Fifth"]'));
  const reply = createProtocol(decoded).handle({id: 1, type: 'edit', edit: {weapon: 'stomp', way_ids: [901, 902]}});
  assert.equal(reply.ok, true, reply.error);
  assert.deepEqual(reply.result.ways, [{way_id: 901, name: null}, {way_id: 902, name: null}]);
});
// Drop the display-only fields for the oracle comparison.
function routing(result) {
  return {...result, rows: result.rows.map(({trip_label, trip_ms, ...row}) => row)};
}
for (const entry of readdirSync(root, {withFileTypes: true}).filter(e => e.isDirectory())) {
  test(`protocol oracle and display: ${entry.name}`, () => {
    const dir = new URL(`${entry.name}/`, root), decoded = load(dir);
    const {meta, a} = decoded, protocol = createProtocol({...decoded, loadMs: 12});
    const reply = protocol.handle({id: 1, type: 'load'});
    assert.equal(reply.ok, true);
    assert.equal(reply.result.load_ms, 12);
    assert.deepEqual(reply.result.meta, meta);
    assert.equal(reply.result.baseline.features.length, meta.counts.trips);
    const procedure = createProcedure(meta, a);
    reply.result.baseline.features.forEach((feature, trip) => {
      assert.deepEqual(feature.properties, {trip});
      assert.equal(feature.geometry.type, 'MultiLineString');
      const ways = [...new Set(Array.from(procedure.path(trip), e => a.edge_way[e]))];
      const lines = ways.map(w => Array.from({length: a.geometry_offsets[w+1] - a.geometry_offsets[w]}, (_, i) => {
        const p = a.geometry_offsets[w] + i;
        return [a.geometry_coords[2*p+1]/meta.geometry_scale, a.geometry_coords[2*p]/meta.geometry_scale];
      })).filter(line => line.length >= 2);
      assert.deepEqual(feature.geometry.coordinates, lines);
    });
    const edit = json(new URL('case.json', dir));
    const response = protocol.handle({id: 2, type: 'edit', edit});
    assert.equal(response.ok, true, response.error);
    assert.deepEqual(canonical(routing(response.result)), json(new URL('expected.json', dir)));
    const hits = procedure.hitWays(edit);
    assert.deepEqual(response.result.ways, hits.map(w => ({way_id: a.way_osm_id[w], name: a.way_names.get(w) || null})));
    assert.deepEqual(response.result.hit_geojson.features.map(f => f.properties.way_id), hits.map(w => a.way_osm_id[w]));
    for (const row of response.result.rows) {
      assert.deepEqual(row.trip_label, a.trip_labels.get(row.trip));
      assert.equal(row.trip_ms, a.trip_ms[row.trip]);
    }
    assert.deepEqual(protocol.handle({id: 3, type: 'pick', lat: 37, lon: -122, max_m: 50}), {id: 3, ok: true, result: null});
    assert.deepEqual(protocol.handle({id: 4, type: 'reset'}), {id: 4, ok: true, result: {reset: true}});
    assert.equal(protocol.handle({id: 5, type: 'unknown'}).ok, false);
    assert.equal(protocol.handle(null).ok, false);
    assert.match(protocol.handle({id: 6, type: 'edit', edit: {preset: 'unknown'}}).error, /Unknown preset unknown/);
  });
}

test('compound edits, duplicate errors, latest ids and reset recovery', () => {
  const decoded = load(new URL('meteor_ring/', root)), {meta, a, order, presets} = decoded;
  const protocol = createProtocol(decoded), latest = createLatest();
  const edits = [{weapon: 'stomp', way_ids: [901, 902]}, {weapon: 'stomp', way_id: 904}];
  const replies = edits.map(edit => protocol.handle({id: latest.next(), type: 'edit', edit}));
  assert.deepEqual(canonical(routing(replies[0].result)), canonical(createEngine(meta, a, order, presets).edit(edits[0])));
  replies.push(protocol.handle({id: latest.next(), type: 'reset'}));
  assert.deepEqual(replies.map(reply => latest.isLatest(reply.id)), [false, false, true]);
  assert.deepEqual(replies[2].result, {reset: true});
  const fresh = protocol.handle({id: latest.next(), type: 'edit', edit: edits[0]});
  assert.deepEqual(canonical(routing(fresh.result)), canonical(createEngine(meta, a, order, presets).edit(edits[0])));
  for (const weapon of ['stomp', 'flip']) assert.deepEqual(protocol.handle({id: 10, type: 'edit', edit: {weapon, way_ids: [902, 901, 902, 901]}}),
    {id: 10, ok: false, error: 'Error: Duplicate way ids in the edit: [901, 902]'});
});

test('precomputed presets retain canonical results and derive display from meta', () => {
  const decoded = load(new URL('meteor_ring/', root));
  const edit = {weapon: 'stomp', way_ids: [901, 902]};
  const preset = createEngine(decoded.meta, decoded.a, decoded.order, {}).edit(edit);
  decoded.presets = {bridge: preset};
  decoded.meta.presets = {bridge: {ids: [901, 902, -1], label: 'Bridge'}};
  const protocol = createProtocol({...decoded, loadMs: 1});
  assert.deepEqual(protocol.handle({id: 1, type: 'load'}).result.presets, [{name: 'bridge', label: 'Bridge'}]);
  const reply = protocol.handle({id: 2, type: 'edit', edit: {preset: 'bridge'}});
  assert.equal(reply.ok, true, reply.error);
  assert.equal(reply.result.precomputed, true);
  assert.deepEqual(canonical(routing(reply.result)), canonical(preset));
  assert.deepEqual(reply.result.ways.map(w => w.way_id), [901, 902]);
  assert.equal(preset.rows[0].trip_label, undefined, 'precomputed input is not mutated');
});
