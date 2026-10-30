/**
 * Directed integer CCH, Dibbelt/Strasser/Wagner (JEA 2016), §§6–8.
 * buildCCH({n, order, tail, head, precomputeTriangles=true}) builds metric-free
 * topology. order[rank]=vertex. customize(Uint32 weights, Uint8 active) retains
 * caller-owned inputs: absence is mask-only; every Uint32 weight is finite.
 * Mutate inputs, then update(changedInputIds). update returns
 * {dirtyArcs, changedArcs, trianglesScanned, undo}; undo(log) restores that update
 * in O(changed), including inputs. Logs are single-use, LIFO, invalidated by full
 * customization/restoreBase. saveBase()/restoreBase() include inputs/witnesses.
 * Metrics and query distances are Float64 whole milliseconds or Infinity.
 * unpack returns input ids; unreachable returns null. Queries are synchronous,
 * reuse scratch buffers, and are not reentrant. stats() lists explicit buffers.
 * Witness encoding: negative first = -inputId-1; nonnegative first/second are
 * child arcs (z,x),(z,y). Up expands down(first),up(second); down reverses them.
 * NONE marks unreachable. Ties: direct lowest id, then lowest triangle z.
 */
const UINT32_MAX = 0xffffffff;
const NONE = -0x80000000;
function assertMetric(value) {
  if (value !== Infinity && !Number.isInteger(value))
    throw new RangeError('Metric must be integer milliseconds or Infinity');
  return value;
}
function assertTotal(sum) {
  if (!Number.isSafeInteger(sum) || sum < 0)
    throw new RangeError('Sum of active input weights exceeds Number.MAX_SAFE_INTEGER');
  return sum;
}

// Numeric min-heap: CCH arc ids are already ordered by lower endpoint rank.
class Queue {
  constructor() { this.items = []; }
  push(x) {
    let i = this.items.length; this.items.push(x);
    while (i && this.items[(i - 1) >> 1] > x) {
      this.items[i] = this.items[(i - 1) >> 1]; i = (i - 1) >> 1;
    }
    this.items[i] = x;
  }
  pop() {
    const result = this.items[0], x = this.items.pop();
    if (this.items.length) {
      let i = 0;
      while (2 * i + 1 < this.items.length) {
        let j = 2 * i + 1;
        if (j + 1 < this.items.length && this.items[j + 1] < this.items[j]) j++;
        if (this.items[j] >= x) break;
        this.items[i] = this.items[j]; i = j;
      }
      this.items[i] = x;
    }
    return result;
  }
}

function offsets(counts) {
  const out = new Uint32Array(counts.length + 1);
  for (let i = 0; i < counts.length; i++) {
    const next = out[i] + counts[i];
    if (next >= UINT32_MAX) throw new RangeError('CSR exceeds Uint32 capacity');
    out[i + 1] = next;
  }
  return out;
}

