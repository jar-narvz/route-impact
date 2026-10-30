import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import {load} from '../load.mjs';
import {createEngine} from '../engine.js';
import {createProtocol} from '../protocol.js';
import {canonical} from '../procedure.js';
import {summarize} from '../summary.js';

const root = new URL('../../../../tests/fixtures/playground/', import.meta.url);
const json = url => JSON.parse(readFileSync(url));
function oracle(name) {
  const dir = new URL(`${name}/`, root), decoded = load(dir), edit = json(new URL('case.json', dir));
  const engine = createEngine(decoded.meta, decoded.a, decoded.order, decoded.presets);
  const result = engine.edit(edit);
  assert.deepEqual(canonical(result), json(new URL('expected.json', dir)));
  const display = createProtocol(decoded).handle({type: 'edit', edit});
  assert.equal(display.ok, true, display.error);
  return {summary: summarize(display.result, {meta: decoded.meta, edit}), result: display.result, ...decoded, edit};
}

for (const entry of readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory())) {
  test(`summary preserves all affected oracle rows: ${entry.name}`, () => {
    const {summary, result} = oracle(entry.name);
    assert.equal(summary.trips.length, result.affected_trips);
    assert.deepEqual(summary.trips.map(row => row.trip), result.rows.map(row => row.trip));
    for (const trip of summary.trips) {
      const row = result.rows.find(row => row.trip === trip.trip);
      assert.equal(trip.title, `Trip ${row.trip_label.trip_id} · ${row.trip_label.kind}`);
      assert.equal(trip.status, row.status);
      assert.equal(trip.before_min, (row.trip_ms / 60000).toFixed(1));
      assert.equal(trip.after_min, row.distance_ms === null ? null : (row.distance_ms / 60000).toFixed(1));
    }
  });
}

test('exact miss, unused roads, singular and formatted plural rerouted-none messages', () => {
  const result = {ways_hit: 0, candidate_trips: 0, affected_trips: 0, rows: []};
  const meta = {counts: {trips: 2057}};
  assert.deepEqual(summarize(result, {meta, edit: {weapon: 'meteor'}}), {
    message: 'Missed — no roads here', announcement: 'Missed — no roads here', trips: []});
  result.ways_hit = 2;
  assert.deepEqual(summarize(result, {meta, edit: {weapon: 'stomp'}}), {
    message: 'No sampled trip used these roads', note: 'Only the sampled trips were tested.',
    announcement: 'No sampled trip used these roads', trips: []});
  for (const [count, text] of [[1, '1 trip rerouted, none slowed by 2 min or more'],
    [2057, '2,057 trips rerouted, none slowed by 2 min or more']]) {
    result.candidate_trips = count;
    assert.deepEqual(summarize(result, {meta, edit: {weapon: 'meteor'}}), {
      message: text, note: 'Only the sampled trips were tested.', announcement: text, trips: []});
  }
});

test('single Stomp exact numbers, cause and trip durations', () => {
  assert.deepEqual(oracle('stomp').summary, {
    headline: 'Stomp hit 1 road',
    numbers: {broken: 0, slowed: 2, added_minutes: 4, sample: 'of 4 sampled trips'},
    mattered: {kind: 'one-road', way: {way_id: 102, name: 'Way 102'}, text: 'This road is the cause.'},
    announcement: 'Stomp hit 1 road: 0 trips broken, 2 slowed by 2 min or more, 4 added minutes of 4 sampled trips.',
    trips: [{trip: 0, title: 'Trip 0 · local', status: 'slowed', before_min: '0.3', after_min: '2.5'},
      {trip: 1, title: 'Trip 1 · local', status: 'slowed', before_min: '0.2', after_min: '2.3'}],
  });
});

test('Meteor run, broken singles, and several-together wording', () => {
  const run = oracle('meteor_run').summary;
  assert.equal(run.headline, 'Meteor hit 3 roads');
  assert.deepEqual(run.mattered, {kind: 'attribution', singles: [], runs: [{ways: [
    {way_id: 501, name: 'Way 501'}, {way_id: 502, name: 'Way 502'}], name: 'Way 501 + Way 502 (2 ways)', trips: 2, trip_text: '2 trips'}], several_together: 0});
  assert.equal(run.announcement, 'Meteor hit 3 roads: 0 trips broken, 2 slowed by 2 min or more, 10 added minutes of 3 sampled trips.');
  const broken = oracle('meteor_ring').summary;
  assert.deepEqual(broken.numbers, {broken: 3, slowed: 0, added_minutes: 0, sample: 'of 5 sampled trips'});
  assert.deepEqual(broken.mattered, {kind: 'attribution', singles: [901, 902, 904].map(way_id => ({way_id, name: `Way ${way_id}`, trips: 1, trip_text: '1 trip'})),
    runs: [], several_together: 0});
  assert.deepEqual(broken.trips.map(row => row.after_min), [null, null, null]);
  assert.equal(broken.announcement, 'Meteor hit 3 roads: 3 trips broken, 0 slowed by 2 min or more, 0 added minutes of 5 sampled trips.');
  const several = oracle('several_together').summary;
  assert.deepEqual(several.mattered, {kind: 'attribution', singles: [{way_id: 601, name: 'Way 601', trips: 1, trip_text: '1 trip'}], runs: [], several_together: 1});
  assert.equal(several.headline, 'Stomp hit 2 roads');
  assert.equal(several.announcement, 'Stomp hit 2 roads: 0 trips broken, 2 slowed by 2 min or more, 7 added minutes of 2 sampled trips.');
});

