import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import {load} from '../load.mjs';
import {createEngine} from '../engine.js';
import {createProtocol} from '../protocol.js';
import {canonical} from '../procedure.js';
import {summarize, groupName, rankRoads} from '../summary.js';

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
      assert.equal(trip.title, row.trip_label.kind === 'intercity' ? 'Intercity trip' : 'Local trip');
      assert.equal(trip.id_text, row.trip_label.trip_id);
      assert.equal(trip.status, row.status);
      assert.equal(trip.before_min, (row.trip_ms / 60000).toFixed(1));
      assert.equal(trip.after_min, row.distance_ms === null ? null : (row.distance_ms / 60000).toFixed(1));
    }
  });
}


test('exact no-damage copy for named, unnamed, multi-road and missed edits', () => {
  const result = {ways_hit: 1, ways: [{way_id: 123, name: 'University Avenue'}], candidate_trips: 0, affected_trips: 0, rows: []};
  for (const weapon of ['stomp','flip']) {
    for (const name of ['University Avenue', null, '']) {
      result.ways[0].name = name;
      for (const count of [0,1,2057]) {
        result.candidate_trips = count;
        const road = name || 'an unnamed road'; // R2: "Flip reversed an unnamed road."
        let message = count ? `${count.toLocaleString('en-US')} ${count === 1 ? 'trip' : 'trips'} ${weapon === 'flip' ? `changed route after ${road} was reversed` : `rerouted around ${road}`}. None lost 2 min or more.` : `No sampled trip used ${road}`;
        if (weapon === 'flip') message = `Flip reversed ${road}.`;
        assert.deepEqual(summarize(result, {meta: {}, edit: {weapon}}), {
          message, rerouted_label: 'Rerouted', announcement: message, note: 'Only the sampled trips were tested.', trips: []});
      }
    }
  }
  result.ways_hit = 2; result.candidate_trips = 2;
  assert.equal(summarize(result, {meta: {}, edit: {weapon: 'meteor'}}).message, '2 trips rerouted. None lost 2 min or more.');
  result.ways_hit = 0;
  assert.deepEqual(summarize(result, {meta: {}, edit: {weapon: 'meteor'}}), {
    message: 'No roads inside the circle.', rerouted_label: 'Rerouted', announcement: 'No roads inside the circle.', trips: []});
});

test('group naming frequency, lowest road id tie, and unnamed roads', () => {
  const ways = [{way_id: 9,name:'Third'}, {way_id: 3,name:'Broadway'}, {way_id: 7,name:'Third'}];
  assert.equal(groupName(ways), 'Third');
  assert.equal(groupName(ways.slice(0,2)), 'Broadway');
  assert.equal(groupName(ways.map(way => ({...way,name:null}))), 'Unnamed road');
  assert.equal(groupName([{way_id:1,name:'A very long road name'}]), 'A very long road name');
});

test('ranking merges matching headlines with distinct trips and distinct road counts', () => {
  const result = {ways: [{way_id:1,name:'First'}, {way_id:2,name:'Second'}, {way_id:3,name:'Third'}], rows: [
    {trip:10, confirmed_singles:[3,3,2], confirmed_runs:[[2,1],[1,2]]},
    {trip:10, confirmed_singles:[3], confirmed_runs:[[1,2]]},
    {trip:20, confirmed_singles:[3,1], confirmed_runs:[[2,1]]},
  ]};
  assert.deepEqual(rankRoads(result), {count:3, rows:[
    {ways:[{way_id:1,name:'First'},{way_id:2,name:'Second'}],name:'First',secondary:'',trips:2,caption:'1 road · 2 trips',share:1},
    {ways:[{way_id:3,name:'Third'}],name:'Third',secondary:'',trips:2,caption:'1 road · 2 trips',share:1},
    {ways:[{way_id:2,name:'Second'}],name:'Second',secondary:'',trips:1,caption:'1 road · 1 trip',share:0.5},
  ]});
});

test('exact result numbers and mattered count come from confirmed roads', () => {
  const stomp = oracle('stomp').summary;
  assert.deepEqual(stomp.numbers, {broken:0,slowed:2,added_minutes:4,sample:'of 4 sampled trips'});
  assert.equal(stomp.detail, 'Stomp hit 1 road.');
  assert.deepEqual(stomp.mattered, {rows:[{ways:[{way_id:102,name:'Unnamed road'}],name:'Unnamed road',secondary:'',trips:2,caption:'1 road · 2 trips',share:1}],count:1,more_text:'Show all 1 groups',several_together:0});
  assert.equal(stomp.announcement, 'Stomp hit 1 road: 0 trips broken, 2 slowed by 2 min or more, 4 added minutes of 4 sampled trips.');
  const run = oracle('meteor_run').summary;
  assert.equal(run.detail, 'Meteor hit 3 roads.');
  assert.equal(run.mattered.rows[0].name, 'Unnamed road');
  const several = oracle('several_together').summary;
  assert.equal(several.mattered.several_together, 1);
  assert.equal(several.mattered.count, 1);
});

