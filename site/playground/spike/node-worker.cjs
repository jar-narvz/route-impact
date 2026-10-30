/* worker_threads transport for the very same routing core used in the browser. */
const {parentPort, workerData} = require('node:worker_threads');
const {readFileSync} = require('node:fs');
const {gunzipSync} = require('node:zlib');
const core = require('./worker.js');
const read = name => readFileSync(new URL(name, workerData.base));
const start = performance.now(), meta = JSON.parse(read('meta.json'));
const fetched = performance.now();
const types = {'<f8': Float64Array, '<u4': Uint32Array, '<i4': Int32Array, u1: Uint8Array};
const buffers = new Map(meta.files.map(file => {
  const bytes = gunzipSync(read(file.file));
  return [file.file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)];
}));
const arrays = Object.fromEntries(meta.arrays.map(d =>
  [d.name, new types[d.dtype](buffers.get(d.file), d.byte_offset, d.length)]));
const json = file => JSON.parse(new TextDecoder().decode(buffers.get(file)));
const decoded = performance.now();
const info = core.initialize({meta, arrays, labels: json('trip_labels.json.gz'), presets: json('presets.json.gz')});
parentPort.postMessage({requestId: 0, landmarks: info, heap: process.memoryUsage(),
  timings: {fetch_meta_ms: fetched - start, read_decompress_ms: decoded - fetched, index_build_ms: performance.now() - decoded - info.precompute_ms,
    landmark_ms: info.precompute_ms, total_ms: performance.now() - start}});
parentPort.on('message', message => {
  try {
    const result = message.type === 'job' ? core.executeJob(message.job) :
      message.type === 'validatePaths' ? core.validatePaths(message.result) :
      message.type === 'bounds' ? core.validateBounds() :
      message.type === 'presetTimes' ? core.presetTimes(message) : core.advance(message);
    parentPort.postMessage({requestId: message.requestId, result});
  } catch (error) { parentPort.postMessage({requestId: message.requestId, error: error.stack}); }
});
