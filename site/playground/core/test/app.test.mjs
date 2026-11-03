/** Page wiring checks with a tiny DOM/worker double; no map tiles or export required. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {createLatest} from '../latest.js';
import {monochrome} from '../mono.js';
import {parseShare} from '../share.js';

const source = readFileSync(new URL('../../app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');

async function page(search = '?test&timing', latency = 100, manual = false, hash = '') {
  const nodes = new Map(), sent = [], frames = new Map(), timers = new Map(), replies = new Map(), workers = [], drawing = [], media = new Map();
  let handle = 0, cancelledFrames = 0, focused;
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.writes = []; this.textContent = ''; this.listeners = {}; this.style = {}; this.classList = {add() {}, remove() {}}; this.rect = {left: 0, top: 0, width: 375, height: 812, right: 375, bottom: 812}; }
    set textContent(value) { this.text = value; this.writes.push(value); }
    get textContent() { return this.children.length ? this.children.map(child => child instanceof Element ? child.textContent : child).join('') : this.text; }
    append(...children) { this.children.push(...children); for (const child of children) if (child instanceof Element) child.parent = this; }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    replaceChildren(...children) { this.children = []; this.text = ''; this.append(...children); }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    focus() { focused = this; }
    setPointerCapture() {}
    get firstElementChild() { return this.children[0] ?? (this.children[0] = new Element()); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    contains(node) { return this === node || this.children.some(child => child instanceof Element && child.contains(node)); }
    querySelector(tag) { return this.querySelectorAll(tag)[0] ?? null; }
    querySelectorAll(tag) { return this.children.filter(child => child instanceof Element).flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
    getContext(kind) {
      return {getExtension: () => null};
    }
    getBoundingClientRect() { return this.rect; }
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
    monochrome, AbortController, parseShare, createLatest, summarize: () => ({headline: 'Result', announcement: 'Result', trips: []}),
    document: {addEventListener() {}, removeEventListener() {}, getElementById: get, createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: text => text,
      querySelector: selector => get(selector),
      querySelectorAll: selector => selector === '[data-weapon]' ? ['stomp','flip','meteor'].map(weapon => { const button = get(`[data-weapon="${weapon}"]`); button.dataset.weapon = weapon; return button; }) : selector === '[name="meteor-size"]'
        ? get('meteor-sizes').children.filter(x => x instanceof Element).map(label => label.children[0]) : [],
      documentElement: {dataset: {}, style: {setProperty() {}}}, get activeElement() { return focused; }},
    location: {search, hash, href: `https://example.test/playground/${search}`},
    navigator: {userAgent: 'test-agent'}, window: {listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }}, URLSearchParams, Worker,
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
  vm.runInContext(source + '\nglobalThis.pageTest = {state, runEdit, fireAt, runPhoneGate, runPerfCheck, METEOR_SIZES, setHeight, showHome, fetchStyle, setTheme, enableMousePitch, renderResults, renderStatus, renderProgress, addOverlays, positionCrosshair, fitResult, collapseAttribution, createMap, ensureFx, loadNetwork, startPreset, onMapClick};', context);
  await new Promise(resolve => setImmediate(resolve));
  // These tests cover page/worker wiring; the browser harness covers MapLibre drawing.
  context.fxDouble = {ring: (...args) => drawing.push(['ring', ...args]), fire: options => { drawing.push(['fire',options]); return options.duration; },
    clear: () => drawing.push(['clear']), settle: () => drawing.push(['settle']), rebuild: () => drawing.push(['rebuild'])};
  vm.runInContext('syncMap = () => {}; styleReady = true; fx = fxDouble;', context);
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
    focus: () => focused, context, hook: context.window.__playground, api: context.pageTest, get, radios, sent,
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
  for (const [radius, duration] of [[500, 600], [1500, 1040]]) {
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


test('FX gets an immediate metre ring, scaled Meteor and picked road geometry', async () => {
  for (const [radius,scale,duration] of [[500,1,600],[1500,Math.sqrt(3),1040]]) {
    const p = await page('?test',0,true);
    p.installMap(); p.drawing.length=0;
    const result=p.hook.fireMeteor(5,0,radius);
    assert.deepEqual(p.plain(p.drawing[2]), ['ring',[0,5],40,180]);
    const fire=p.drawing.find(row => row[0]==='fire')[1];
    assert.deepEqual(p.plain(fire), {weapon:'meteor',lngLat:[0,5],radius,scale,duration,line:null,still:false});
    await p.reply(); await p.advance(duration); await result;
    assert.equal(p.hook.animationsRunning(),false);
    assert.equal(p.drawing.filter(row => row[0]==='clear').length,1);
  }
  for (const weapon of ['stomp','flip']) {
    const p=await page('?test',0,true); p.installMap(); p.api.state.weapon=weapon;
    p.drawing.length=0; p.api.fireAt({lat:0,lon:0});
    assert.deepEqual(p.plain(p.drawing.at(-1)),['ring',[0,0],40,180]);
    assert.equal(p.drawing.some(row => row[0]==='fire'),false);
    await p.advance(100); await p.reply();
    const fire=p.drawing.find(row => row[0]==='fire')[1];
    assert.deepEqual(p.plain(fire.line),[[0,0],[1,0]]);
    assert.equal(fire.weapon,weapon); assert.equal(fire.seed,123); assert.equal(fire.duration,500);
    await p.reply(); await p.advance(500);
    assert.equal(p.hook.animationsRunning(),false);
    assert.equal(p.drawing.filter(row => row[0]==='clear').length,1);
    p.hook.rebuild(); await p.reply();
    assert.equal(p.drawing.at(-1)[0],'rebuild');
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

test('crosshair follows live sheet bounds at phone heights and desktop breakpoint', async () => {
  const p = await page();
  vm.runInContext('map = {unproject: ([x, y]) => ({lng: x / 100, lat: y / 100})};', p.context);
  const sheet = p.get('sheet'), bounds = p.get('map').rect;
  const overlay = p.get('.crosshair');
  const check = (x, y) => {
    assert.equal(overlay.style.left, `${bounds.left + x}px`);
    assert.equal(overlay.style.top, `${bounds.top + y}px`);
    assert.deepEqual(p.plain(p.hook.crosshairPoint()), {x, y, lng: x / 100, lat: y / 100});
  };
  for (const [height, top] of [['summary', 644], ['details', 72]]) {
    // setHeight must read the animated rectangle, then transitionend reads its final edge.
    sheet.rect.top = 500;
    p.api.setHeight(height);
    check(187.5, 250);
    sheet.rect.top = top;
    sheet.listeners.transitionend({target: sheet, propertyName: 'height'});
    check(187.5, top / 2);
  }
  const desktop = p.media.get('(min-width: 900px)');
  sheet.rect.right = 396;
  p.get('panel').rect.right = 396;
  for (const [width, isDesktop, x, y] of [[1280, true, 846, 400], [899, false, 449.5, 36],
    [900, true, 656, 400]]) {
    Object.assign(bounds, {width, height: 800});
    desktop.matches = isDesktop;
    desktop.change({matches: isDesktop});
    check(x, y);
    bounds.width += 20;
    p.context.window.listeners.resize();
    check(x + 10, y);
  }
  // Map pixels exclude the container's viewport offset; the fixed overlay includes it.
  Object.assign(bounds, {left: 20, top: 30, width: 900, height: 800});
  desktop.change({matches: true});
  check(646, 400);
});

test('Enter fires every selected weapon at the crosshair unprojection; pan and zoom stay unchanged', async () => {
  for (const weapon of ['stomp', 'flip', 'meteor']) {
    const p = await page();
    vm.runInContext(`globalThis.moves = []; map = {
      unproject: ([x, y]) => ({lng: -122 + x / 10000, lat: 37 + y / 10000}),
      getZoom: () => 10, easeTo() {}, getSource: () => ({setData() {}}),
      panBy: (delta, options) => moves.push(['pan', delta, options]),
      zoomIn: options => moves.push(['in', options]), zoomOut: options => moves.push(['out', options])
    };`, p.context);
    p.get('sheet').rect.top = 406;
    p.api.setHeight('details');
    p.api.state.weapon = weapon;
    const point = p.hook.crosshairPoint();
    let prevented = 0;
    const key = value => p.get('map').listeners.keydown({target: p.get('map'), key: value,
      preventDefault() { prevented++; }});
    key('Enter');
    const request = p.sent.at(-1);
    assert.equal(request.type, weapon === 'meteor' ? 'edit' : 'pick');
    assert.deepEqual(p.plain(request.tap), {lat: point.lat, lon: point.lng});
    for (const value of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-']) key(value);
    assert.deepEqual(p.plain(p.context.moves), [
      ...[[-100, 0], [100, 0], [0, -100], [0, 100]].map(delta => ['pan', delta, {duration: 200}]),
      ['in', {duration: 200}], ['in', {duration: 200}], ['out', {duration: 200}]]);
    p.hook.setReducedMotion(true);
    key('ArrowLeft'); key('+'); key('-');
    assert.deepEqual(p.plain(p.context.moves.slice(-3)), [
      ['pan', [-100, 0], {duration: 0}], ['in', {duration: 0}], ['out', {duration: 0}]]);
    assert.equal(prevented, 11);
    await new Promise(resolve => setImmediate(resolve));
  }
});


test('home focus, Start, Back and bypass rules', async () => {
  const home = await page('', 0, true);
  assert.equal(home.api.state.home, true);
  assert.equal(home.get('game').inert, true);
  assert.equal(home.context.document.documentElement.dataset.home, 'true');
  assert.equal(home.focus(), home.get('start'));
  home.get('start').listeners.click();
  assert.equal(home.get('game').inert, false);
  assert.equal(home.context.document.documentElement.dataset.home, 'false');
  await home.advance(220);
  assert.equal(home.focus(), home.get('[data-weapon="stomp"]'));
  home.get('back').listeners.click();
  assert.equal(home.focus(), home.get('start'));
  assert.equal((await page('?test')).api.state.home, false);
  for (const key of ['stomp', 'flip', 'meteor']) {
    // Keep replay pending: bypass is decided before the worker returns metadata.
    const linked = await page('', 0, false, `#${key}=`);
    assert.equal(linked.api.state.home, false);
  }
});

test('progress has no request id and does not consume the latest request', async () => {
  const p = await page();
  const worker = p.workers[0], count = p.sent.length;
  worker.onmessage({data: {type: 'progress', loaded_bytes: 62, total_bytes: 100}});
  assert.equal(p.get('start-progress').style.transform, 'scaleX(0.62)');
  assert.equal(p.get('start-progress')['aria-valuenow'], '62');
  assert.equal(p.api.state.phase, 'ready');
  assert.equal(p.sent.length, count);
  const result = p.hook.fireMeteor(37.825, -122.315);
  await result;
  assert.equal(p.api.state.phase, 'showing');
});

test('Details controls only the collapsible region', async () => {
  const p = await page();
  p.get('details-button').listeners.click();
  assert.equal(p.get('details-button')['aria-expanded'], 'true');
  assert.equal(p.get('details-label').textContent, 'Hide details');
  assert.equal(p.get('details-content').inert, false);
  p.get('details-button').listeners.click();
  assert.equal(p.get('details-button')['aria-expanded'], 'false');
  assert.equal(p.get('details-label').textContent, 'Details');
  assert.equal(p.get('details-content').inert, true);
  assert.notEqual(p.get('details-button').inert, true);
});


test('style loading cancels older themes and adds buildings from the actual source id', async () => {
  const p = await page();
  const requests = [];
  p.context.fetch = (url, options) => new Promise(resolve => requests.push({url,options,resolve}));
  const first = p.api.fetchStyle('dark'), second = p.api.fetchStyle('light');
  assert.equal(requests[0].options.signal.aborted, true);
  const style = {sources:{tiles:{type:'vector'}},layers:[
    {id:'buildings',type:'fill',source:'tiles','source-layer':'building',paint:{'fill-color':'#f00'}},
    {id:'labels',type:'symbol',layout:{'text-field':['get','name']}},
  ]};
  requests[1].resolve({ok:true,json:async()=>structuredClone(style)});
  const output = await second;
  assert.equal(output.layers[1].id,'playground-buildings');
  assert.equal(output.layers[1].source,'tiles');
  assert.equal(output.layers[1].minzoom,14);
  assert.equal(output.layers[1].paint['fill-extrusion-color'],'#e6e6e6');
  assert.equal(output.layers[1].paint['fill-extrusion-vertical-gradient'],true);
  assert.deepEqual(p.plain(output.layers[2].layout),style.layers[1].layout);
  assert.equal(output.layers[2].id,'labels');
  assert.notEqual(output.layers[0].paint['fill-color'],'#f00');
  requests[0].resolve({ok:true,json:async()=>structuredClone(style)});
  assert.equal(await first,null);
  p.context.fetch=async () => ({ok:true,json:async()=>structuredClone(style)});
  const dark=await p.api.fetchStyle('dark');
  assert.equal(dark.layers[1].paint['fill-extrusion-color'],'#1a1a1a');
  assert.equal(dark.layers[1].paint['fill-extrusion-vertical-gradient'],true);
  assert.deepEqual(p.plain(dark.layers[2].layout),style.layers[1].layout);
  p.context.fetch = async () => { throw new Error('offline'); };
  assert.equal(await p.api.fetchStyle('dark'),'https://tiles.openfreemap.org/styles/dark');
});

test('right and Ctrl drag change only pitch and clamp it to 0 through 60', async () => {
  const p = await page(), canvas = p.get('pitch-canvas'), pitches = [];
  p.api.enableMousePitch({getCanvas:()=>canvas,getPitch:()=>30,setPitch:pitch=>pitches.push(pitch)});
  for(const down of [{button:2,ctrlKey:false},{button:0,ctrlKey:true}]) {
    let prevented = 0;
    canvas.listeners.pointerdown({...down,pointerId:1,clientY:100,preventDefault(){prevented++;},stopPropagation(){}});
    canvas.listeners.pointermove({pointerId:1,clientY:20,preventDefault(){}});
    canvas.listeners.pointermove({pointerId:1,clientY:200,preventDefault(){}});
    canvas.listeners.pointerup({pointerId:1});
    canvas.listeners.pointermove({pointerId:1,clientY:0});
    assert.equal(prevented,1);
  }
  assert.deepEqual(pitches,[60,0,60,0]);
});

test('road rows truncate names, keep a separate OSM control and expand beyond five', async () => {
  const p = await page();
  const rows = Array.from({length:7},(_,i)=>({name:`Road ${i}`,ways:[{way_id:i+1}],caption:`1 road · ${7-i} trips`,share:(7-i)/7}));
  p.api.state.summary = {trips:[],mattered:{rows,more_text:'Show all 7 groups',several_together:0}};
  p.api.renderResults();
  const roads = p.get('roads');
  assert.equal(roads.children.filter(child=>child.className==='road-row').length,5);
  const row = roads.children[1], button = row.children[0], link = row.children[1];
  assert.equal(button.title,'Road 0');
  assert.equal(button['aria-label'],'Road 0, 1 road · 7 trips');
  assert.equal(button.children[0].className,'road-name');
  assert.equal(button.children[2].style.width,'100%');
  assert.equal(link.href,'https://www.openstreetmap.org/way/1');
  assert.equal(link['aria-label'],'Open Road 0 on OpenStreetMap');
  assert.equal(roads.children.at(-1).textContent,'Show all 7 groups');
  roads.children.at(-1).listeners.click();
  assert.equal(roads.children.filter(child=>child.className==='road-row').length,7);
});

test('Start progress exists only while loading and status never shows 100 percent', async () => {
  const p = await page();
  p.api.state.phase = 'loading';
  p.api.renderProgress({loaded_bytes: 50, total_bytes: 100});
  assert.equal(p.get('start-progress').hidden, false);
  assert.equal(p.get('status').textContent, 'Loading roads 50%');
  p.api.renderProgress({loaded_bytes: 100, total_bytes: 100});
  assert.equal(p.get('status').textContent, 'Preparing roads…');
  p.api.state.phase = 'ready';
  p.api.renderStatus();
  assert.equal(p.get('start-progress').hidden, true);
  assert.equal(p.get('progress').hidden, true);
  assert.equal(p.get('status').textContent, 'Tap a road to close it');
});

test('route overlays stay thin and destroyed roads render above affected paths', async () => {
  const p = await page(), layers = [];
  p.api.state.meta.box = {min_lat: 0, min_lon: 0, max_lat: 1, max_lon: 1};
  p.context.getComputedStyle = () => ({getPropertyValue: name => name});
  p.api.addOverlays({getStyle: () => ({layers: []}), getSource: () => null,
    addSource() {}, moveLayer() {}, getLayer: () => null, addLayer: layer => layers.push(layer)});
  const before = layers.find(layer => layer.id === 'before'), after = layers.find(layer => layer.id === 'after');
  assert.equal(before.paint['line-width'], 1.5);
  assert.equal(before.paint['line-color'], '--fg-3');
  assert.deepEqual(p.plain(after.paint['line-width']), 3);
  assert.equal(after.paint['line-opacity'], 0.85);
  const hit = layers.find(layer => layer.id === 'hit');
  assert.equal(hit.paint['line-width'], 4);
  assert.equal(hit.paint['line-color'], '--broken');
  assert.ok(layers.indexOf(hit) > layers.indexOf(after));
});

test('home prose stays in Geist and stats are separate items', async () => {
  const p = await page('');
  p.api.state.meta = {snapshot: '261027', counts: {trips: 2057, ways: 214}};
  p.api.setHeight('summary');
  assert.equal(p.get('home-description').children.length, 0);
  assert.equal(p.get('home-description').textContent, '2,057 real trips across the Bay Area, routed in your browser on OpenStreetMap data from 27 Oct 2026. Close a road and see which trips detour, which break, and which road caused it.');
  assert.deepEqual(p.get('home-stats').children.map(child => child.textContent), ['2,057 trips', '214 roads', 'no server']);
});

test('attribution follows the visible card or status above the dock', async () => {
  const p = await page(), positions = {};
  p.context.document.documentElement.style.setProperty = (name, value) => { positions[name] = value; };
  p.get('sheet').hidden = true;
  p.get('status-area').hidden = false;
  p.get('status-area').rect.top = 600;
  p.api.positionCrosshair();
  assert.equal(positions['--map-footer-bottom'], '220px');
  p.get('sheet').hidden = false;
  p.get('sheet').rect.top = 240;
  p.api.positionCrosshair();
  assert.equal(positions['--map-footer-bottom'], '580px');
});


test('download completion switches both progress surfaces to indeterminate preparation', async () => {
  const p = await page();
  p.api.state.phase = 'loading';
  p.api.renderProgress({loaded_bytes: 999, total_bytes: 1000, preparing: false});
  assert.equal(p.get('status').textContent, 'Loading roads 99%');
  p.api.renderProgress({loaded_bytes: 1000, total_bytes: 1000, preparing: true});
  assert.equal(p.get('status').textContent, 'Preparing roads…');
  assert.equal(p.get('start-progress')['aria-label'], 'Preparing roads…');
  assert.equal(p.get('start-progress')['aria-valuenow'], undefined);
  assert.equal(p.get('start-progress').dataset.preparing, 'true');
  assert.equal(p.get('progress').dataset.preparing, 'true');
  assert.equal(p.get('[data-weapon="stomp"]').title, 'Preparing roads…');
});

test('hash changes leave home for valid replays and invalid-link notices, including during loading', async () => {
  for (const loading of [false, true]) {
    for (const hash of ['#meteor=37.8,-122.4,500', '#meteor=bad']) {
      const p = await page('', 0, true);
      p.api.state.meta.box = {min_lat:37,max_lat:38,min_lon:-123,max_lon:-122};
      p.api.state.presets = [{name: 'bay_bridge'}];
      if (loading) p.api.state.phase = 'loading';
      p.context.location.hash = hash;
      p.context.window.listeners.hashchange({});
      assert.equal(p.api.state.home, false);
      assert.equal(p.get('game').inert, false);
      if (loading) {
        // Deliver the deferred load with the same preset metadata.
        p.workers[0].onmessage({data: {id: p.sent[0].id, ok: true, result: {
          meta: p.api.state.meta, presets: [{name: 'bay_bridge'}], baseline: {coords: [], offsets: [0]}
        }}});
      }
      if (hash === '#meteor=37.8,-122.4,500') {
        assert.equal(p.sent.at(-1).edit.weapon, 'meteor');
        assert.equal(p.api.state.phase, 'pending');
      } else {
        assert.equal(p.api.state.phase, 'ready');
        assert.equal(p.get('share-notice').hidden, false);
        assert.equal(p.get('share-notice').textContent, 'This share link is invalid or unavailable. Pick a new edit.');
      }
    }
  }
});

test('attribution can be collapsed again after MapLibre expands it', async () => {
  const p = await page(), removed = [];
  const control = p.get('attribution'), button = p.get('attribution-button');
  p.get('map').querySelector = () => control;
  control.querySelector = () => button;
  control.classList.remove = name => removed.push(name);
  for (let load = 0; load < 2; load++) {
    control.open = true;
    p.api.collapseAttribution();
    assert.equal(control.open, false);
    assert.equal(button['aria-expanded'], 'false');
  }
  assert.deepEqual(removed, ['maplibregl-compact-show', 'maplibregl-compact-show']);
});

test('committed untapped results fit hit and rerouted bounds with responsive padding and motion', async () => {
  for (const [isDesktop, reduced, padding] of [
    [false, false, {top: 16, left: 16, right: 16, bottom: 220}],
    [true, true, {top: 16, left: 412, right: 16, bottom: 16}],
  ]) {
    const p = await page('?timing', 0, true);
    const moves = [];
    p.context.mapDouble = {getSource: () => null, fitBounds: (...args) => moves.push(['fit', ...p.plain(args)]),
      easeTo: options => moves.push(['pan', p.plain(options)])};
    vm.runInContext('map = mapDouble;', p.context);
    p.media.get('(min-width: 900px)').matches = isDesktop;
    p.media.get('(prefers-reduced-motion: reduce)').matches = reduced;
    p.get('sheet').rect.top = 600;
    p.get('panel').rect.right = 396;
    const id = p.api.runEdit({preset: 'bay_bridge'});
    const lines = (coords) => ({coords, offsets: [0, 2], ids: [123]});
    p.workers[0].onmessage({data: {id, ok: true, result: {rows: [], display: {
      hit: lines([-122, 37, -121, 38]),
      after: lines([-123, 36, -120, 39]),
      before: lines([-130, 30, -110, 45]),
    }}}});
    assert.deepEqual(moves, reduced ? [] : [['fit', [[-123, 36], [-120, 39]], {padding, pitch:40, maxZoom:14, duration:600}]]);
    moves.length = 0;
    p.api.runEdit({weapon: 'meteor', lat: 37, lon: -122, radius_m: 500}, {lat: 37, lon: -122});
    await p.reply();
    assert.equal(moves.length,reduced ? 0 : 1);
    if (!reduced) { assert.equal(moves[0][0],'fit'); assert.equal(moves[0][2].pitch,40); }
    moves.length = 0;
    p.api.runEdit({weapon: 'meteor', lat: 37, lon: -122, radius_m: 500});
    await p.reply();
    assert.equal(moves.length,reduced ? 0 : 1);
    if (!reduced) assert.equal(moves[0][0],'fit');
  }
});

test('test mode suppresses result camera movement for both taps and replays', async () => {
  const p = await page('?test&timing', 0, true), moves = [];
  p.context.mapDouble = {fitBounds: () => moves.push('fit'), easeTo: () => moves.push('pan')};
  vm.runInContext('map = mapDouble;', p.context);
  for (const tap of [undefined, {lat: 37, lon: -122}]) {
    p.api.runEdit({preset: 'bay_bridge'}, tap);
    await p.reply();
  }
  assert.deepEqual(moves, []);
});

test('FX wiring keeps one layer through themes and context restore, and probes the actual building source', async () => {
  const p = await page('?test', 0, true), instances = [], rings = [], removed = [];
  p.api.state.meta.box = {min_lat: 37, max_lat: 38, min_lon: -123, max_lon: -122};
  const style = {sources: {}, layers: [
    {id: 'roads', type: 'line'}, {id: 'buildings', type: 'fill-extrusion', source: 'actual-tiles', 'source-layer': 'building'}, {id: 'first-label', type: 'symbol'},
  ]};
  const events = new Map(), once = new Map(), canvas = p.get('gl-canvas');
  let current;
  const emit = name => {
    for (const fn of events.get(name) ?? []) fn({});
    const callbacks = once.get(name) ?? []; once.delete(name);
    for (const fn of callbacks) fn({});
  };
  const extension = {loseContext: () => emit('webglcontextlost'), restoreContext: () => emit('webglcontextrestored')};
  canvas.getContext = () => ({getExtension: () => extension});
  class MapDouble {
    constructor() { current = this; this.style = structuredClone(style); }
    keyboard = {disable() {}};
    touchZoomRotate = {disableRotation() {}};
    getCanvas() { return canvas; }
    addControl() {}
    on(name, fn) { events.set(name, [...events.get(name) ?? [], fn]); }
    once(name, fn) { if (name === 'render') queueMicrotask(fn); else once.set(name, [...once.get(name) ?? [], fn]); }
    getStyle() { return {...this.style, layers: this.style.layers.filter(layer => layer.type !== 'custom')}; }
    getLayer(id) { return this.style.layers.find(layer => layer.id === id); }
    addLayer(layer, before) {
      assert.equal(before, 'first-label');
      layer.onAdd?.();
      this.style.layers.splice(this.style.layers.findIndex(item => item.id === before), 0, layer);
    }
    removeLayer(id) { removed.push(id); this.getLayer(id).onRemove(); this.style.layers = this.style.layers.filter(layer => layer.id !== id); }
    setStyle() { if (this.getLayer('fx')) this.removeLayer('fx'); this.style = structuredClone(style); emit('style.load'); }
    triggerRepaint() {}
    project([x, y]) { return {x, y}; }
    getSource() { return {setData() {}}; }
    querySourceFeatures(source, options) {
      assert.equal(source, 'actual-tiles');
      assert.equal(options.sourceLayer, 'building');
      return Array.from({length: 25}, (_, id) => ({...(id ? {id} : {}), properties: {render_height: id * 10}}));
    }
  }
  p.context.maplibregl = {Map: MapDouble, AttributionControl: class {}};
  p.context.fetch = async () => { throw new Error('offline'); };
  p.context.createFx = (map, options) => {
    assert.equal(options.earthRadius, 6371008.8);
    let enabled = true;
    const instance = {layer: {id: 'fx', type: 'custom', onAdd() { enabled = true; }, onRemove() { enabled = false; }},
      setTraffic() {}, setTheme(theme) { instance.theme = theme; }, clear() {}, settle() {}, rebuild() {}, fire: options => { rings.push(options); return options.duration; },
      ring: (...args) => rings.push(args), particle() {}, stats: () => ({enabled})};
    instances.push(instance);
    return instance;
  };
  vm.runInContext('syncMap = ensureFx; fx = undefined;', p.context);
  await p.api.createMap();
  assert.equal(p.hook.counts().fx_layers, 0);
  emit('style.load');
  p.api.ensureFx();
  assert.equal(instances.length, 1);
  assert.equal(current.style.layers.filter(layer => layer.id === 'fx').length, 1);
  assert.equal(p.hook.counts().fx_layers, 1);
  assert.equal(p.hook.counts().layers, 3);
  p.context.fetch = async () => ({ok:true,json:async () => structuredClone(style)});
  for (const theme of ['light', 'dark', 'light']) {
    await p.api.setTheme(theme);
    assert.equal(current.style.layers.filter(layer => layer.id === 'fx').length, 1);
    assert.equal(p.hook.counts().fx_layers, 1);
    assert.equal(p.hook.counts().layers, 3);
    assert.equal(instances[0].theme, theme);
  }
  p.hook.loseContext();
  assert.equal(p.hook.fxStats().enabled, false);
  p.api.ensureFx();
  assert.equal(instances.length, 1);
  assert.equal(p.api.state.phase, 'ready');
  p.hook.restoreContext();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(instances.length, 1);
  assert.equal(p.hook.fxStats().enabled, true);
  assert.equal(p.hook.counts().fx_layers, 1);
  assert.equal(p.hook.counts().layers, 3);
  assert.deepEqual(removed, ['fx', 'fx', 'fx', 'fx']);
  const probe = p.plain(p.hook.buildingIdProbe());
  assert.equal(probe.sourceId, 'actual-tiles');
  assert.equal(probe.sourceLayer, 'building');
  assert.equal(probe.sample.length, 20);
  assert.deepEqual(probe.sample[0], {id: null, hasId: false, render_height: 0});
  assert.deepEqual(probe.sample[19], {id: 19, hasId: true, render_height: 190});
  const meteor = p.hook.fireMeteor(37.825, -122.315, 1500);
  assert.equal(rings.at(-1).weapon,'meteor');
  assert.equal(rings.at(-1).duration,1040);
  assert.equal(rings.at(-1).radius,1500);
  await p.reply();
  await p.advance(1100);
  await meteor;
});

test('reveal fade is a cancellable tail and does not extend the deadline phase', async () => {
  const p=await page('?test',0,true), paints=[];
  p.context.mapDouble={getSource:() => ({setData(){}}),getLayer:() => true,
    setPaintProperty:(...args) => paints.push(p.plain(args))};
  vm.runInContext('map=mapDouble;',p.context);
  const result=p.hook.fireMeteor(37.8,-122.4);
  await p.reply(); await p.advance(600); await result;
  assert.equal(p.hook.animationsRunning(),false);
  assert.equal(p.api.state.phase,'showing');
  assert.equal(p.frames.size,1);
  assert.deepEqual(paints.at(-2),['after','line-opacity',0]);
  await p.advance(200);
  assert.deepEqual(paints.at(-2),['after','line-opacity',0.425]);
  assert.deepEqual(paints.at(-1),['after','line-width',1.5]);
  const reset=p.hook.rebuild(); await p.reply(); await reset;
  assert.equal(p.hook.animationsRunning(),false);
  assert.equal(p.frames.size,1);
  await p.advance(160); assert.deepEqual(paints.at(-1),['hit','line-opacity',0.4]);
  p.hook.setReducedMotion(true);
  assert.equal(p.frames.size,0);
  assert.deepEqual(paints.at(-1),['hit','line-opacity',0.8]);
  await p.advance(2000); assert.equal(p.frames.size,0);
});

test('camera hook jumps without animation and double-click zoom is disabled at construction', async () => {
  const p=await page(), calls=[];
  p.context.mapDouble={jumpTo:options => calls.push(p.plain(options))};
  vm.runInContext('map=mapDouble;',p.context);
  p.hook.camera({lng:-122.4,lat:37.8,zoom:14,pitch:0});
  assert.deepEqual(calls,[{center:[-122.4,37.8],zoom:14,pitch:0}]);
  assert.match(source,/doubleClickZoom: false/);
  assert.doesNotMatch(source,/paintEffect|effectCanvas|const EFFECT/);
});


test('sentence numbers use tabular Geist spans while retaining sentence text', async () => {
  const p=await page();
  vm.runInContext("textWithNumbers(document.getElementById('sentence'), 'Routing 2,057 trips…');",p.context);
  const sentence=p.get('sentence');
  assert.equal(sentence.textContent,'Routing 2,057 trips…');
  const numbers=sentence.children.filter(child => typeof child!=='string');
  assert.equal(numbers.length,1);
  assert.equal(numbers[0].textContent,'2,057');
  assert.equal(numbers[0].className,'tabular');
});

test('perf controls and slow-motion hook are gated by their query flags', async () => {
  const normal=await page('');
  assert.equal(normal.context.window.__playground,undefined);
  assert.equal(normal.get('perf-check').listeners.click,undefined);
  const perf=await page('?test&perf',0,true);
  assert.equal(perf.get('perf-tools').hidden,false);
  assert.equal(typeof perf.get('perf-check').listeners.click,'function');
  assert.throws(() => perf.hook.fxTimeScale(0),/positive/);
  const p=await page('?test',0,true);
  // Continuous clock double keeps the app deadline and the effects layer on the same timeline.
  vm.runInContext(`let virtualTime=performance.now(),realTime=virtualTime,rate=1;
    fx.clock=() => {const now=performance.now();virtualTime+=(now-realTime)*rate;realTime=now;return virtualTime;};
    fx.timeScale=k => {fx.clock();rate=k;};`,p.context);
  p.hook.fxTimeScale(.1);
  const result=p.hook.fireMeteor(37.8,-122.4,500);
  await p.reply(); await p.advance(1000);
  assert.equal(p.api.state.phase,'pending');
  assert.equal(p.hook.animationsRunning(),true);
  p.hook.fxTimeScale(1);
  await p.advance(499); assert.equal(p.api.state.phase,'pending');
  await p.advance(1); await result;
  assert.equal(p.api.state.phase,'showing');
});

test('baseline typed arrays reach FX and result after-polylines are passed independently of trip ids', async () => {
  const p=await page('?test',0,true), edits=[];
  p.context.fxDouble.editTraffic=(...args) => edits.push(p.plain(args));
  const result=p.hook.fireMeteor(37.8,-122.4);
  await p.reply(); await p.advance(600); await result;
  assert.deepEqual(edits,[[[123],false,{coords:[0,0,1,0],offsets:[0,2],ids:[123]}]]);
  assert.deepEqual(p.plain(p.api.state.baseline.geometry.coordinates),[]);
});

test('perf sequence holds each pitch for 10 s and exports four Large Meteor timings and three Rebuilds', async () => {
  const p=await page('?test&perf',0,true), cameras=[];
  Object.assign(p.context,{innerWidth:1280,innerHeight:800,devicePixelRatio:2});
  p.context.mapDouble={jumpTo:options => cameras.push(p.plain(options)),getSource:() => ({setData(){}})};
  p.context.fxDouble.perfStats=() => ({cars:3000,particles_scale:.5,ladder_steps:[1,2]});
  vm.runInContext('map=mapDouble;',p.context);
  const run=p.api.runPerfCheck();
  await p.advance(0);
  assert.deepEqual(cameras,[{center:[-122.315,37.825],zoom:13,pitch:0}]);
  await p.advance(9999); assert.equal(cameras.length,1);
  await p.advance(1); assert.equal(cameras[1].pitch,40);
  await p.advance(10000);
  for (let cycle=0;cycle<4;cycle++) {
    if (cycle) { assert.equal(p.sent.at(-1).type,'reset'); await p.reply(); await p.advance(400); }
    assert.deepEqual(p.plain(p.sent.at(-1).edit),{weapon:'meteor',lat:37.825,lon:-122.315,radius_m:1500});
    await p.reply(); await p.advance(1040); await p.advance(2600);
  }
  await run;
  const output=JSON.parse(p.get('perf-json').value);
  assert.deepEqual(output.meteor_fire_to_result_ms,[1040,1040,1040,1040]);
  assert.deepEqual(output.viewport,{width:1280,height:800,dpr:2});
  assert.equal(output.cars,3000); assert.equal(output.particles_scale,.5);
  assert.deepEqual(output.ladder_steps,[1,2]);
  assert.equal(output.frame_ms.p50,1040);
  assert.equal(output.frame_ms.p95,10000); assert.equal(output.frame_ms.p99,10000);
  assert.equal(output.frame_ms.max,10000); assert.equal(output.frame_ms.over_50,12);
  assert.equal(output.export_git_commit,'frozen-export');
  assert.equal(p.sent.filter(m => m.type==='reset').length,3);
  assert.equal(p.get('perf-check').disabled,false);
  assert.equal(p.api.state.gateRunning,false);
});

test('stale baseline without traffic metadata still loads and routes with traffic disabled', async () => {
  for (const missing of ['highway','weights','oneway']) {
    const p=await page('?test',0,true), calls=[];
    p.context.fxDouble.setTraffic=(...args) => calls.push(args);
    p.context.legacy={coords:[0,0,1,0],offsets:[0,2],way_ids:[123],oneway:[1],weights:[1],highway:[0]};
    delete p.context.legacy[missing];
    vm.runInContext(`pendingRequest={type:'load'}; worker.onmessage({data:{id:latest.next(),ok:true,result:{meta:state.meta,presets:[],load_ms:0,baseline:legacy}}});`,p.context);
    assert.equal(p.api.state.phase,'ready');
    assert.equal(calls.length,0);
    assert.deepEqual(p.plain(p.api.state.baseline.geometry.coordinates),[[[0,0],[1,0]]]);
    const result=p.hook.fireMeteor(37.8,-122.4);
    await p.reply(); await p.advance(600); await result;
    assert.equal(p.api.state.phase,'showing');
  }
});


test('Q4 presets preserve error/loading phases and Retry clears notices', async () => {
  const p = await page('?test',0,true);
  for (const phase of ['error','loading']) {
    p.api.state.phase=phase;
    p.api.state.error={message:'Road data unavailable',retryable:true};
    const count=p.sent.length;
    p.api.startPreset('bay_bridge');
    assert.equal(p.api.state.phase,phase);
    assert.equal(p.sent.length,count);
    assert.equal(p.api.state.shareNotice,null);
  }
  p.api.state.shareNotice='Old notice';
  p.api.loadNetwork();
  assert.equal(p.api.state.shareNotice,null);
  assert.equal(p.get('share-notice').hidden,true);
});

test('Q5 unrelated initial and changed hashes keep home and phase', async () => {
  for (const hash of ['#about','#<img src=x>']) {
    const p=await page('',0,true,hash);
    assert.equal(p.api.state.home,true);
    assert.deepEqual(p.sent.map(message=>message.type),['load']);
    for (const phase of ['loading','ready','error']) {
      p.api.state.phase=phase;
      p.context.location.hash=hash;
      p.context.window.listeners.hashchange({});
      assert.equal(p.api.state.home,true);
      assert.equal(p.api.state.phase,phase);
      assert.equal(p.api.state.shareNotice,null);
    }
  }
});

test('Q6 a failed pick clears the prior share hash and drawing', async () => {
  const p=await page('?test',0,true), writes=[];
  p.context.window.history={replaceState:(_s,_t,url)=>writes.push(url)};
  p.api.state.shareHash='#stomp=123';
  p.api.state.result={candidate_trips:1};
  p.installMap();
  p.api.fireAt({lat:37.8,lon:-122.4});
  const id=p.sent.at(-1).id;
  p.workers[0].onmessage({data:{id,ok:true,result:null}});
  assert.equal(p.api.state.phase,'ready');
  assert.equal(p.api.state.shareHash,'');
  assert.equal(p.api.state.drawn,null);
  assert.equal(writes.length,1);
  assert.equal(writes[0].includes('#'),false);
  assert.equal(p.api.state.hint,'No road here. Zoom in and tap a road');
});

test('Q7 load errors show plain copy and Retry on both screens', async () => {
  const p=await page('',0,true);
  p.workers[0].onmessage({data:{id:p.sent[0].id,ok:false,error:'TypeError: Failed to fetch'}});
  const copy="Couldn't load the road data. Check your connection and retry.";
  assert.equal(p.get('home-error').textContent,copy);
  assert.equal(p.get('error').textContent,copy);
  assert.equal(p.get('home-retry').hidden,false);
  assert.equal(p.get('retry').hidden,false);
  assert.equal(p.get('home-preset').disabled,true);
});

test('Q1 failed theme fetch preserves the loaded style and map taps guard loading', async () => {
  const p=await page('?test',0,true);
  p.api.state.summary={headline:'Result'};
  p.api.state.phase='showing';
  p.api.setHeight('summary');
  assert.equal(p.get('sheet').hidden,false);
  assert.equal(p.get('status-area').hidden,true);
  p.context.document.documentElement.dataset.theme='dark';
  p.context.fetch=async()=>{throw new Error('offline');};
  let replacements=0;
  p.context.mapDouble={setStyle(){replacements++;},isStyleLoaded:()=>false};
  vm.runInContext('map=mapDouble;',p.context);
  await p.api.setTheme('light');
  assert.equal(replacements,0);
  assert.equal(p.api.state.theme,'dark');
  assert.equal(p.context.document.documentElement.dataset.theme,'dark');
  assert.equal(p.get('theme-label').textContent,'Light theme');
  assert.equal(p.get('map-error').hidden,false);
  assert.equal(p.get('map-error').textContent,"The basemap couldn't load. Check your connection and retry. Routing still works.");
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  assert.match(html, /<\/aside>[\s\S]*<p id="map-error" role="status"/);
  const count=p.sent.length;
  p.api.onMapClick({lngLat:{lat:37.8,lng:-122.4}});
  assert.equal(p.sent.length,count);
});

test('Q2 share entry focuses the selected weapon after its visibility transition', async () => {
  const p=await page('',0,true);
  p.api.state.meta.box={min_lat:37,max_lat:38,min_lon:-123,max_lon:-122};
  p.context.location.hash='#meteor=37.8,-122.4,500';
  p.context.window.listeners.hashchange({});
  assert.equal(p.api.state.weapon,'meteor');
  await p.advance(219);
  assert.equal(p.focus(),p.get('start'));
  await p.advance(1);
  assert.equal(p.focus(),p.get('[data-weapon="meteor"]'));
});
