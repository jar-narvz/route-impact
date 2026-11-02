/** Page wiring checks with a tiny DOM/worker double; no map tiles or export required. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {createLatest} from '../latest.js';

const source = readFileSync(new URL('../../app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');

async function page(search = '?test&timing', latency = 100) {
  const nodes = new Map(), sent = [];
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.textContent = ''; this.listeners = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    setAttribute() {}
    addEventListener(name, fn) { this.listeners[name] = fn; }
    contains() { return false; }
    getContext() { return {getExtension: () => null}; }
    getBoundingClientRect() { return {width: 380}; }
  }
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  let clock = 0;
  const meta = {snapshot: 'test', git_commit: 'frozen-export', earth_radius_m: 6371008.8};
  class Worker {
    postMessage(message) {
      sent.push(message);
      let result = {};
      if (message.type === 'load') result = {meta, presets: [], load_ms: 0,
        baseline: {coords: [], offsets: [0]}};
      if (message.type === 'pick') result = {way_id: 123, oneway: true};
      if (message.type === 'edit') {
        const lines = {coords: [], offsets: [0], ids: []};
        result = {rows: [], display: {before: lines, after: lines, hit: lines}};
      }
      queueMicrotask(() => { clock += latency; this.onmessage({data: {id: message.id, ok: true, result}}); });
    }
    terminate() {}
  }
  const context = vm.createContext({
    createLatest, summarize: () => ({headline: 'Result', announcement: 'Result', trips: []}),
    document: {getElementById: get, createElement: () => new Element(), createTextNode: text => text,
      querySelectorAll: selector => selector === '[name="meteor-size"]'
        ? get('meteor-sizes').children.filter(x => x instanceof Element).map(label => label.children[0]) : [],
      documentElement: {dataset: {}}, activeElement: null},
    location: {search, href: `https://example.test/playground/${search}`},
    navigator: {userAgent: 'test-agent'}, window: {}, URLSearchParams, Worker,
    matchMedia: () => ({matches: false, addEventListener() {}}),
    performance: {now: () => clock++}, structuredClone, setTimeout, clearTimeout,
    requestAnimationFrame: callback => { queueMicrotask(() => callback(clock++)); return 1; },
    cancelAnimationFrame() {},
  });
  vm.runInContext(source + '\nglobalThis.pageTest = {state, runEdit, fireAt, runPhoneGate};', context);
  await context.window.__playground.ready;
  // These tests cover page/worker wiring; the browser harness covers MapLibre drawing.
  vm.runInContext('syncMap = () => {}; styleReady = true;', context);
  const radios = get('meteor-sizes').children.map(label => label.children[0]);
  return {context, hook: context.window.__playground, api: context.pageTest, get, radios, sent,
    plain: value => JSON.parse(JSON.stringify(value))};
}

test('Small default, selected Large and explicit radius share canonical request and ring centers', async () => {
  const p = await page();
  assert.deepEqual(p.radios.map(input => [input.value, input.checked]), [['500', true], ['1500', false]]);
  await p.hook.fireMeteor(37.787936, -122.407524);
  let request = p.sent.at(-1);
  assert.deepEqual(p.plain(request.edit), {weapon: 'meteor', lat: 37.78794, lon: -122.40752, radius_m: 500});
  assert.deepEqual(p.plain(request.tap), {lat: 37.78794, lon: -122.40752});
  p.radios[1].checked = true;
  p.radios[1].listeners.change();
  assert.equal(p.get('announcement').textContent, 'Meteor size: Large 1,500 m');
  await p.hook.fireMeteor(37.787936, -122.407524);
  request = p.sent.at(-1);
  assert.equal(request.edit.radius_m, 1500);
  assert.deepEqual(p.plain(p.api.state.meteorCenter.geometry.coordinates), [-122.40752, 37.78794]);
  const kx = 6371008.8 * Math.PI / 180 * Math.cos(37.78794 * Math.PI / 180);
  assert.deepEqual(p.plain(p.api.state.ring.geometry.coordinates[0][0]), [-122.40752 + 1500 / kx, 37.78794]);
  await p.hook.fireMeteor(37.825, -122.315, 500);
  assert.equal(p.sent.at(-1).edit.radius_m, 500);
  const before = p.sent.length;
  await assert.rejects(p.hook.fireMeteor(37.825, -122.315, 999), /Unsupported Meteor radius/);
  assert.equal(p.sent.length, before);
});

test('timing includes road picking and is absent without the timing flag', async () => {
  const p = await page();
  vm.runInContext('map = {getZoom: () => 10, easeTo() {}};', p.context);
  p.api.state.weapon = 'stomp';
  p.api.fireAt({lat: 37.825, lon: -122.315});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.sent.at(-2).type, 'pick');
  assert.equal(p.sent.at(-1).type, 'edit');
  assert.equal(p.sent.at(-1).started, p.sent.at(-2).started);
  assert.ok(p.api.state.fireMs >= 200);
  assert.equal(p.get('fire-timing').textContent, `fire → result: ${Math.round(p.api.state.fireMs)} ms`);
  const normal = await page('?test');
  await normal.hook.fireMeteor(37.825, -122.315);
  assert.equal(normal.api.state.fireMs, null);
  assert.equal(normal.get('fire-timing').hidden, true);
  assert.equal(normal.get('timing-tools').listeners.click, undefined);
});

test('phone gate runs each frozen Large center three times with resets and copyable medians', async () => {
  const p = await page();
  await p.api.runPhoneGate();
  const requests = p.sent.filter(message => message.type !== 'load');
  assert.deepEqual(requests.map(message => message.type), Array.from({length: 9}, () => ['edit', 'reset']).flat());
  assert.deepEqual(requests.filter(message => message.type === 'edit').map(message => p.plain(message.edit)),
    [[37.825, -122.315], [37.7946, -122.3999], [37.78794, -122.40752]].flatMap(([lat, lon]) =>
      Array.from({length: 3}, () => ({weapon: 'meteor', lat, lon, radius_m: 1500}))));
  const output = JSON.parse(p.get('phone-gate-json').value);
  assert.equal(output.export_git_commit, 'frozen-export');
  assert.equal(output.page_url, 'https://example.test/playground/?test&timing');
  assert.equal(output.user_agent, 'test-agent');
  assert.equal(output.radius_m, 1500);
  assert.equal(output.runs.length, 9);
  for (const [name, median] of Object.entries(output.medians)) {
    assert.equal(median, output.runs.filter(run => run.case === name).map(run => run.ms).sort((a, b) => a - b)[1]);
  }
  assert.equal(output.gate_ms, 2000);
  assert.equal(output.verdict, 'pass');
  assert.equal(p.api.state.phase, 'ready');
  assert.equal(p.api.state.gateRunning, false);
});

test('phone gate fails when any case median exceeds two seconds', async () => {
  const p = await page('?test&timing', 2100);
  await p.api.runPhoneGate();
  const output = JSON.parse(p.get('phone-gate-json').value);
  assert.equal(output.verdict, 'fail');
  assert.ok(Object.values(output.medians).every(ms => ms > 2000));
  assert.equal(output.runs.length, 9);
});
