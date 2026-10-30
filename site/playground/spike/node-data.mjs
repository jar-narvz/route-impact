import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
export const root = new URL('../../../', import.meta.url);
export const data = new URL('data/playground-spike/', root);
export const read = name => readFileSync(new URL(name, data));
export const json = url => JSON.parse(readFileSync(url));
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function load() {
  const meta = JSON.parse(read('meta.json')), a = {};
  const types = {'<f8': Float64Array, '<u4': Uint32Array, '<i4': Int32Array, u1: Uint8Array};
  for (const spec of meta.arrays) {
    const packed = read(spec.file);
    const expectedHash = meta.files.find(f => f.file === spec.file)?.sha256;
    if (expectedHash && sha(packed) !== expectedHash) throw new Error(`Hash mismatch ${spec.file}`);
    const raw = gunzipSync(packed);
    a[spec.name] = new types[spec.dtype](raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    if (a[spec.name].length !== spec.length) throw new Error(`Length mismatch ${spec.name}`);
  }
  const raw = gunzipSync(read('cch_order.bin.gz'));
  const manifest = JSON.parse(gunzipSync(read('order_manifest.json.gz')));
  if (sha(read('cch_order_input.bin')) !== manifest.input_sha256) throw new Error('Canonical input hash mismatch');
  if (sha(raw) !== manifest.output_sha256) throw new Error('Order hash mismatch');
  return {meta, a, order: new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)),
    presets: JSON.parse(gunzipSync(read('presets.json.gz'))), manifest};
}