test('all oracle summary strings meet copy rules; trips and result metrics stay exact', () => {
  const visit = value => {
    if (typeof value === 'string') assert.doesNotMatch(value, /—|\b(successfully|just|simply|please)\b|!/i);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const entry of readdirSync(root, {withFileTypes:true}).filter(entry => entry.isDirectory())) {
    const {summary,result} = oracle(entry.name);
    visit(summary);
    if (summary.numbers) {
      assert.equal(summary.numbers.broken,result.broken);
      assert.equal(summary.numbers.slowed,result.slowed);
      assert.equal(summary.numbers.added_minutes,Math.round(result.added_ms/60000));
    }
  }
});

test('trip copy separates kind, id, status and exact durations', () => {
  const rows = [
    {trip: 3, trip_label: {trip_id: 'ic-00003', kind: 'intercity'}, status: 'slowed', trip_ms: 1032000, distance_ms: 2406000},
    {trip: 4, trip_label: {trip_id: 'lo-00004', kind: 'local'}, status: 'broken', trip_ms: 744000, distance_ms: null},
  ];
  const result = {rows, ways_hit: 0, candidate_trips: 0};
  assert.deepEqual(summarize(result, {meta: {}, edit: {weapon: 'meteor'}}).trips, [
    {trip: 3, title: 'Intercity trip', id_text: 'ic-00003', status: 'slowed', before_min: '17.2', after_min: '40.1', duration_text: '17.2 → 40.1 min'},
    {trip: 4, title: 'Local trip', id_text: 'lo-00004', status: 'broken', before_min: '12.4', after_min: null, duration_text: '12.4 min → no route'},
  ]);
});


test('R1 a merged row counts each road once; row road counts never exceed the roads hit', () => {
  const ways = [1,2,3,4,5].map(way_id => ({way_id, name: way_id < 4 ? 'Highway' : null}));
  const result = {ways_hit: 5, ways, rows: [
    {trip:1, confirmed_runs:[[1,2,3]]}, {trip:2, confirmed_runs:[[1,2,4]]}, {trip:3, confirmed_runs:[[2,3]]},
    {trip:4, confirmed_runs:[[4,5,1]]}, {trip:5, confirmed_singles:[3]},
  ]};
  const {rows} = rankRoads(result);
  assert.deepEqual(rows.map(row => [row.name,row.caption]), [['Highway','3 roads · 4 trips'],['Unnamed road','2 roads · 1 trip']]);
  const sum = rows.reduce((n,row) => n+Number(row.caption.split(' ')[0]),0);
  assert.ok(sum <= result.ways_hit, `${sum} > ${result.ways_hit}`);
  const flip = summarize({ways_hit:1, ways:[{way_id:9,name:null}], candidate_trips:3, affected_trips:0, rows:[]}, {meta:{}, edit:{weapon:'flip'}});
  assert.equal(flip.message, 'Flip reversed an unnamed road.');
});

test('D1 joint causes rank alongside merged road headlines', () => {
  const result = {ways:[{way_id:1,name:'Highway'},{way_id:2,name:'Ramp'},{way_id:3,name:'Highway'}], rows:[
    {trip:1,label:'several_together',confirmed_singles:[1]},
    {trip:2,label:'several_together'}, {trip:2,label:'several_together'},
    {trip:3,confirmed_runs:[[1,2]]}, {trip:4,confirmed_singles:[3]},
  ]};
  const ranked = rankRoads(result);
  assert.deepEqual(ranked.rows.map(row => [row.name,row.secondary,row.trips,row.share]), [
    ['Highway','',3,1], ['Several roads together','',2,2/3],
  ]);
  assert.equal(ranked.rows[0].caption, '3 roads · 3 trips');
  assert.deepEqual(ranked.rows[0].ways, result.ways);
  assert.equal(ranked.rows[1].caption, '2 trips'); // all three roads are already counted above
});

test('D6 and D7 result labels and group expansion explain the numbers', () => {
  const summary = oracle('stomp').summary;
  assert.deepEqual(summary.labels, {broken:'Broken',slowed:'Slowed',added_minutes:'Added min'});
  assert.equal(summary.mattered.more_text, 'Show all 1 groups');
  assert.equal(summary.detail, 'Stomp hit 1 road.');
});


test('D1 OSM ids never become road names; unnamed rows merge with a trip union', () => {
  const ways=[{way_id:123,name:'Road 123'}, {way_id:124,name:'Way 124'}, {way_id:125,name:'125'},
    {way_id:126,name:null}, {way_id:127,name:'OSM way 127',ref:'I-80'}];
  const ranked=rankRoads({ways,rows:[
    {trip:1,confirmed_singles:[123,124]}, {trip:1,confirmed_runs:[[125,126]]},
    {trip:2,confirmed_singles:[124,127]},
  ]});
  assert.deepEqual(ranked.rows.map(({name,secondary,trips,caption,share}) => ({name,secondary,trips,caption,share})),[
    {name:'Unnamed road',secondary:'',trips:2,caption:'4 roads · 2 trips',share:1},
    {name:'I-80',secondary:'',trips:1,caption:'1 road · 1 trip',share:.5},
  ]);
  assert.deepEqual(ranked.rows[0].ways.map(way=>way.way_id),[123,124,125,126]);
});
