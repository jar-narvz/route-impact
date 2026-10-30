/** Worker engine ALONE: intentionally imports no Dijkstra oracle. */
import {writeFileSync} from 'node:fs';
import {cpus, totalmem, platform, arch, release} from 'node:os';
import {load, root, data, json} from './node-data.mjs';
import {createEngine} from './engine.js';
const {meta, a, order, presets, manifest} = load();
const start = performance.now();
const engine = createEngine(meta, a, order, presets);
const loadCustomizeMs = performance.now() - start;
const peakLoadRss = process.resourceUsage().maxRSS * 1024;
function memorySample() {
  if (globalThis.gc) { globalThis.gc(); globalThis.gc(); }
  const {rss, heapUsed, external, arrayBuffers} = process.memoryUsage();
  return {rss, heapUsed, external, arrayBuffers, live_bytes: heapUsed + arrayBuffers};
}
const afterLoad = memorySample();
const report = {environment: {node: process.version, cpu: cpus()[0].model, ram_bytes: totalmem(), platform: platform(), arch: arch(), release: release()},
  engine_only: true, load_customize_ms: loadCustomizeMs, peak_load_rss_bytes: peakLoadRss,
  peak_load_rss_source: 'process.resourceUsage().maxRSS (KiB × 1024 → bytes)', gc_before_samples: !!globalThis.gc, triangle_mode: engine.stats().triangleMode, after_load: afterLoad, topology: engine.stats(), manifest, cases: []};
const cases = json(new URL('results/playground/stress_set.json', root)).cases;
for (let i = 0; i < 50; i++) engine.edit(cases.find(t => t.id === 'bay_bridge_toll_plaza_500'));
report.after_50_edits = memorySample();
report.rss_growth_bytes = report.after_50_edits.rss - afterLoad.rss;
report.memory_limit_bytes = 300000000;
report.memory_gate_pass = Math.max(afterLoad.rss, report.after_50_edits.rss) <= report.memory_limit_bytes;
report.protocol = 'Command: node --expose-gc site/playground/spike/cch_bench.mjs. If available, gc() twice before each memory sample. Fresh process, no oracle imports/results. RSS after load+customize, then exactly 50 repeated toll-plaza edits. Five timing repeats per case follow the memory exercise.';
for (const test of cases) {
  const repeats = [], reset = [];
  for (let i = 0; i < 5; i++) {
    let t = performance.now(); engine.edit({weapon: 'reset'}); reset.push(performance.now()-t);
    t = performance.now(); engine.edit(test); repeats.push(performance.now()-t);
  }
  const median = [...repeats].sort((a,b) => a-b)[2];
  report.cases.push({id: test.id, latency_ms: repeats, median_ms: median, reset_ms: reset});
  console.log(`${test.id}: ${median.toFixed(2)} ms`);
}
writeFileSync(new URL('cch_engine_node.json', data), JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify({after_load_rss: afterLoad.rss, after_50_rss: report.after_50_edits.rss, growth: report.rss_growth_bytes}));
