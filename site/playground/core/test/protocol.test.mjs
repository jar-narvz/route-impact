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
function assertLines(lines, expected, meta, a) {
  assert.ok(lines.coords instanceof Float32Array);
  assert.ok(lines.offsets instanceof Uint32Array);
  assert.ok(lines.ids instanceof Float64Array);
  assert.equal(lines.offsets.length, lines.ids.length + 1);
  assert.equal(lines.offsets[0], 0);
  assert.equal(lines.offsets.at(-1), lines.coords.length / 2);
  assert.deepEqual([...lines.ids], expected.map(({id}) => id));
  expected.forEach(({way}, line) => {
    assert.ok(lines.offsets[line+1] >= lines.offsets[line]);
    const coords = [];
    for (let p = a.geometry_offsets[way]; p < a.geometry_offsets[way+1]; p++)
      coords.push(a.geometry_coords[2*p+1]/meta.geometry_scale, a.geometry_coords[2*p]/meta.geometry_scale);
    assert.deepEqual(lines.coords.slice(2*lines.offsets[line], 2*lines.offsets[line+1]), new Float32Array(coords));
  });
}
function assertDisplay(result, engineResult, hits, meta, a, procedure) {
  const pathLines = (rows, edges) => rows.flatMap(row =>
    [...new Set(Array.from(edges(row), edge => a.edge_way[edge]))]
      .filter(way => a.geometry_offsets[way+1] - a.geometry_offsets[way] >= 2)
      .map(way => ({way, id: row.trip})));
  assertLines(result.display.hit, hits.filter(way => a.geometry_offsets[way+1] - a.geometry_offsets[way] >= 2)
    .map(way => ({way, id: a.way_osm_id[way]})), meta, a);
  assertLines(result.display.before, pathLines(result.rows.slice(0, 25), row => procedure.path(row.trip)), meta, a);
  assertLines(result.display.after, pathLines(engineResult.drawn || [], row => row.edges), meta, a);
  assert.ok([...result.display.after.ids].every(trip => result.rows.some(row => row.trip === trip)));
  assert.equal(result.drawn, undefined);
  assert.equal(result.geojson, undefined);
  assert.equal(result.hit_geojson, undefined);
}
for (const entry of readdirSync(root, {withFileTypes: true}).filter(e => e.isDirectory())) {
  test(`protocol oracle and display: ${entry.name}`, () => {
    const dir = new URL(`${entry.name}/`, root), decoded = load(dir);
    const {meta, a} = decoded, protocol = createProtocol({...decoded, loadMs: 12});
    const reply = protocol.handle({id: 1, type: 'load'});
    assert.equal(reply.ok, true);
    assert.equal(reply.result.load_ms, 12);
    assert.deepEqual(reply.result.meta, meta);
    const procedure = createProcedure(meta, a);
    const used = new Set();
    for (let trip = 0; trip < meta.counts.trips; trip++)
      for (const edge of procedure.path(trip)) used.add(a.edge_way[edge]);
    const ways = [...used].sort((a, b) => a - b)
      .filter(w => a.geometry_offsets[w+1] - a.geometry_offsets[w] >= 2);
    const {coords, offsets} = reply.result.baseline;
    assert.ok(coords instanceof Float32Array);
    assert.ok(offsets instanceof Uint32Array);
    assert.equal(offsets.length, ways.length + 1);
    assert.equal(offsets[0], 0);
    assert.equal(coords.length, 2 * offsets.at(-1));
    ways.forEach((w, line) => {
      const expected = [];
      for (let p = a.geometry_offsets[w]; p < a.geometry_offsets[w+1]; p++)
        expected.push(a.geometry_coords[2*p+1]/meta.geometry_scale, a.geometry_coords[2*p]/meta.geometry_scale);
      assert.equal(offsets[line+1] - offsets[line], expected.length / 2);
      assert.deepEqual(coords.slice(2*offsets[line], 2*offsets[line+1]), new Float32Array(expected));
    });
    const edit = json(new URL('case.json', dir));
    const response = protocol.handle({id: 2, type: 'edit', edit});
    assert.equal(response.ok, true, response.error);
    assert.deepEqual(canonical(routing(response.result)), json(new URL('expected.json', dir)));
    const hits = procedure.hitWays(edit);
    assert.deepEqual(response.result.ways, hits.map(w => ({way_id: a.way_osm_id[w], name: a.way_names.get(w) || null})));
    assertDisplay(response.result, createEngine(meta, a, decoded.order, decoded.presets).edit(edit),
      hits, meta, a, procedure);
    for (const row of response.result.rows) {
      assert.deepEqual(row.trip_label, a.trip_labels.get(row.trip));
      assert.equal(row.trip_ms, a.trip_ms[row.trip]);
      const pathIds = [...new Set(Array.from(procedure.path(row.trip), edge => a.way_osm_id[a.edge_way[edge]]))];
      for (const run of row.confirmed_runs)
        assert.deepEqual(run, pathIds.filter(id => run.includes(id)));
    }
    const p = a.geometry_offsets[0];
    assert.deepEqual(protocol.handle({id: 3, type: 'pick',
      lat: a.geometry_coords[2*p]/meta.geometry_scale, lon: a.geometry_coords[2*p+1]/meta.geometry_scale, max_m: 0}),
    {id: 3, ok: true, result: {way_id: a.way_osm_id[0], name: a.way_names.get(0) || null, oneway: Boolean(a.way_oneway[0])}});
    assert.deepEqual(protocol.handle({id: 30, type: 'pick', lat: 0, lon: 0, max_m: 20}),
      {id: 30, ok: true, result: null});
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
  assertDisplay(reply.result, preset, [0, 1], decoded.meta, decoded.a, createProcedure(decoded.meta, decoded.a));
  assert.equal(preset.rows[0].trip_label, undefined, 'precomputed input is not mutated');
});

test('pick decodes packed empty names and u1 one-way flags', () => {
  for (const flag of [0, 1]) {
    const decoded = load(new URL('meteor_ring/', root));
    decoded.a.way_names = packJsonArray(new TextEncoder().encode('["", null, "Third", "Fourth", "Fifth"]'));
    decoded.a.way_oneway[0] = flag;
    const p = decoded.a.geometry_offsets[0], {meta, a} = decoded;
    assert.deepEqual(createProtocol(decoded).handle({id: 1, type: 'pick',
      lat: a.geometry_coords[2*p]/meta.geometry_scale, lon: a.geometry_coords[2*p+1]/meta.geometry_scale, max_m: 0}),
    {id: 1, ok: true, result: {way_id: 901, name: null, oneway: flag === 1}});
  }
});


test('grid Meteor display hits match the procedure on 200 seeded queries', () => {
  const decoded = load(new URL('meteor_ring/', root));
  const protocol = createProtocol(decoded), procedure = createProcedure(decoded.meta, decoded.a);
  let seed = 2027;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 2**32; };
  for (let i = 0; i < 200; i++) {
    const edit = {weapon: 'meteor', lat: 37.795 + random()*0.012,
      lon: -122.28 + random()*0.02, radius_m: random()*500};
    const reply = protocol.handle({type: 'edit', edit});
    assert.equal(reply.ok, true, reply.error);
    assert.deepEqual(reply.result.ways.map(way => way.way_id),
      procedure.hitWays(edit).map(way => decoded.a.way_osm_id[way]));
    assert.equal(reply.result.ways.length, reply.result.ways_hit);
  }
});
