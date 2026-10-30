/** Load a format-v1 export directory for offline Node checks. */
import {existsSync, readFileSync} from 'node:fs';
import {resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {packJsonArray} from './packed.js';

export function load(dirUrlOrPath) {
  const dir = dirUrlOrPath instanceof URL ? new URL(dirUrlOrPath) : pathToFileURL(resolve(dirUrlOrPath) + sep);
  if (!dir.pathname.endsWith('/')) dir.pathname += '/';
  const meta = JSON.parse(readFileSync(new URL('meta.json', dir))), a = {};
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  function read(name) {
    const packed = readFileSync(new URL(name, dir));
    const hash = meta.files?.find(f => f.file === name)?.sha256;
    if (hash && sha(packed) !== hash) throw new Error(`Hash mismatch ${name}`);
    return name.endsWith('.gz') ? gunzipSync(packed) : packed;
  }
  const types = {'<f8': Float64Array, '<u4': Uint32Array, '<i4': Int32Array, u1: Uint8Array};
  for (const spec of meta.arrays) {
    const Type = types[spec.dtype];
    if (!Type) throw new Error(`Unknown dtype ${spec.dtype}`);
    const raw = read(spec.file), offset = spec.byte_offset ?? 0;
    if (raw.byteLength - offset !== spec.length * Type.BYTES_PER_ELEMENT) throw new Error(`Length mismatch ${spec.name}`);
    a[spec.name] = new Type(raw.buffer.slice(raw.byteOffset + offset, raw.byteOffset + raw.byteLength));
  }
  for (const spec of meta.json_arrays || []) {
    a[spec.name] = packJsonArray(read(spec.file), {allowObjects: true});
    if (a[spec.name].length !== spec.length) throw new Error(`Length mismatch ${spec.name}`);
  }
  const raw = read('cch_order.bin.gz'), manifest = JSON.parse(read('order_manifest.json.gz'));
  const input = new URL('cch_order_input.bin', dir);
  if (existsSync(input) && sha(read('cch_order_input.bin')) !== manifest.input_sha256) throw new Error('Canonical input hash mismatch');
  const order = new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  // Tool-made orders carry an output hash; test-only identity orders (fixtures) carry none, so check them directly.
  if (manifest.output_sha256 !== undefined) {
    if (sha(raw) !== manifest.output_sha256) throw new Error('Order hash mismatch');
  } else if (manifest.method !== 'identity' || order.length !== meta.counts.vertices || order.some((v, i) => v !== i)) {
    throw new Error('Order manifest has no output hash and the order is not the identity');
  }
  const presets = existsSync(new URL('presets.json.gz', dir)) ? JSON.parse(read('presets.json.gz')) : {};
  return {meta, a, order, presets, manifest};
}
