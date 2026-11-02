/** Page wiring checks with a tiny DOM/worker double; no map tiles or export required. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {createLatest} from '../latest.js';

const source = readFileSync(new URL('../../app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');

async function page(search = '?test&timing', latency = 100, manual = false) {
  const nodes = new Map(), sent = [], frames = new Map(), timers = new Map(), replies = new Map(), workers = [], drawing = [], media = new Map();
  let handle = 0, cancelledFrames = 0;
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.writes = []; this.textContent = ''; this.listeners = {}; }
    set textContent(value) { this.text = value; this.writes.push(value); }
    get textContent() { return this.text; }
    append(...children) { this.children.push(...children); for (const child of children) if (child instanceof Element) child.parent = this; }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    replaceChildren() { this.children = []; }
    setAttribute() {}
    addEventListener(name, fn) { this.listeners[name] = fn; }
    contains() { return false; }
    getContext(kind) {
      if (kind !== '2d') return {getExtension: () => null};
      return Object.fromEntries(['beginPath', 'arc', 'stroke', 'fill', 'lineTo', 'moveTo']
        .map(name => [name, (...args) => drawing.push([name, ...args])]));
    }
    getBoundingClientRect() { return {width: 380}; }
  }
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  let clock = 0;
  const meta = {snapshot: 'test', git_commit: 'frozen-export', earth_radius_m: 6371008.8, geometry_scale: 1000000};
  class Worker {
    constructor() { workers.push(this); }
    postMessage(message) {
      sent.push(message);
      let result = {};
      if (message.type === 'load') result = {meta, presets: [], load_ms: 0,
        baseline: {coords: [], offsets: [0]}};
      if (message.type === 'pick') result = {way_id: 123, oneway: true, line: [[0, 0], [1, 0]]};
      if (message.type === 'edit') {
        const lines = {coords: [0, 0, 1, 0], offsets: [0, 2], ids: [123]};
        result = {rows: [], display: {before: lines, after: lines, hit: lines}};
      }
      const reply = () => { clock += latency; this.onmessage({data: {id: message.id, ok: true, result}}); };
      if (manual && message.type !== 'load') replies.set(message.id, reply);
      else queueMicrotask(reply);
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
    matchMedia: query => {
      if (!media.has(query)) media.set(query, {matches: false, addEventListener(name, fn) { this.change = fn; }});
      return media.get(query);
    },
    performance: {now: () => manual ? clock : clock++}, structuredClone,
    setTimeout: manual ? (fn, ms) => { const id = ++handle; timers.set(id, {fn, at: clock + ms}); return id; } : setTimeout,
    clearTimeout: manual ? id => timers.delete(id) : clearTimeout,
    requestAnimationFrame: callback => {
      if (manual) { const id = ++handle; frames.set(id, callback); return id; }
      queueMicrotask(() => callback(clock++)); return 1;
    },
    cancelAnimationFrame(id) { if (frames.delete(id)) cancelledFrames++; },
  });
  vm.runInContext(source + '\nglobalThis.pageTest = {state, runEdit, fireAt, runPhoneGate, METEOR_SIZES};', context);
  await context.window.__playground.ready;
  // These tests cover page/worker wiring; the browser harness covers MapLibre drawing.
  vm.runInContext('syncMap = () => {}; styleReady = true;', context);
  const radios = get('meteor-sizes').children.map(label => label.children[0]);
  get('announcement').writes = [];
  return {frames, timers, replies, workers, drawing, media,
    installMap() { vm.runInContext(`map = {getZoom: () => 10, easeTo() {},
      getSource: () => ({setData() {}}), project: ([lon, lat]) => ({x: lon*100, y: lat*100})};`, context); }, cancelledFrames: () => cancelledFrames,
    async advance(ms) {
      clock += ms;
      const batch = [...frames.values()]; frames.clear();
      for (const fn of batch) fn(clock);
      for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
      await new Promise(resolve => setImmediate(resolve));
    },
    async reply(id = sent.at(-1).id) { replies.get(id)(); replies.delete(id); await new Promise(resolve => setImmediate(resolve)); },
    context, hook: context.window.__playground, api: context.pageTest, get, radios, sent,
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


test('Meteor duration comes from its radius; fast results wait for the animation deadline', async () => {
  for (const [radius, duration] of [[500, 600], [1500, Math.round(600*Math.sqrt(3))]]) {
    const p = await page('?test', 0, true);
    assert.equal(p.api.METEOR_SIZES.find(size => size.radius_m === radius).duration_ms, duration);
    const result = p.hook.fireMeteor(37.825, -122.315, radius);
    assert.equal(p.hook.animationsRunning(), true);
    await p.reply();
    assert.equal(p.api.state.result, null);
    assert.equal(p.api.state.drawn, null);
    assert.deepEqual(p.get('announcement').writes, []);
    await p.advance(duration - 1);
    assert.equal(p.api.state.phase, 'pending');
    await p.advance(1);
    await result;
    assert.equal(p.api.state.phase, 'showing');
    assert.equal(p.api.state.drawn.hit.features.length, 1);
    assert.deepEqual(p.get('announcement').writes, ['Result']);
    assert.equal(p.frames.size, 0);
    assert.equal(p.timers.size, 0);
  }
});

test('slow results reveal immediately after arrival with no animation loop', async () => {
  const p = await page('?test', 0, true);
  const result = p.hook.fireMeteor(37.825, -122.315);
  await p.advance(600);
  const count = p.hook.animationFramesScheduled();
  await p.advance(5000);
  assert.equal(p.hook.animationFramesScheduled(), count);
  assert.equal(p.api.state.result, null);
  await p.reply();
  await p.advance(0);
  await result;
  assert.equal(p.api.state.phase, 'showing');
});

test('a replacement tap and Rebuild invalidate queued results and animation callbacks', async () => {
  const p = await page('?test', 0, true);
  const first = p.hook.fireMeteor(37.825, -122.315).catch(error => error.message);
  await p.reply();
  await p.advance(100);
  const second = p.hook.fireMeteor(37.7946, -122.3999);
  assert.equal(await first, 'Edit cancelled');
  await p.reply();
  await p.advance(500);
  assert.equal(p.api.state.result, null);
  await p.advance(100);
  await second;
  assert.deepEqual(p.get('announcement').writes, ['Result']);
  const third = p.hook.fireMeteor(37.825, -122.315).catch(error => error.message);
  const staleId = p.sent.at(-1).id;
  const reset = p.hook.rebuild();
  assert.equal(await third, 'Edit cancelled');
  await p.reply(staleId);
  await p.reply();
  await p.advance(2000);
  await reset;
  assert.equal(p.api.state.phase, 'ready');
  assert.equal(p.api.state.result, null);
  assert.equal(p.api.state.ring, null);
  assert.deepEqual(p.get('announcement').writes, ['Result', '']);
  assert.equal(p.frames.size, 0);
  assert.equal(p.timers.size, 0);
  assert.ok(p.cancelledFrames() >= 2);
});

test('reduced motion schedules no frames, draws a full ring, and can finish an active edit', async () => {
  const p = await page('?test', 0, true);
  p.hook.setReducedMotion(true);
  const result = p.hook.fireMeteor(37.825, -122.315, 1500);
  assert.equal(p.frames.size, 0);
  assert.equal(p.hook.animationFramesScheduled(), 0);
  assert.equal(p.hook.staticOutline(), true);
  const kx = 6371008.8*Math.PI/180*Math.cos(37.825*Math.PI/180);
  assert.deepEqual(p.plain(p.api.state.ring.geometry.coordinates[0][0]), [-122.315 + 1500/kx, 37.825]);
  await p.reply(); await p.advance(0); await result;
  p.hook.setReducedMotion(false);
  const second = p.hook.fireMeteor(37.825, -122.315);
  await p.reply();
  assert.equal(p.api.state.phase, 'pending');
  p.hook.setReducedMotion(true);
  await p.advance(0); await second;
  assert.equal(p.api.state.phase, 'showing');
  assert.equal(p.hook.animationsRunning(), false);
  assert.equal(p.frames.size, 0);
});

test('Stomp and Flip pulse before picking and start road effects only after the pick', async () => {
  for (const weapon of ['stomp', 'flip']) {
    const p = await page('?test', 0, true);
    vm.runInContext('map = {getZoom: () => 10, easeTo() {}};', p.context);
    p.api.state.weapon = weapon;
    p.api.fireAt({lat: 37.825, lon: -122.315});
    assert.equal(p.sent.at(-1).type, 'pick');
    assert.equal(p.hook.animationsRunning(), true);
    await p.advance(200);
    await p.reply();
    assert.equal(p.sent.at(-1).type, 'edit');
    assert.equal(p.sent.at(-1).token, p.sent.at(-2).token);
    await p.reply();
    await p.advance(499);
    assert.equal(p.api.state.result, null);
    await p.advance(1);
    assert.equal(p.api.state.phase, 'showing');
    assert.equal(p.frames.size, 0);
  }
});


test('worker errors cancel frames, timers and staged results, including stale replies', async () => {
  for (const kind of ['onerror', 'onmessageerror', 'reply']) {
    const p = await page('?test', 0, true);
    const result = p.hook.fireMeteor(37.825, -122.315).catch(error => error.message);
    const id = p.sent.at(-1).id;
    if (kind !== 'reply') await p.reply();
    const worker = p.workers[0];
    if (kind === 'reply') worker.onmessage({data: {id, ok: false, error: 'broken'}});
    else worker[kind]({preventDefault() {}, message: 'broken'});
    assert.equal(typeof await result, 'string');
    await p.advance(2000);
    assert.equal(p.api.state.phase, 'error');
    assert.equal(p.api.state.result, null);
    assert.equal(p.hook.animationsRunning(), false);
    assert.equal(p.frames.size, 0);
    assert.equal(p.timers.size, 0);
    assert.deepEqual(p.get('announcement').writes, []);
    worker.onmessage({data: {id, ok: true, result: {}}});
    assert.equal(p.api.state.phase, 'error');
  }
});


test('canvas draws an immediate pulse, falling Meteor, steady road highlight and reverse sweep', async () => {
  const meteor = await page('?test', 0, true);
  meteor.installMap();
  const result = meteor.hook.fireMeteor(0, 0);
  assert.deepEqual(meteor.drawing.filter(row => row[0] === 'arc'),
    [['arc', 0, 0, 8, 0, Math.PI*2], ['arc', 0, -200, 12, 0, Math.PI*2]]);
  await meteor.reply(); await meteor.advance(600); await result;
  assert.equal(meteor.get('map').children.length, 0);
  for (const weapon of ['stomp', 'flip']) {
    const p = await page('?test', 0, true);
    p.installMap(); p.api.state.weapon = weapon;
    p.api.fireAt({lat: 0, lon: 0});
    assert.deepEqual(p.drawing, [['beginPath'], ['arc', 0, 0, 8, 0, Math.PI*2], ['stroke']]);
    await p.advance(100);
    p.drawing.length = 0;
    await p.reply();
    if (weapon === 'stomp') {
      assert.deepEqual(p.drawing.slice(-4), [['beginPath'], ['moveTo', 0, 0], ['lineTo', 100, 0], ['stroke']]);
    } else {
      assert.ok(p.drawing.some(row => JSON.stringify(row) === JSON.stringify(['lineTo', 100, 0])));
      p.drawing.length = 0;
      await p.advance(250);
      assert.ok(p.drawing.some(row => JSON.stringify(row) === JSON.stringify(['lineTo', 80, 0])));
    }
    await p.reply(); await p.advance(500);
    assert.equal(p.get('map').children.length, 0);
  }
});

test('a native reduced-motion change cancels the active animation and draws its final state', async () => {
  const p = await page('?test', 0, true);
  const result = p.hook.fireMeteor(37.825, -122.315);
  await p.reply();
  const preference = p.media.get('(prefers-reduced-motion: reduce)');
  preference.matches = true;
  preference.change();
  await result;
  assert.equal(p.frames.size, 0);
  assert.equal(p.timers.size, 0);
  assert.equal(p.hook.staticOutline(), true);
  assert.equal(p.api.state.phase, 'showing');
});