export function buildCCH({n, order, tail, head, precomputeTriangles = true}) {
  if (!Number.isInteger(n) || n < 0 || n >= UINT32_MAX || order.length !== n || tail.length !== head.length)
    throw new RangeError('Invalid topology dimensions');
  if (tail.length >= 0x7fffffff) throw new RangeError('Input ids exceed witness capacity');
  for (const v of order) if (!Number.isInteger(v) || v < 0 || v >= n)
    throw new RangeError('Order must be a permutation');
  order = Uint32Array.from(order);
  const rank = new Uint32Array(n), seen = new Uint8Array(n);
  for (let r = 0; r < n; r++) {
    const v = order[r];
    if (v >= n || seen[v]) throw new RangeError('Order must be a permutation');
    seen[v] = 1; rank[v] = r;
  }
  // Forward-star lists reuse eliminated slots. Passing a deduplicated list to
  // its parent adds fewer entries than we just freed, so input size is a bound.
  let neighbourHead = new Int32Array(n).fill(-1);
  let neighbourNext = new Int32Array(tail.length), neighbourValue = new Uint32Array(tail.length);
  let freeSlot = -1, usedSlots = 0;
  function appendNeighbour(v, y) {
    let slot;
    if (freeSlot >= 0) { slot = freeSlot; freeSlot = neighbourNext[slot]; }
    else slot = usedSlots++;
    neighbourValue[slot] = y; neighbourNext[slot] = neighbourHead[v]; neighbourHead[v] = slot;
  }
  for (let e = 0; e < tail.length; e++) {
    if (!Number.isInteger(tail[e]) || !Number.isInteger(head[e]) || tail[e] < 0 || head[e] < 0 || tail[e] >= n || head[e] >= n)
      throw new RangeError('Invalid input endpoint');
    const a = rank[tail[e]], b = rank[head[e]];
    if (a !== b) appendNeighbour(Math.min(a, b), Math.max(a, b));
  }
  const parent = new Int32Array(n).fill(-1), first = new Uint32Array(n + 1);
  let upperStorage = new Uint32Array(Math.max(16, tail.length));
  // Sort/deduplicate only the vertex being eliminated, write its upper slice,
  // and pass the remaining upper neighbours to its parent.
  for (let v = 0; v < n; v++) {
    const ys = [];
    for (let slot = neighbourHead[v]; slot >= 0;) {
      ys.push(neighbourValue[slot]);
      const next = neighbourNext[slot];
      neighbourNext[slot] = freeSlot; freeSlot = slot; slot = next;
    }
    neighbourHead[v] = -1;
    ys.sort((a, b) => a - b);
    let count = 0;
    for (let i = 0; i < ys.length; i++) if (!i || ys[i] !== ys[i - 1]) ys[count++] = ys[i];
    const end = first[v] + count;
    if (end >= 0x7fffffff) throw new RangeError('CCH ids exceed witness capacity');
    if (end > upperStorage.length) {
      const grown = new Uint32Array(Math.max(end, upperStorage.length * 2));
      grown.set(upperStorage); upperStorage = grown;
    }
    if (count) {
      const p = ys[0]; parent[v] = p;
      for (let i = 0; i < count; i++) {
        upperStorage[first[v] + i] = ys[i];
        if (i) appendNeighbour(p, ys[i]);
      }
    }
    first[v + 1] = end;
  }
  const neighbourTemporaryBytes = neighbourHead.byteLength + neighbourNext.byteLength + neighbourValue.byteLength;
  neighbourHead = neighbourNext = neighbourValue = null;
  const upperTemporaryBytes = upperStorage.byteLength;
  const m = first[n], upper = upperStorage.slice(0, m), lower = new Uint32Array(m);
  upperStorage = null;
  for (let x = 0; x < n; x++) lower.fill(x, first[x], first[x + 1]);
  function find(x, y) {
    let a = first[x], b = first[x + 1];
    while (a < b) { const mid = (a + b) >>> 1; if (upper[mid] < y) a = mid + 1; else b = mid; }
    if (a === first[x + 1] || upper[a] !== y) throw new Error('Missing fill arc');
    return a;
  }
  const inputArc = new Int32Array(tail.length).fill(-1), inputDir = new Uint8Array(tail.length);
  const inputCounts = new Uint32Array(2 * m);
  for (let e = 0; e < tail.length; e++) {
    const x = rank[tail[e]], y = rank[head[e]];
    if (x === y) continue;
    const a = find(Math.min(x, y), Math.max(x, y)), d = x > y ? 1 : 0;
    inputArc[e] = a; inputDir[e] = d; inputCounts[2 * a + d]++;
  }
  const inputFirst = offsets(inputCounts), inputIds = new Uint32Array(inputFirst[2 * m]);
  const cursor = inputCounts;
  cursor.set(inputFirst.subarray(0, 2 * m));
  for (let e = 0; e < tail.length; e++) if (inputArc[e] >= 0)
    inputIds[cursor[2 * inputArc[e] + inputDir[e]]++] = e;
  // Incoming CSR supports sorted lower-neighbour intersection on demand.
  const incomingCounts = new Uint32Array(n);
  for (const y of upper) incomingCounts[y]++;
  const incomingFirst = offsets(incomingCounts), incoming = new Uint32Array(m), pos = incomingCounts;
  pos.set(incomingFirst.subarray(0, n));
  for (let a = 0; a < m; a++) incoming[pos[upper[a]]++] = a;
  function triangles(a, visit) {
    let i = incomingFirst[lower[a]], j = incomingFirst[upper[a]];
    const end = incomingFirst[lower[a] + 1], endJ = incomingFirst[upper[a] + 1];
    while (i < end && j < endJ) {
      const b = incoming[i], c = incoming[j], z = lower[b], w = lower[c];
      if (z === w) { visit(b, c); i++; j++; }
      else if (z < w) i++; else j++;
    }
  }
  const triangleCounts = new Uint32Array(m);
  for (let a = 0; a < m; a++) triangles(a, () => triangleCounts[a]++);
  const triangleFirst = offsets(triangleCounts), triangleCount = triangleFirst[m];
  let triangleA = null, triangleB = null;
  if (precomputeTriangles) {
    triangleA = new Uint32Array(triangleCount); triangleB = new Uint32Array(triangleCount);
    for (let a = 0; a < m; a++) {
      let i = triangleFirst[a];
      triangles(a, (b, c) => { triangleA[i] = b; triangleB[i++] = c; });
    }
  }
  const up = new Float64Array(m).fill(Infinity), down = new Float64Array(m).fill(Infinity);
  const upFirst = new Int32Array(m).fill(NONE), upSecond = new Int32Array(m).fill(NONE);
  const downFirst = new Int32Array(m).fill(NONE), downSecond = new Int32Array(m).fill(NONE);
  const metric = [up, down, upFirst, upSecond, downFirst, downSecond];
  const queued = new Uint8Array(m);
  const forward = new Float64Array(n).fill(Infinity), backward = new Float64Array(n).fill(Infinity);
  const forwardPred = new Int32Array(n).fill(-1), backwardPred = new Int32Array(n).fill(-1);
  let weights, active, knownWeights, knownActive, total = 0, base, version = {};
  function validateWeights(w, mask) {
    let sum = 0;
    for (let e = 0; e < w.length; e++) if (mask[e]) sum = assertTotal(sum + w[e]);
    return sum;
  }
  function recompute(a) {
    let u = Infinity, d = Infinity, uf = NONE, us = NONE, df = NONE, ds = NONE;
    for (let dir = 0; dir < 2; dir++) {
      const slot = 2 * a + dir;
      for (let i = inputFirst[slot]; i < inputFirst[slot + 1]; i++) {
        const e = inputIds[i];
        if (!active[e]) continue;
        if (!dir && weights[e] < u) { u = weights[e]; uf = -e - 1; }
        if (dir && weights[e] < d) { d = weights[e]; df = -e - 1; }
      }
    }
    const visit = (b, c) => {
      const nu = down[b] + up[c], nd = down[c] + up[b];
      if (nu < u) { u = nu; uf = b; us = c; }
      if (nd < d) { d = nd; df = b; ds = c; }
    };
    if (triangleA) for (let i = triangleFirst[a]; i < triangleFirst[a + 1]; i++) visit(triangleA[i], triangleB[i]);
    else triangles(a, visit);
    const changed = u !== up[a] || d !== down[a] || uf !== upFirst[a] || us !== upSecond[a] || df !== downFirst[a] || ds !== downSecond[a];
    up[a] = assertMetric(u); down[a] = assertMetric(d); upFirst[a] = uf; upSecond[a] = us; downFirst[a] = df; downSecond[a] = ds;
    return changed;
  }
  function customize(w, mask) {
    if (!(w instanceof Uint32Array) || !(mask instanceof Uint8Array) || w.length !== tail.length || mask.length !== w.length)
      throw new TypeError('Expected Uint32 weights and Uint8 active per input arc');
    total = validateWeights(w, mask); weights = w; active = mask;
    knownWeights = w.slice(); knownActive = mask.slice();
    for (let a = 0; a < m; a++) recompute(a);
    base = undefined; version = {};
    return {dirtyArcs: m, trianglesScanned: triangleCount};
  }
  function update(changedInputArcs) {
    if (!weights) throw new Error('Customize before updating');
    const ids = [...new Set(changedInputArcs)], inputs = [];
    let nextTotal = total;
    for (const e of ids) {
      if (!Number.isInteger(e) || e < 0 || e >= weights.length) throw new RangeError('Invalid changed input id');
      nextTotal -= knownActive[e] ? knownWeights[e] : 0;
      inputs.push([e, knownWeights[e], knownActive[e]]);
    }
    // Subtract all old contributions first: a safe batch may swap large weights.
    for (const e of ids) if (active[e]) nextTotal = assertTotal(nextTotal + weights[e]);
    assertTotal(nextTotal);
    const log = {inputs, arcs: [], total, before: version, after: {}, used: false};
    const q = new Queue();
    const enqueue = a => { if (!queued[a]) { queued[a] = 1; q.push(a); } };
    for (const e of ids) {
      knownWeights[e] = weights[e]; knownActive[e] = active[e];
      if (inputArc[e] >= 0) enqueue(inputArc[e]);
    }
    let dirtyArcs = 0, trianglesScanned = 0;
    while (q.items.length) {
      const a = q.pop(); queued[a] = 0; dirtyArcs++; trianglesScanned += triangleCounts[a];
      const old = metric.map(buf => buf[a]);
      if (!recompute(a)) continue;
      log.arcs.push([a, ...old]);
      // All upper triangles containing (z,x): pair x with every other upper
      // neighbour of z. The dependency's lower endpoint is strictly above z.
      const z = lower[a], x = upper[a];
      for (let b = first[z]; b < first[z + 1]; b++) if (b !== a) {
        const y = upper[b]; enqueue(find(Math.min(x, y), Math.max(x, y)));
      }
    }
    total = nextTotal; version = log.after;
    return {dirtyArcs, changedArcs: log.arcs.length, trianglesScanned, undo: log};
  }
  function undo(log) {
    if (log.used || log.after !== version) throw new Error('Undo must be single-use and LIFO');
    for (const [e, w, mask] of log.inputs) { weights[e] = knownWeights[e] = w; active[e] = knownActive[e] = mask; }
    for (const row of log.arcs) for (let i = 0; i < metric.length; i++) metric[i][row[0]] = row[i + 1];
    total = log.total; version = log.before; log.used = true;
  }
  function saveBase() {
    if (!weights) throw new Error('Customize before saving');
    base = {metric: metric.map(x => x.slice()), weights: weights.slice(), active: active.slice(), total};
  }
  function restoreBase() {
    if (!base) throw new Error('No saved base');
    metric.forEach((x, i) => x.set(base.metric[i]));
    weights.set(base.weights); active.set(base.active); knownWeights.set(weights); knownActive.set(active); total = base.total; version = {};
  }
  function vertex(v) { if (!Number.isInteger(v) || v < 0 || v >= n) throw new RangeError('Invalid query vertex'); return rank[v]; }
  function pass(v, dist, pred, costs) {
    for (let x = v; x >= 0; x = parent[x]) { dist[x] = Infinity; pred[x] = -1; }
    dist[v] = 0;
    for (let x = v; x >= 0; x = parent[x]) {
      if (dist[x] === Infinity) continue;
      for (let a = first[x]; a < first[x + 1]; a++) {
        const y = upper[a], d = dist[x] + costs[a];
        if (d < dist[y]) { dist[y] = assertMetric(d); pred[y] = a; }
      }
    }
  }
  function meet(t) {
    let best = Infinity, at = -1;
    for (let x = t; x >= 0; x = parent[x]) {
      const d = forward[x] + backward[x];
      if (d < best) { best = assertMetric(d); at = x; }
    }
    return {best, at};
  }
  function queryMany(s, targets) {
    if (!weights) throw new Error('Customize before querying');
    const source = vertex(s);
    pass(source, forward, forwardPred, up);
    const result = [];
    // Different components have disjoint ancestor chains. Only this forward
    // chain is valid; clear it after the batch to prevent stale intersections.
    for (const t of targets) {
      const target = vertex(t); pass(target, backward, backwardPred, down);
      const {best} = meet(target); result.push(best);
    }
    for (let x = source; x >= 0; x = parent[x]) forward[x] = Infinity;
    return result;
  }
  function query(s, t) { return queryMany(s, [t])[0]; }
  function unpack(s, t) {
    if (!weights) throw new Error('Customize before unpacking');
    const source = vertex(s), target = vertex(t);
    pass(source, forward, forwardPred, up); pass(target, backward, backwardPred, down);
    const {best, at} = meet(target), chain = [], result = [];
    for (let x = source; x >= 0; x = parent[x]) forward[x] = Infinity;
    if (best === Infinity) return null;
    for (let x = at; x !== source;) { const a = forwardPred[x]; if (a < 0) throw new Error('Missing forward predecessor'); chain.push([a, 0]); x = lower[a]; }
    chain.reverse();
    for (let x = at; x !== target;) { const a = backwardPred[x]; if (a < 0) throw new Error('Missing backward predecessor'); chain.push([a, 1]); x = lower[a]; }
    const stack = chain.reverse();
    while (stack.length) {
      const [a, dir] = stack.pop(), f = (dir ? downFirst : upFirst)[a], b = (dir ? downSecond : upSecond)[a];
      if (f === NONE) throw new Error('Unreachable witness');
      if (f < 0) result.push(-f - 1);
      else if (!dir) { stack.push([b, 0], [f, 1]); }
      else { stack.push([f, 0], [b, 1]); }
    }
    let v = s, sum = 0;
    for (const e of result) {
      if (!active[e] || tail[e] !== v) throw new Error('Inactive or discontinuous unpacked path');
      sum += weights[e]; v = head[e];
    }
    if (v !== t || sum !== best) throw new Error('Unpacked endpoints/distance mismatch');
    return result;
  }
  function measureTriangleEnumeration() {
    const time = () => performance.now();
    let checksum = 0, count = 0;
    const visit = (b, c) => { checksum = (checksum + b + c) >>> 0; count++; };
    let start = time();
    for (let a = 0; a < m; a++) triangles(a, visit);
    const onDemand = {ms: time() - start, count, checksum};
    let precomputed = null;
    if (triangleA) {
      checksum = 0; count = 0; start = time();
      for (let i = 0; i < triangleCount; i++) visit(triangleA[i], triangleB[i]);
      precomputed = {ms: time() - start, count, checksum};
    }
    return {onDemand, precomputed};
  }
  // Keep only the size in the stats closure, so construction scratch can die.
  const constructionTemporaryBufferBytes = seen.byteLength + inputCounts.byteLength + incomingCounts.byteLength + neighbourTemporaryBytes + upperTemporaryBytes;
  function stats() {
    const structures = {order, rank, first, upper, lower, parent, inputArc, inputDir, inputFirst, inputIds,
      incomingFirst, incoming, triangleCounts, triangleFirst, triangleA, triangleB, up, down, upFirst, upSecond,
      downFirst, downSecond, queued, forward, backward, forwardPred, backwardPred, knownWeights, knownActive};
    const buffers = Object.fromEntries(Object.entries(structures).filter(([, x]) => x).map(([k, x]) => [k, x.byteLength]));
    buffers.savedBase = base ? base.metric.reduce((sum, x) => sum + x.byteLength, 0) + base.weights.byteLength + base.active.byteLength : 0;
    return {n, inputArcs: tail.length, cchArcs: m, triangles: triangleCount, precomputedTriangles: triangleA ? triangleCount : 0,
      triangleMode: triangleA ? 'precomputed' : 'on-demand', buffers, totalBufferBytes: Object.values(buffers).reduce((a, b) => a + b, 0),
      constructionTemporaryBufferBytes,
      constructionNote: 'Array storage is engine-managed; RSS samples include it. Explicit temporaries exclude engine-managed objects.',
      alternativeTriangleBytes: {precomputed: triangleFirst.byteLength + triangleCounts.byteLength + 8 * triangleCount,
        onDemand: triangleFirst.byteLength + triangleCounts.byteLength}};
  }
  return {customize, update, undo, saveBase, restoreBase, query, queryMany, unpack, stats, measureTriangleEnumeration,
    up, down, upFirst, upSecond, downFirst, downSecond, inputArc, inputDir};
}