test('distinct run way-sets count rows once; singles sort by frequency then OSM id; missing names', () => {
  const {result, meta} = oracle('meteor_run');
  result.rows[0].confirmed_singles = [503, 501, 501];
  result.rows[1].confirmed_singles = [502, 503];
  result.rows[0].confirmed_runs = [[502, 501], [501, 502]];
  result.rows[1].confirmed_runs = [[501, 502]];
  result.ways = [{way_id: 501, name: ''}, {way_id: 503, name: 'Third'}];
  const summary = summarize(result, {meta, edit: {weapon: 'meteor'}});
  assert.deepEqual(summary.mattered, {kind: 'attribution', singles: [
    {way_id: 503, name: 'Third', trips: 2, trip_text: '2 trips'}, {way_id: 501, name: null, trips: 1, trip_text: '1 trip'}, {way_id: 502, name: null, trips: 1, trip_text: '1 trip'}],
  runs: [{ways: [{way_id: 502, name: null}, {way_id: 501, name: null}], name: 'unnamed road (2 ways)', trips: 2, trip_text: '2 trips'}], several_together: 0});
});

test('one-hit Meteor and Flip use one-road cause; trip labels use actual id and kind', () => {
  const {result, meta} = oracle('stomp');
  result.rows[0].trip_label = {trip_id: 'ic-00001', kind: 'intercity'};
  for (const weapon of ['meteor', 'flip']) {
    const summary = summarize(result, {meta, edit: {weapon}});
    assert.equal(summary.headline, `${weapon === 'meteor' ? 'Meteor' : 'Flip'} hit 1 road`);
    assert.equal(summary.mattered.text, 'This road is the cause.');
    assert.equal(summary.trips[0].title, 'Trip ic-00001 · intercity');
  }
});

test('real precomputed Bay Bridge: compound attribution and honest sample totals', () => {
  const {meta, a, presets} = load(new URL('../../data/', import.meta.url));
  // Add precisely the protocol display fields, without building a full-size routing engine in tests.
  const result = structuredClone(presets.bay_bridge);
  result.precomputed = true;
  result.ways = meta.presets.bay_bridge.ids.map(way_id => ({way_id, name: a.way_names.get(a.way_osm_id.indexOf(way_id)) || null}));
  result.rows = result.rows.map(row => ({...row, trip_label: a.trip_labels.get(row.trip), trip_ms: a.trip_ms[row.trip]}));
  const summary = summarize(result, {meta, edit: {preset: 'bay_bridge', label: 'Bay Bridge'}});
  assert.equal(summary.headline, 'Bay Bridge hit 10 roads');
  assert.equal(result.affected_trips, 171);
  assert.deepEqual(summary.numbers, {broken: 2, slowed: 169, added_minutes: 2859, sample: 'of 2,057 sampled trips'});
  assert.equal(summary.precomputed, true);
  assert.equal(summary.mattered.kind, 'attribution');
  assert.equal(summary.mattered.several_together, 170);
  assert.deepEqual(summary.mattered.runs, []);
  assert.deepEqual(summary.mattered.singles, [{way_id: 661905446, name: result.ways.find(way => way.way_id === 661905446).name, trips: 1, trip_text: '1 trip'}]);
  assert.equal(summary.trips.length, 171);
  assert.equal(summary.announcement, 'Bay Bridge hit 10 roads: 2 trips broken, 169 slowed by 2 min or more, 2,859 added minutes of 2,057 sampled trips.');
});

test('preset meta label, singular broken announcement and minutes rounded only at display', () => {
  const {result, meta} = oracle('stomp');
  result.broken = 1; result.slowed = 1; result.added_ms = 150000;
  Object.assign(result.rows[0], {status: 'broken', distance_ms: null, added_ms: null});
  Object.assign(result.rows[1], {distance_ms: result.rows[1].trip_ms + 150000, added_ms: 150000});
  result.precomputed = true;
  meta.presets = {test: {label: 'Test bridge'}};
  const summary = summarize(result, {meta, edit: {preset: 'test'}});
  assert.equal(summary.headline, 'Test bridge hit 1 road');
  assert.equal(summary.precomputed, true);
  assert.equal(summary.numbers.added_minutes, 3);
  assert.equal(summary.announcement, 'Test bridge hit 1 road: 1 trip broken, 1 slowed by 2 min or more, 3 added minutes of 4 sampled trips.');
});


test('group names are unique in path order, with full ways retained', () => {
  const {result, meta} = oracle('meteor_run');
  result.ways = [{way_id: 501, name: 'Broadway'}, {way_id: 502, name: 'Bonita Street'},
    {way_id: 503, name: 'Polk Street'}, {way_id: 504, name: 'Broadway'}, {way_id: 505, name: null}];
  result.rows[0].confirmed_runs = [[502, 503, 501, 504, 505]];
  result.rows[1].confirmed_runs = [];
  let run = summarize(result, {meta, edit: {weapon: 'meteor'}}).mattered.runs[0];
  assert.equal(run.name, 'Bonita Street + Polk Street + Broadway + unnamed road (5 ways)');
  assert.equal(run.trip_text, '1 trip');
  assert.deepEqual(run.ways.map(way => way.way_id), [502, 503, 501, 504, 505]);
  result.ways = result.ways.map(way => ({...way, name: 'Van Ness Avenue'}));
  run = summarize(result, {meta, edit: {weapon: 'meteor'}}).mattered.runs[0];
  assert.equal(run.name, 'Van Ness Avenue (5 ways)');
});


test('singular sample count', () => {
  const {result, meta, edit} = oracle('stomp');
  meta.counts.trips = 1;
  assert.equal(summarize(result, {meta, edit}).numbers.sample, 'of 1 sampled trip');
});
