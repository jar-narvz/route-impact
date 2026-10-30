import assert from 'node:assert/strict';
import {test} from 'node:test';
import {load} from '../load.mjs';
import {createPicker} from '../pick.js';

const fixture = load(new URL('../../../../tests/fixtures/playground/meteor_ring/', import.meta.url));
const meta = {counts: {ways: 3}, earth_radius_m: 6371008.8, geometry_scale: 1};
const k = meta.earth_radius_m * Math.PI / 180;
const tiny = {geometry_offsets: [0, 2, 4, 5],
  geometry_coords: [-10/k, -10/k, -10/k, 10/k, 10/k, -10/k, 10/k, 10/k, 0, 0]};

test('on a shipped segment, including way 904 with more than two points', () => {
  const {meta, a} = fixture, picker = createPicker(meta, a);
  for (const id of [901, 902, 903, 904]) {
    const way = a.way_osm_id.indexOf(id), p = a.geometry_offsets[way];
    assert.deepEqual(picker.nearestWay(a.geometry_coords[2*p]/meta.geometry_scale,
      a.geometry_coords[2*p+1]/meta.geometry_scale, 0), {way, distance_m: 0});
  }
});

test('inclusive tolerance, just outside, equal-distance tie, and a one-point way', () => {
  const picker = createPicker(meta, tiny);
  assert.deepEqual(picker.nearestWay(0, 0, 10), {way: 0, distance_m: 10});
  const only = createPicker({...meta, counts: {ways: 1}}, {geometry_offsets: [0, 2],
    geometry_coords: [0, -10/k, 0, 10/k]});
  const lat = 10 / k;
  const tolerance = lat * k;
  assert.deepEqual(only.nearestWay(lat, 0, tolerance), {way: 0, distance_m: tolerance});
  assert.equal(only.nearestWay((tolerance + 1e-6) / k, 0, tolerance), null);
  assert.equal(picker.nearestWay(0, 0, 0), null, 'one-point way at query is excluded');
  const degenerate = createPicker({...meta, counts: {ways: 1}}, {
    geometry_offsets: [0, 2], geometry_coords: [0, 0, 0, 0]});
  assert.deepEqual(degenerate.nearestWay(0, 0, 0), {way: 0, distance_m: 0});
});

function brute(meta, a, lat, lon, maxMetres) {
  const k = meta.earth_radius_m * Math.PI / 180, kx = k * Math.cos(lat * Math.PI / 180);
  let best = null;
  for (let way = 0; way < meta.counts.ways; way++) {
    for (let p = a.geometry_offsets[way] + 1; p < a.geometry_offsets[way+1]; p++) {
      const ax = (a.geometry_coords[2*(p-1)+1]/meta.geometry_scale-lon)*kx;
      const ay = (a.geometry_coords[2*(p-1)]/meta.geometry_scale-lat)*k;
      const bx = (a.geometry_coords[2*p+1]/meta.geometry_scale-lon)*kx;
      const by = (a.geometry_coords[2*p]/meta.geometry_scale-lat)*k;
      const dx = bx-ax, dy = by-ay, length2 = dx*dx+dy*dy;
      const t = Math.min(Math.max(length2 > 0 ? -(ax*dx+ay*dy)/length2 : 0, 0), 1);
      const cx = ax+t*dx, cy = ay+t*dy, distance_m = Math.sqrt(cx*cx+cy*cy);
      if (distance_m <= maxMetres && (!best || distance_m < best.distance_m ||
          distance_m === best.distance_m && way < best.way)) best = {way, distance_m};
    }
  }
  return best;
}

test('grid equals a brute scan on 200 seeded random queries (LCG seed 2027)', () => {
  let seed = 2027;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 2**32; };
  const {meta, a} = fixture, picker = createPicker(meta, a);
  let picked = 0, missed = 0;
  for (let i = 0; i < 200; i++) {
    const lat = 37.795 + random()*0.012, lon = -122.28 + random()*0.02, max = random()*500;
    const expected = brute(meta, a, lat, lon, max), actual = picker.nearestWay(lat, lon, max);
    if (!expected) { assert.equal(actual, null); missed++; }
    else {
      assert.equal(actual.way, expected.way);
      assert.ok(Math.abs(actual.distance_m-expected.distance_m) <= 1e-9);
      picked++;
    }
  }
  assert.ok(picked > 0 && missed > 0);
});
