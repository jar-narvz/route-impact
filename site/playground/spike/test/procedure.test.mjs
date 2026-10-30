import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProcedure, canonical} from '../procedure.js';
import {createEngine, deriveSources} from '../engine.js';
import {makeDijkstra} from '../dijkstra.mjs';
function graph(edges, baseline, baseMs) {
  edges.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const n = Math.max(...edges.flatMap(e => e.slice(0,2)))+1;
  const a = {csr_offsets: Uint32Array.from({length:n+1}, (_,v) => edges.filter(e => e[0]<v).length),
    edge_target: Uint32Array.from(edges,e=>e[1]), edge_ms: Uint32Array.from(edges,e=>e[2]),
    edge_way: Uint32Array.from(edges,e=>e[3]), edge_initially_active: Uint8Array.from(edges,e=>e[4]??1),
    edge_twin: Int32Array.from(edges,e=>e[5]??-1), way_osm_id: Float64Array.from([100,101,102,103]),
    way_oneway: Uint8Array.from([0,0,0,0]), trip_origin: Uint32Array.of(0), trip_destination: Uint32Array.of(n-1),
    trip_ms: Float64Array.of(baseMs), trip_path_offsets: Uint32Array.of(0,baseline.length),
    trip_path_edges: Uint32Array.from(baseline), geometry_offsets: Uint32Array.of(0,0,0,0,0), geometry_coords: new Int32Array()};
  const meta={counts:{vertices:n,ways:4}, slow_seconds:120,geometry_scale:1e6};
  deriveSources(a,n);
  const mask=a.edge_initially_active.slice(), d=makeDijkstra(a,n,mask);
  const run=test=>{mask.set(a.edge_initially_active);return createProcedure(meta,a).run(test,{mask,search:d.search,update:()=>null});};
  const cch=createEngine(meta,a,Uint32Array.from({length:n},(_,i)=>i),{});
  return {run,cch};
}
test('broken recovers to a detour over threshold: restoring one road matters',()=>{
  // Paths 0→1→2 (destroyed); restoring way 100 permits a 300 s detour 1→3.
  const {run,cch}=graph([[0,1,1000,0],[1,2,1000,1],[1,3,300000,2],[2,3,1000,1]],[0,1,3],3000);
  const edit={weapon:'meteor',lat:0,lon:0,radius_m:0};
  // Use compound stomp to select the same two destroyed ways without hit geometry.
  edit.weapon='stomp';edit.way_ids=[100,101];
  const result=run(edit);
  assert.equal(result.rows[0].status,'broken');
  assert.deepEqual(result.rows[0].confirmed_singles,[100]);
  assert.equal(result.rows[0].label,'single');
  assert.deepEqual(canonical(cch.edit(edit)),canonical(result));
});
test('active edge separates maximal changed runs; separate roads remain together',()=>{
  const {run,cch}=graph([[0,1,1000,0],[1,2,1000,2],[2,3,1000,1]],[0,1,2],3000);
  const edit={weapon:'stomp',way_ids:[100,101]};
  const result=run(edit);
  assert.deepEqual(result.rows[0].candidates,[100,101]);
  assert.equal(result.rows[0].total_runs,0);
  assert.equal(result.rows[0].label,'several_together');
  assert.deepEqual(canonical(cch.edit(edit)),canonical(result));
  cch.edit({weapon:'reset'});
  assert.deepEqual(canonical(cch.edit(edit)),canonical(result));
});
test('adjacent destroyed ways form a confirmed maximal run',()=>{
  const {run,cch}=graph([[0,1,1000,0],[1,2,1000,1]],[0,1],2000);
  const edit={weapon:'stomp',way_ids:[100,101]},result=run(edit);
  assert.deepEqual(result.rows[0].confirmed_singles,[]);
  assert.deepEqual(result.rows[0].confirmed_runs,[[100,101]]);
  assert.equal(result.rows[0].label,'run');
  assert.deepEqual(canonical(cch.edit(edit)),canonical(result));
});
