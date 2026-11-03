/** Share grammar tests use only tiny, explicit lookups. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {parseShare, serializeShare} from '../share.js';

const options = {
  box: {min_lat: 37.2, max_lat: 38.1, min_lon: -122.6, max_lon: -121.7},
  sizes: [{radius_m: 500}, {radius_m: 1500}],
  presetNames: ['bay_bridge', 'university_ramp'],
  lookupWay: id => new Map([[1, {oneway: false}], [6320410, {oneway: true}],
    [999999999999999, {oneway: true}]]).get(id),
};

for (const [hash, edit] of [
  ['#stomp=1', {weapon: 'stomp', way_id: 1}],
  ['#stomp=999999999999999', {weapon: 'stomp', way_id: 999999999999999}],
  ['#flip=6320410', {weapon: 'flip', way_id: 6320410}],
  ['#meteor=37.78794,-122.40752,500', {weapon: 'meteor', lat: 37.78794, lon: -122.40752, radius_m: 500}],
  ['#meteor=37.2,-122.6,1500', {weapon: 'meteor', lat: 37.2, lon: -122.6, radius_m: 1500}],
  ['#meteor=38.1,-121.7,500', {weapon: 'meteor', lat: 38.1, lon: -121.7, radius_m: 500}],
  ['#preset=bay_bridge', {preset: 'bay_bridge'}],
  ['#preset=university_ramp', {preset: 'university_ramp'}],
]) {
  test(`round-trip ${hash}`, () => {
    assert.deepEqual(parseShare(hash, options), {ok: true, edit});
    assert.deepEqual(serializeShare(edit, options), {ok: true, edit, hash});
  });
}

for (const hash of [
  '', '#', '#stomp=', '#flip=', '#meteor=', '#preset=',
  '#stomp=01', '#stomp=0', '#flip=06320410', '#stomp=1000000000000000',
  '#stomp=10000000000000000', '#stomp=%31', '#preset=bay%5Fbridge',
  '#stomp=1&stomp=1', '#stomp=1&flip=6320410', '#stomp=1#flip=6320410',
  '#stomp=1junk', '#stomp=1\n', '#preset=bay_bridge!', '#stomp=-1', '#stomp=1.0',
  '#stomp=1e0', '#stomp=+1', '#stomp= 1', '#STOMP=1',
  '#meteor=NaN,-122.4,500', '#meteor=37.8,Infinity,500', '#meteor=37.8,-122.4,NaN',
  '#meteor=37.800001,-122.4,500', '#meteor=37.8,-122.400001,500',
  '#meteor=37.19999,-122.4,500', '#meteor=38.10001,-122.4,500',
  '#meteor=37.8,-122.60001,500', '#meteor=37.8,-121.69999,500',
  '#meteor=37.8,-122.4,999', '#meteor=37.8,-122.4,0500',
  '#meteor=37.8,-122.4,500x', '#meteor=37.8,-122.4,500,1',
  '#meteor=3.78e1,-122.4,500', '#preset=unknown', '#flip=1', '#stomp=2', '#flip=2',
  undefined, null, 123,
]) {
  test(`reject ${JSON.stringify(hash)}`, () => {
    assert.deepEqual(parseShare(hash, options), {ok: false, error: 'Invalid share link'});
  });
}

test('lookup failures and malformed edits return errors without throwing', () => {
  assert.equal(parseShare('#stomp=1', {...options, lookupWay() { throw new Error('bad lookup'); }}).ok, false);
  for (const edit of [null, {}, {weapon: 'flip', way_id: 1}, {weapon: 'stomp', way_id: 2},
    {weapon: 'meteor', lat: NaN, lon: -122.4, radius_m: 500}, {preset: 'unknown'}]) {
    assert.deepEqual(serializeShare(edit, options), {ok: false, error: 'Invalid share link'});
  }
});

// Exercise the real page wiring with tiny shipped-array/worker doubles, offline.
async function sharePage(hash = '') {
  const [{readFileSync}, vm, {gzipSync}, {createHash, webcrypto}, {createLatest}] = await Promise.all([
    import('node:fs'), import('node:vm'), import('node:zlib'), import('node:crypto'), import('../latest.js'),
  ]);
  const nodes = new Map(), sent = [], writes = [], reads = [], listeners = {};
  class Element {
    constructor() { this.children = []; this.style = {}; this.dataset = {}; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    setAttribute() {}
    contains() { return false; }
    addEventListener() {}
    getBoundingClientRect() { return {left: 0, top: 400, right: 375, width: 375, height: 812}; }
    getContext() { return {getExtension: () => null}; }
  }
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const arrays = {way_osm_id: new Float64Array([1, 6320410]), way_oneway: new Uint8Array([0, 1])};
  const packed = new Map(Object.entries(arrays).map(([name, array]) => [`${name}.bin.gz`, gzipSync(new Uint8Array(array.buffer))]));
  const meta = {box: options.box, earth_radius_m: 6371008.8,
    arrays: Object.entries(arrays).map(([name, array]) => ({name, length: array.length, file: `${name}.bin.gz`})),
    files: [...packed].map(([file, bytes]) => ({file, sha256: createHash('sha256').update(bytes).digest('hex')}))};
  const location = {hash, search: '?test&timing', pathname: '/playground/', href: ''};
  const update = value => {
    const url = new URL(value, 'https://example.test');
    Object.assign(location, {hash: url.hash, href: url.href});
  };
  update(location.pathname + location.search + hash);
  const window = {addEventListener: (name, fn) => { listeners[name] = fn; },
    history: {replaceState(_state, _title, url) { writes.push(url); update(url); }}};
  class Worker {
    postMessage(message) {
      sent.push(message);
      let result = {};
      if (message.type === 'load') result = {meta, presets: options.presetNames.map(name => ({name, label: name})),
        baseline: {coords: [], offsets: [0]}};
      if (message.type === 'edit') {
        const lines = {coords: [], offsets: [0], ids: []};
        result = {rows: [], display: {before: lines, after: lines, hit: lines}};
      }
      queueMicrotask(() => this.onmessage({data: {id: message.id, ok: true, result}}));
    }
    terminate() {}
  }
  const context = vm.createContext({window, location, URL, URLSearchParams, Worker,
    parseShare, serializeShare, createLatest,
    summarize: () => ({headline: 'Result', announcement: 'Result', trips: []}),
    document: {getElementById: get, createElement: () => new Element(), createTextNode: text => text,
      querySelector: get, querySelectorAll: () => [], documentElement: {dataset: {}}},
    matchMedia: () => ({matches: false, addEventListener() {}}),
    performance: {now: () => 0}, setTimeout, clearTimeout,
    crypto: webcrypto, Response, Blob, DecompressionStream,
    fetch: async url => { reads.push(url); return new Response(packed.get(url.replace('./data/', ''))); },
  });
  const source = readFileSync(new URL('../../app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInContext(source + `
    const originalReplay = replayShare;
    replayShare = hash => { globalThis.replayPromise = originalReplay(hash); return replayPromise; };
    globalThis.api = {state, runEdit, rebuild};
  `, context);
  const settle = async () => {
    await new Promise(resolve => setImmediate(resolve));
    await context.replayPromise;
    await new Promise(resolve => setImmediate(resolve));
  };
  await settle();
  return {context, sent, writes, reads, location, get, settle,
    async change(hash) { update(location.pathname + location.search + hash); listeners.hashchange({newURL: location.href}); await settle(); },
    plain: value => JSON.parse(JSON.stringify(value))};
}

for (const [hash, edit] of [
  ['#stomp=1', {weapon: 'stomp', way_id: 1}],
  ['#flip=6320410', {weapon: 'flip', way_id: 6320410}],
  ['#meteor=37.78794,-122.40752,1500', {weapon: 'meteor', lat: 37.78794, lon: -122.40752, radius_m: 1500}],
  ['#preset=bay_bridge', {preset: 'bay_bridge', label: 'Bay Bridge'}], // same title as the preset button
]) {
  test(`page replays ${hash} once after load and writes without replay`, async () => {
    const p = await sharePage(hash);
    assert.deepEqual(p.sent.map(message => message.type), ['load', 'edit']);
    assert.deepEqual(p.plain(p.sent[1].edit), edit);
    assert.equal(p.location.hash, hash);
    assert.deepEqual(p.writes, ['/playground/?test&timing' + hash]);
    assert.equal(p.get('share-link').href, hash);
    assert.equal(p.context.api.state.phase, 'showing');
    assert.equal(p.reads.length, edit.way_id ? 2 : 0);
  });
}

test('pasted hashes replay once each; three commits use replaceState and Rebuild clears the hash', async () => {
  const p = await sharePage();
  for (const hash of ['#preset=bay_bridge', '#preset=university_ramp', '#meteor=37.8,-122.4,500']) await p.change(hash);
  assert.deepEqual(p.sent.map(message => message.type), ['load', 'edit', 'edit', 'edit']);
  assert.equal(p.writes.length, 3);
  p.context.api.rebuild();
  await p.settle();
  assert.equal(p.location.hash, '');
  assert.equal(p.get('share-link').hidden, true);
  assert.equal(p.context.api.state.phase, 'ready');
  assert.equal(p.sent.at(-1).type, 'reset');
});

for (const hash of ['#flip=1', '#stomp=2', '#stomp=%31', '#preset=unknown']) {
  test(`invalid page link ${hash} clears to the normal page with a notice`, async () => {
    const p = await sharePage(hash);
    assert.equal(p.location.hash, '');
    assert.deepEqual(p.sent.map(message => message.type), ['load', 'reset']);
    assert.equal(p.context.api.state.phase, 'ready');
    assert.equal(p.get('share-notice').textContent, 'This share link is invalid or unavailable. Pick a new edit.');
  });
}

test('Rebuild and a newer edit cancel a road replay waiting for its lookup', async () => {
  const p = await sharePage();
  const vm = await import('node:vm');
  vm.runInContext('loadWayLookup = () => new Promise(resolve => { globalThis.resolveLookup = resolve; });', p.context);
  const changing = p.change('#stomp=1');
  p.context.api.rebuild();
  p.context.resolveLookup(() => ({oneway: true}));
  await changing;
  assert.equal(p.sent.filter(message => message.type === 'edit').length, 0);
  assert.equal(p.location.hash, '');
  const next = p.change('#stomp=1');
  p.context.api.runEdit({preset: 'bay_bridge'});
  p.context.resolveLookup(() => ({oneway: true}));
  await next;
  assert.deepEqual(p.sent.filter(message => message.type === 'edit').map(message => p.plain(message.edit)), [{preset: 'bay_bridge'}]);
  assert.equal(p.location.hash, '#preset=bay_bridge');
});
