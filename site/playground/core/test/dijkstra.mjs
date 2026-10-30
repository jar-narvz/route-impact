/** Independent integer Dijkstra oracle; never imported by the browser worker. */
class Heap {
  constructor() { this.nodes = new Uint32Array(1024); this.costs = new Float64Array(1024); this.length = 0; }
  push(v, d) {
    if (this.length === this.nodes.length) {
      const nodes = new Uint32Array(this.length * 2), costs = new Float64Array(this.length * 2);
      nodes.set(this.nodes); costs.set(this.costs); this.nodes = nodes; this.costs = costs;
    }
    let i = this.length++;
    while (i) { const p = (i - 1) >> 1; if (this.costs[p] < d || (this.costs[p] === d && this.nodes[p] <= v)) break;
      this.nodes[i] = this.nodes[p]; this.costs[i] = this.costs[p]; i = p; }
    this.nodes[i] = v; this.costs[i] = d;
  }
  pop() {
    this.node = this.nodes[0]; this.cost = this.costs[0];
    const size = --this.length, v = this.nodes[size], d = this.costs[size];
    let i = 0;
    while (2 * i + 1 < size) {
      let j = 2 * i + 1;
      if (j + 1 < size && (this.costs[j + 1] < this.costs[j] || (this.costs[j + 1] === this.costs[j] && this.nodes[j + 1] < this.nodes[j]))) j++;
      if (this.costs[j] > d || (this.costs[j] === d && this.nodes[j] >= v)) break;
      this.nodes[i] = this.nodes[j]; this.costs[i] = this.costs[j]; i = j;
    }
    this.nodes[i] = v; this.costs[i] = d;
  }
}
export function makeDijkstra(a, n, mask, costs = a.edge_ms) {
  const dist = new Float64Array(n), stamp = new Uint32Array(n), pred = new Int32Array(n), heap = new Heap();
  let epoch = 0;
  function search(s, targets, wantPaths = false) {
    if (++epoch === 0xffffffff) { stamp.fill(0); epoch = 1; }
    heap.length = 0; const remaining = new Set(targets);
    stamp[s] = epoch; dist[s] = 0; pred[s] = -1; heap.push(s, 0);
    while (heap.length && remaining.size) {
      heap.pop(); const v = heap.node, d = heap.cost;
      if (d !== dist[v]) continue;
      remaining.delete(v);
      for (let e = a.csr_offsets[v]; e < a.csr_offsets[v + 1]; e++) {
        if (!mask[e]) continue;
        const w = a.edge_target[e], nd = d + costs[e];
        if (stamp[w] !== epoch || nd < dist[w]) {
          stamp[w] = epoch; dist[w] = nd; pred[w] = e; heap.push(w, nd);
        }
      }
    }
    return targets.map(t => {
      const distance = remaining.has(t) ? Infinity : dist[t];
      if (!wantPaths) return distance;
      const edges = [];
      if (Number.isFinite(distance)) for (let v = t; v !== s;) { const e = pred[v]; edges.push(e); v = a.edge_source[e]; }
      edges.reverse(); return {distance, edges};
    });
  }
  return {search};
}
