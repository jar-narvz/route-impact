import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {buildCCH} from '../cch.js';
import {createEditSession} from '../engine.js';
import {createProcedure} from '../procedure.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/grid6_order.json', import.meta.url)));
function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}
function permutation(seed) {
  const out = Array.from({length: 36}, (_, i) => i), rng = random(seed);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
const orders = [Array.from({length: 36}, (_, i) => i), Array.from({length: 36}, (_, i) => 35 - i),
  ...[17, 2027, 919].map(permutation), fixture.order];
function graph(kind) {
  const tail = [], head = [], weights = [], active = [], twin = [], rng = random(2027);
  const pair = (x, y, extra = false) => {
    const i = tail.length, w = Math.floor(rng() * 5) * 10;
    tail.push(x, y); head.push(y, x); twin.push(i + 1, i);
    weights.push(w, w);
    active.push(1, kind === 'directed' && (i % 4 === 0 || i % 6 === 0) ? 0 : 1);
    if (extra) { tail.push(x); head.push(y); weights.push(w + 7); active.push(1); twin.push(-1); }
  };
  for (const [x, y] of fixture.edges) {
    if (kind === 'unreachable' && (x < 18) !== (y < 18)) continue;
    pair(x, y, kind === 'parallel');
  }
  tail.push(0); head.push(0); weights.push(0); active.push(1); twin.push(-1);
  return {n: 36, tail: Uint32Array.from(tail), head: Uint32Array.from(head), weights: Uint32Array.from(weights), active: Uint8Array.from(active), twin};
}
// Independent O(V²) integer Dijkstra: no CCH helpers, no heap/tie assumptions.
function dijkstra(g, s) {
  const d = Array(g.n).fill(Infinity), done = new Uint8Array(g.n); d[s] = 0;
  for (let i = 0; i < g.n; i++) {
    let v = -1;
    for (let x = 0; x < g.n; x++) if (!done[x] && (v < 0 || d[x] < d[v])) v = x;
    if (v < 0 || !Number.isFinite(d[v])) break;
    done[v] = 1;
    for (let e = 0; e < g.tail.length; e++) if (g.tail[e] === v && g.active[e])
      d[g.head[e]] = Math.min(d[g.head[e]], d[v] + g.weights[e]);
  }
  return d;
}
function verify(cch, g) {
  for (const name of ['up', 'down']) {
    assert.ok(cch[name] instanceof Float64Array);
    for (const value of cch[name]) assert.ok(value === Infinity || Number.isInteger(value));
  }
  const targets = Array.from({length: g.n}, (_, i) => i);
  for (let s = 0; s < g.n; s++) {
    const expected = dijkstra(g, s);
    assert.deepEqual(cch.queryMany(s, targets), expected);
    for (const t of targets) {
      const path = cch.unpack(s, t);
      if (!Number.isFinite(expected[t])) { assert.equal(path, null); continue; }
      let v = s, sum = 0;
      for (const e of path) { assert.equal(g.active[e], 1); assert.equal(g.tail[e], v); v = g.head[e]; sum += g.weights[e]; }
      assert.equal(v, t); assert.equal(sum, expected[t]);
    }
  }
}
const metricNames = ['up', 'down', 'upFirst', 'upSecond', 'downFirst', 'downSecond'];
function metric(cch) { return metricNames.map(k => cch[k].slice()); }
function same(cch, expected) { metricNames.forEach((k, i) => assert.deepEqual(cch[k], expected[i], k)); }
for (const kind of ['grid', 'directed', 'parallel', 'unreachable']) for (const [index, order] of orders.entries()) {
  test(`${kind}, order ${index}: all pairs, 210 transitions, full/partial/undo`, () => {
    const g = graph(kind), initialW = g.weights.slice(), initialA = g.active.slice();
    const cch = buildCCH({...g, order}), fresh = buildCCH({...g, order, precomputeTriangles: false});
    cch.customize(g.weights, g.active); cch.saveBase(); const base = metric(cch);
    verify(cch, g);
    const rng = random(1000 + index), m = g.weights.length;
    for (let step = 0; step < 210; step++) {
      let e = Math.floor(rng() * (m - 1)); const changed = new Set([e]);
      const before = metric(cch), beforeW = g.weights.slice(), beforeA = g.active.slice();
      switch (step < 7 ? step : Math.floor(rng() * 7)) {
        case 0: g.active[e] = 0; break;
        case 1: g.active[e] = 1; break;
        case 2: g.weights[e] = g.weights[e] + 13; break;
        case 3: g.weights[e] = Math.floor(rng() * 4); break;
        case 4:
          if (g.twin[e] >= 0) { g.active[e] = 0; g.active[g.twin[e]] = 1; changed.add(g.twin[e]); }
          break;
        case 5: { // Delete the current direct winner, including parallel ties.
          const a = cch.inputArc[e], dir = cch.inputDir[e];
          let winner = -1;
          for (let j = 0; j < m; j++) if (cch.inputArc[j] === a && cch.inputDir[j] === dir && g.active[j] &&
            (winner < 0 || g.weights[j] < g.weights[winner])) winner = j;
          if (winner >= 0) { g.active[winner] = 0; changed.add(winner); }
          break;
        }
        case 6: g.weights.set(initialW); g.active.set(initialA); for (let j = 0; j < m; j++) changed.add(j); break;
      }
      const intendedWeights = g.weights.slice(), intendedActive = g.active.slice();
      const update = cch.update(changed);
      fresh.customize(g.weights.slice(), g.active.slice()); same(cch, metric(fresh));
      verify(cch, g); // Every transition, all pairs, including witness validity.
      cch.undo(update.undo); same(cch, before);
      assert.deepEqual(g.weights, beforeW); assert.deepEqual(g.active, beforeA);
      assert.throws(() => cch.undo(update.undo), /single-use/);
      // Reapply without relying on the undo log's contents.
      g.weights.set(intendedWeights); g.active.set(intendedActive);
      cch.update(changed);
    }
    cch.restoreBase(); same(cch, base); assert.deepEqual(g.weights, initialW); assert.deepEqual(g.active, initialA); verify(cch, g);
  });
}

test('Float64 integer metrics, full Uint32 input range, invalid inputs', () => {
  const topology = {n: 3, order: [0, 1, 2], tail: [0, 1], head: [1, 2]};
  const c = buildCCH(topology), weights = Uint32Array.of(0xffffffff, 0xffffffff), active = Uint8Array.of(1, 1);
  c.customize(weights, active);
  assert.equal(c.query(0, 2), 8589934590); assert.deepEqual(c.unpack(0, 2), [0, 1]);
  assert.equal(c.query(2, 0), Infinity);
  active[0] = 0; c.update([0]); assert.equal(c.query(0, 2), Infinity);
  active[0] = 1; c.update([0]); verify(c, {...topology, weights, active});
  assert.throws(() => buildCCH({...topology, order: [0, 0, 2]}), /permutation/);
  assert.throws(() => buildCCH({...topology, head: [1, 3]}), /endpoint/);
  for (const order of [[0, 1, 2.5], [0, 1, -1], [0, 1, 2 ** 32 + 2]])
    assert.throws(() => buildCCH({...topology, order}), /permutation/);
});

test('zero cycles, direct/triangle ties, parallel winner witness propagation', () => {
  const g = {n: 3, order: [0, 1, 2], tail: [1, 1, 1, 0, 0, 2], head: [2, 2, 0, 1, 2, 0]};
  const c = buildCCH(g), w = Uint32Array.of(0, 0, 0, 0, 0, 0), a = Uint8Array.of(1, 1, 1, 1, 1, 1);
  c.customize(w, a); c.saveBase(); assert.deepEqual(c.unpack(1, 2), [0]);
  a[0] = 0; const log = c.update([0]); assert.deepEqual(c.unpack(1, 2), [1]);
  a[1] = 0; c.update([1]); assert.deepEqual(c.unpack(1, 2), [2, 4]);
  c.restoreBase(); assert.deepEqual(c.unpack(1, 2), [0]); assert.throws(() => c.undo(log.undo), /LIFO/);
  verify(c, {...g, weights: w, active: a});
});

// Self-loops keep the topology tiny while genuine Uint32 inputs reach 2^53.
test('MAX_SAFE_INTEGER active sum bound at customize and update', () => {
  const count = 2097153, weights = new Uint32Array(count).fill(0xffffffff);
  const active = new Uint8Array(count).fill(1), endpoints = new Uint32Array(count);
  const c = buildCCH({n: 1, order: [0], tail: endpoints, head: endpoints});
  assert.throws(() => c.customize(weights, active), /MAX_SAFE_INTEGER/);
  weights[count - 1] = 2097151; // Exact sum = Number.MAX_SAFE_INTEGER.
  c.customize(weights, active); assert.equal(c.query(0, 0), 0);
  weights[count - 1]++;
  assert.throws(() => c.update([count - 1]), /MAX_SAFE_INTEGER/);
  active[count - 1] = 0; c.update([count - 1]);
  c.customize(weights, active); // Inactive weights do not enter the bound.
  active[count - 1] = 1;
  assert.throws(() => c.update([count - 1]), /MAX_SAFE_INTEGER/);
  weights[count - 1] = 2097151; const log = c.update([count - 1]);
  c.undo(log.undo); assert.equal(active[count - 1], 0);
});

test('engine undo-log reset and throw/inconsistent-stack recovery restore pristine compound metric', () => {
  const topology={n:4,order:[0,1,2,3],tail:[0,1,2],head:[1,2,3],precomputeTriangles:false};
  const cch=buildCCH(topology), a={edge_ms:Uint32Array.of(10,20,30),
    edge_initially_active:Uint8Array.of(1,1,1),edge_way:Uint32Array.of(0,1,2),
    way_osm_id:Float64Array.of(100,101,102),trip_origin:Uint32Array.of(0),trip_destination:Uint32Array.of(3),
    trip_ms:Uint32Array.of(60),trip_path_edges:Uint32Array.of(0,1,2),trip_path_offsets:Uint32Array.of(0,3)};
  const mask=a.edge_initially_active.slice(), weights=a.edge_ms.slice();
  cch.customize(a.edge_ms,mask); const pristine=metric(cch);
  let customizations=0;
  const realCustomize=cch.customize;
  cch.customize=(...args)=>{customizations++;return realCustomize(...args);};
  const procedure=createProcedure({counts:{ways:3},slow_seconds:120},a);
  const edit={weapon:'stomp',way_ids:[100,101,102]};
  function pristineState() {
    same(cch,pristine); assert.deepEqual(mask,a.edge_initially_active);
    assert.deepEqual(a.edge_ms,weights); assert.equal(cch.query(0,3),60);
  }
  const session=createEditSession(cch,a,mask,procedure);
  const result=session.run(edit);
  assert.deepEqual(result.rows[0].confirmed_runs,[[100,101,102]]);
  assert.equal(result.counts.single.jobs,3); assert.equal(result.counts.run.jobs,1);
  assert.deepEqual(a.edge_ms,weights); assert.deepEqual(mask,Uint8Array.of(0,0,0));
  session.reset(); pristineState(); assert.equal(customizations,0);
  // Throw while a counterfactual update is outstanding, before its undo.
  const failing=createEditSession(cch,a,mask,{run(test,adapter) {
    let searches=0;
    return procedure.run(test,{...adapter,search(...args){
      if (++searches === 2) throw new Error('forced query failure');
      return adapter.search(...args);
    }});
  }});
  assert.throws(()=>failing.run(edit),/forced query failure/);
  pristineState(); failing.reset(); pristineState(); assert.equal(customizations,1);
  const inconsistent=createEditSession(cch,a,mask,{run(test,adapter) {
    procedure.run(test,adapter); mask[0]=1; adapter.update([0]); return {};
  }});
  assert.throws(()=>inconsistent.run(edit),/Inconsistent edit log stack/);
  pristineState(); assert.equal(customizations,2);
  const replaced=createEditSession(cch,a,mask,{run(test,adapter) {
    mask[0]=0; const initial=adapter.update([0]); adapter.undo(initial.undo);
    mask[1]=0; adapter.update([1]); return {};
  }});
  assert.throws(()=>replaced.run(edit),/Inconsistent edit log stack/);
  pristineState(); assert.equal(customizations,3);
  // A stale log at reset must also recover through full customization.
  session.run(edit); realCustomize(a.edge_ms,mask); session.reset();
  pristineState(); assert.equal(customizations,4);
});
