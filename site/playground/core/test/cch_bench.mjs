/** Whole worker protocol: intentionally imports no Dijkstra oracle. */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {cpus, totalmem, platform, arch, release} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = new URL('../../../../', import.meta.url);
const data = new URL('data/playground-bench/', root);
const json = url => JSON.parse(readFileSync(url));
if (process.argv[2] === '--single') {
  console.log(JSON.stringify(await singleRun(process.argv[3])));
} else {
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const args = ['--expose-gc', fileURLToPath(import.meta.url), '--single'];
    if (process.argv[2]) args.push(process.argv[2]);
    const child = spawnSync(process.execPath, args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(`Benchmark run ${i+1} failed (${child.status}): ${child.stderr}`);
    runs.push(JSON.parse(child.stdout));
  }
  const median = values => [...values].sort((a, b) => a-b)[2];
  const after50 = runs.map(run => run.after_50_edits.rss);
  const report = {...runs[0], runs, after_50_rss_median: median(after50),
    after_50_rss_max: Math.max(...after50), after_load_rss_median: median(runs.map(run => run.after_load.rss)),
    memory_limit_bytes: 300000000,
    memory_gate_rule: 'median of 5 fresh runs of RSS after 50 edits ≤ limit (PLAN decision 17)',
    memory_gate_pass: median(after50) <= 300000000};
  mkdirSync(data, {recursive: true});
  writeFileSync(new URL('cch_engine_node.json', data), JSON.stringify(report, null, 2)+'\n');
  console.log(`RSS after 50 edits: ${after50.join(' / ')} B; median ${report.after_50_rss_median} B; max ${report.after_50_rss_max} B; gate ${report.memory_gate_pass ? 'PASS' : 'FAIL'}`);
}

async function singleRun(exportDir) {
  const {load} = await import('../load.mjs');
  const {createProtocol} = await import('../protocol.js');
  const start = performance.now();
  const decoded = load(exportDir || new URL('site/playground/data/', root));
  const {manifest} = decoded;
  const protocol = createProtocol({...decoded, loadMs: performance.now() - start});
  function handle(message) {
    const reply = protocol.handle(message);
    if (!reply.ok) throw new Error(reply.error);
  }
  handle({type: 'load'});
  const loadCustomizeMs = performance.now() - start;
  const peakLoadRss = process.resourceUsage().maxRSS * 1024;
  function memorySample() {
    if (globalThis.gc) { globalThis.gc(); globalThis.gc(); }
    const {rss, heapUsed, external, arrayBuffers} = process.memoryUsage();
    return {rss, heapUsed, external, arrayBuffers, live_bytes: heapUsed + arrayBuffers};
  }
  const afterLoad = memorySample();
  const report = {environment: {node: process.version, cpu: cpus()[0].model, ram_bytes: totalmem(), platform: platform(), arch: arch(), release: release()},
    engine_only: false, load_customize_ms: loadCustomizeMs, peak_load_rss_bytes: peakLoadRss,
    peak_load_rss_source: 'process.resourceUsage().maxRSS (KiB × 1024 → bytes)', gc_before_samples: !!globalThis.gc, triangle_mode: protocol.stats().triangleMode, after_load: afterLoad, topology: protocol.stats(), manifest, cases: []};
  const cases = json(new URL('results/playground/stress_set.json', root)).cases;
  for (let i = 0; i < 50; i++) {
    handle({type: 'pick', lat: 37.8, lon: -122.27, max_m: 30});
    handle({type: 'edit', edit: cases.find(t => t.id === 'bay_bridge_toll_plaza_500')});
  }
  report.after_50_edits = memorySample();
  report.rss_growth_bytes = report.after_50_edits.rss - afterLoad.rss;
  report.protocol = 'Command: node --expose-gc site/playground/core/test/cch_bench.mjs --single [export_dir]. If available, gc() twice before each memory sample. Fresh process, no oracle imports/results. Whole protocol RSS after createProtocol and discarded typed-array load reply, then exactly 50 pick + toll-plaza edit pairs. Five timing repeats per case follow the memory exercise.';
  for (const test of cases) {
    const repeats = [], reset = [];
    for (let i = 0; i < 5; i++) {
      let t = performance.now(); handle({type: 'reset'}); reset.push(performance.now()-t);
      t = performance.now(); handle({type: 'edit', edit: test}); repeats.push(performance.now()-t);
    }
    const median = [...repeats].sort((a,b) => a-b)[2];
    report.cases.push({id: test.id, latency_ms: repeats, median_ms: median, reset_ms: reset});
  }
  return report;

}
