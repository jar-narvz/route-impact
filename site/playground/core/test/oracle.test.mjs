import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import {load} from '../load.mjs';
import {createEngine} from '../engine.js';
import {canonical, createProcedure} from '../procedure.js';

const root = new URL('../../../../tests/fixtures/playground/', import.meta.url);
const cases = readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
assert.ok(cases.length >= 12, 'at least 12 committed oracle fixtures');
for (const name of cases) test(`oracle: ${name}`, () => {
  const dir = new URL(`${name}/`, root), {meta, a, order, presets} = load(dir);
  const edit = JSON.parse(readFileSync(new URL('case.json', dir)));
  const expected = JSON.parse(readFileSync(new URL('expected.json', dir)));
  assert.deepStrictEqual(canonical(createEngine(meta, a, order, presets).edit(edit)), expected);
});

test('Stomp and Flip reject duplicate way ids and name every duplicate', () => {
  const {meta, a, order, presets} = load(new URL('meteor_ring/', root));
  const engine = createEngine(meta, a, order, presets);
  for (const weapon of ['stomp', 'flip']) {
    assert.throws(() => engine.edit({weapon, way_ids: [902, 901, 902, 901]}),
      /^Error: Duplicate way ids in the edit: \[901, 902\]$/);
  }
});

test('Meteor includes a segment exactly at r and excludes one at r + 1e-6 m', () => {
  const {meta, a} = load(new URL('meteor_ring/', root));
  const edit = JSON.parse(readFileSync(new URL('case.json', new URL('meteor_ring/', root))));
  const hits = createProcedure(meta, a).hitWays(edit).map(w => a.way_osm_id[w]);
  assert.deepStrictEqual(hits, [901, 902, 904]);
});

test('canonical sorts run tuples numerically, including shorter prefixes', () => {
  const row = {trip: 0, candidates: [10, 2], confirmed_singles: [10, 2],
    confirmed_runs: [[10, 30], [10], [2, 20], [2, 10]], tested_candidates: [10, 2], unchecked_candidates: []};
  const result = canonical({rows: [row]});
  assert.deepStrictEqual(result.rows[0].confirmed_runs, [[2, 10], [2, 20], [10], [10, 30]]);
  assert.deepStrictEqual(result.rows[0].candidates, [2, 10]);
});
