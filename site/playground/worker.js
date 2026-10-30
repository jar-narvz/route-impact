/** Load and verify the shipped export, then answer requests strictly in order. */
import {createProtocol} from './core/protocol.js';
import {packJsonArray} from './core/packed.js';

let protocol;
async function load() {
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStreamUnavailable: gzip decompression is required');
  if (!globalThis.crypto?.subtle) throw new Error('CryptoSubtleUnavailable: SHA-256 verification is required');
  const start = performance.now(), base = new URL('data/', import.meta.url);
  async function fetchBytes(name) {
    const response = await fetch(new URL(name, base));
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.arrayBuffer();
  }
  const decode = raw => JSON.parse(new TextDecoder().decode(raw));
  const meta = decode(await fetchBytes('meta.json')), bytes = new Map();
  const sha = async raw => [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))]
    .map(v => v.toString(16).padStart(2, '0')).join('');
  await Promise.all(meta.files.filter(f => f.shipped !== false && f.file !== 'meta.json').map(async spec => {
    const raw = await fetchBytes(spec.file);
    if (spec.sha256 && await sha(raw) !== spec.sha256) throw new Error(`Hash mismatch ${spec.file}`);
    bytes.set(spec.file, raw);
  }));
  async function read(name) {
    const raw = bytes.get(name);
    if (!raw) throw new Error(`Missing file ${name}`);
    return name.endsWith('.gz') ? new Response(new Blob([raw]).stream()
      .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : raw;
  }
  const types = {'<f8': Float64Array, '<u4': Uint32Array, '<i4': Int32Array, u1: Uint8Array}, a = {};
  for (const spec of meta.arrays) {
    const Type = types[spec.dtype];
    if (!Type) throw new Error(`Unknown dtype ${spec.dtype}`);
    const raw = await read(spec.file), offset = spec.byte_offset ?? 0;
    if (raw.byteLength - offset !== spec.length * Type.BYTES_PER_ELEMENT) throw new Error(`Length mismatch ${spec.name}`);
    a[spec.name] = new Type(raw.slice(offset));
  }
  for (const spec of meta.json_arrays || []) {
    a[spec.name] = packJsonArray(new Uint8Array(await read(spec.file)), {allowObjects: true});
    if (a[spec.name].length !== spec.length) throw new Error(`Length mismatch ${spec.name}`);
  }
  const raw = await read('cch_order.bin.gz'), manifest = decode(await read('order_manifest.json.gz'));
  const order = new Uint32Array(raw);
  if (manifest.output_sha256 !== undefined) {
    if (await sha(raw) !== manifest.output_sha256) throw new Error('Order hash mismatch');
  } else if (manifest.method !== 'identity' || order.length !== meta.counts.vertices || order.some((v, i) => v !== i)) {
    throw new Error('Order manifest has no output hash and the order is not the identity');
  }
  const presets = bytes.has('presets.json.gz') ? decode(await read('presets.json.gz')) : {};
  protocol = createProtocol({meta, a, order, presets, loadMs: performance.now() - start});
}
let queue = Promise.resolve();
self.onmessage = ({data}) => {
  queue = queue.then(async () => {
    try {
      if (!protocol) {
        if (data.type !== 'load') throw new Error('Load required before other messages');
        await load();
      }
      self.postMessage(protocol.handle(data));
    } catch (error) { self.postMessage({id: data?.id, ok: false, error: String(error)}); }
  });
};
