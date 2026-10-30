/** Single module worker: no landmarks, pool, or attribution budget. */
import {createEngine} from './engine.js';
let engine;
const types = {'<f8': Float64Array, '<u4': Uint32Array, '<i4': Int32Array, u1: Uint8Array};
async function load() {
  performance.setResourceTimingBufferSize(1000);
  const start = performance.now(), token = crypto.randomUUID();
  const base = new URL('../../../data/playground-spike/', import.meta.url);
  async function fetchBytes(file) {
    const response = await fetch(new URL(`${file}?cold=${token}`, base), {cache: 'no-store'});
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    return response.arrayBuffer();
  }
  const metaBytes = await fetchBytes('meta.json');
  const meta = JSON.parse(new TextDecoder().decode(metaBytes)), bytes = new Map([['meta.json', metaBytes]]);
  await Promise.all(meta.files.filter(f => f.file !== 'meta.json').map(async f => bytes.set(f.file, await fetchBytes(f.file))));
  const hashes = {};
  for (const [name, raw] of bytes) {
    hashes[name] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(v => v.toString(16).padStart(2, '0')).join('');
    const expected = meta.files.find(f => f.file === name)?.sha256;
    if (expected && hashes[name] !== expected) throw new Error(`Hash mismatch ${name}`);
  }
  async function unpack(file) {
    return new Response(new Blob([bytes.get(file)]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const a = {};
  await Promise.all(meta.arrays.map(async spec => {
    a[spec.name] = new types[spec.dtype](await unpack(spec.file));
    if (a[spec.name].length !== spec.length) throw new Error(`Length mismatch ${spec.name}`);
  }));
  const orderRaw = await unpack('cch_order.bin.gz');
  const manifest = JSON.parse(new TextDecoder().decode(await unpack('order_manifest.json.gz')));
  const orderHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', orderRaw))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (orderHash !== manifest.output_sha256) throw new Error('Order hash mismatch');
  const presets = JSON.parse(new TextDecoder().decode(await unpack('presets.json.gz')));
  engine = createEngine(meta, a, new Uint32Array(orderRaw), presets);
  return {meta, hashes, order_hash: orderHash, stats: engine.stats(), load_ms: performance.now() - start,
    resources: performance.getEntriesByType('resource').filter(r => r.name.includes('/data/playground-spike/')).map(r => ({name: r.name, transferSize: r.transferSize,
      encodedBodySize: r.encodedBodySize, decodedBodySize: r.decodedBodySize}))};
}
self.onmessage = async ({data}) => {
  try {
    const result = data.type === 'load' ? await load() : engine.edit(data);
    self.postMessage({requestId: data.requestId, result});
  } catch (error) { self.postMessage({requestId: data.requestId, error: error.stack || String(error)}); }
};
