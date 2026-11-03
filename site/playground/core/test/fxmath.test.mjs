import assert from 'node:assert/strict';
import test from 'node:test';
import {metresPerMercatorUnit, mercatorXYZ, mercatorRing, easeInCubic, easeOutCubic, pathMetres, along, seeded, cracks, footprintCentroid, ribbonVertices, chevrons, carStreakLength, streakSize} from '../fxmath.js';

const earthRadius = 6371008.8;
const colors = () => [[1,1,1],[0.5,0.5,0.5],[1,0,0],[0,0,0]];
for (const latitude of [37.2, 37.65, 38.1]) {
  test(`500 m Mercator ring at ${latitude} degrees`, () => {
    const center = [-122.3, latitude];
    const points = mercatorRing(center, 500, 64, earthRadius);
    assert.equal(points.length, 64);
    for (const [x, y, z] of points) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y)));
      const lon = (x * 360 - 180) * Math.PI / 180;
      const phi = latitude * Math.PI / 180;
      const a = Math.sin((lat - phi) / 2) ** 2 + Math.cos(lat) * Math.cos(phi)
        * Math.sin((lon - center[0] * Math.PI / 180) / 2) ** 2;
      const distance = 2 * earthRadius * Math.asin(Math.sqrt(a));
      assert.ok(Math.abs(distance - 500) < 2.5, `${distance} m`);
      assert.equal(z, 0);
    }
  });
}

test('Mercator origin, latitude scale and altitude use the supplied Earth radius', () => {
  assert.deepEqual(mercatorXYZ([0, 0], 0, earthRadius), [0.5, 0.5, 0]);
  const xyz = mercatorXYZ([-122, 60], 400, earthRadius);
  assert.ok(Math.abs(xyz[2] * metresPerMercatorUnit(60, earthRadius) - 400) < 1e-10);
  assert.ok(Math.abs(metresPerMercatorUnit(60, earthRadius) - Math.PI * earthRadius) < 1e-7);
  assert.equal(mercatorXYZ([-122, 60], 400, earthRadius * 2)[2], xyz[2] / 2);
});

test('cubic easing endpoints and midpoint', () => {
  for (const ease of [easeInCubic, easeOutCubic]) {
    assert.equal(ease(0), 0);
    assert.equal(ease(1), 1);
  }
  assert.equal(easeInCubic(0.5), 0.125);
  assert.equal(easeOutCubic(0.5), 0.875);
});

const {createFx} = await import('../../fx.js');
function glDouble(mode = 'webgl2', compile = true) {
  const live = {buffer: new Set(), program: new Set(), shader: new Set(), vao: new Set()};
  const state = new Map([['DEPTH_WRITEMASK', true], ['DEPTH_FUNC', 'LESS'],
    ['ARRAY_BUFFER_BINDING', {mapBuffer: true}], ['CURRENT_PROGRAM', {mapProgram: true}],
    ['VERTEX_ARRAY_BINDING', {mapVao: true}], ['BLEND_SRC_RGB', 'SRC_ALPHA'], ['BLEND_DST_RGB', 'ONE_MINUS_SRC_ALPHA'],
    ['BLEND_SRC_ALPHA', 'ONE'], ['BLEND_DST_ALPHA', 'ZERO'], ['BLEND_EQUATION_RGB', 'FUNC_ADD'], ['BLEND_EQUATION_ALPHA', 'FUNC_ADD']]);
  const active = new Set(['CULL_FACE']), uniforms = {}, draws = [], uploads = [];
  let upload;
  const draw = (...args) => draws.push({args, uniforms: structuredClone(uniforms), data: upload, z: uniforms.z, radius: uniforms.r,
    depth: active.has('DEPTH_TEST'), depthMask: state.get('DEPTH_WRITEMASK'), src: state.get('BLEND_SRC_RGB'), dst: state.get('BLEND_DST_RGB')});
  const gl = new Proxy({
    drawingBufferWidth: 375, drawingBufferHeight: 812,
    getParameter: key => state.get(key), isEnabled: key => active.has(key), isContextLost: () => false,
    enable: key => active.add(key), disable: key => active.delete(key),
    bindBuffer: (_, value) => state.set('ARRAY_BUFFER_BINDING', value),
    useProgram: value => state.set('CURRENT_PROGRAM', value),
    depthMask: value => state.set('DEPTH_WRITEMASK', value), depthFunc: value => state.set('DEPTH_FUNC', value),
    blendFuncSeparate(a, b, c, d) { for (const [key, value] of [['BLEND_SRC_RGB', a], ['BLEND_DST_RGB', b], ['BLEND_SRC_ALPHA', c], ['BLEND_DST_ALPHA', d]]) state.set(key, value); },
    blendFunc(a, b) { this.blendFuncSeparate(a, b, a, b); },
    blendEquationSeparate(a, b) { state.set('BLEND_EQUATION_RGB', a); state.set('BLEND_EQUATION_ALPHA', b); },
    blendEquation(a) { this.blendEquationSeparate(a, a); },
    getShaderParameter: () => compile, getProgramParameter: () => true,
    getUniformLocation: (_, name) => name,
    uniform1f: (name, value) => { uniforms[name] = value; },
    uniform4f: (name, ...value) => { uniforms[name] = value; },
    bufferData: (_, data) => { upload = Array.from(data); uploads.push(upload); },
    uniformMatrix4fv: (_, transpose, value) => { assert.equal(transpose, false); uniforms.matrix = value; },
    getVertexAttrib: (_, key) => key.endsWith('ENABLED') ? false : key.endsWith('BUFFER_BINDING') ? {mapBuffer: true} : 0,
    getVertexAttribOffset: () => 0,
    drawArraysInstanced: mode === 'webgl2' ? draw : undefined,
    vertexAttribDivisor() {}, bindVertexArray: value => state.set('VERTEX_ARRAY_BINDING', value),
    getExtension: name => name === 'ANGLE_instanced_arrays' && mode === 'angle'
      ? {drawArraysInstancedANGLE: draw, vertexAttribDivisorANGLE() {}, VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: 'DIVISOR'} : null,
  }, {get(target, key) {
    if (key in target) return target[key];
    if (/^[A-Z_]+$/.test(key)) return key;
    return () => {};
  }});
  for (const [kind, suffix] of [['buffer', 'Buffer'], ['program', 'Program'], ['shader', 'Shader'], ['vao', 'VertexArray']]) {
    gl[`create${suffix}`] = () => { const object = {}; live[kind].add(object); return object; };
    gl[`delete${suffix}`] = object => { assert.ok(live[kind].delete(object)); };
  }
  return {gl, live, state, active, uniforms, draws, uploads};
}

for (const mode of ['webgl2', 'angle']) {
  test(`FX ${mode}: draw in metres, restore GL state, free and rebuild resources`, t => {
    let now = 0, repaints = 0;
    t.mock.method(performance, 'now', () => now);
    const map = {triggerRepaint: () => repaints++};
    const fx = createFx(map, {theme: 'dark', reducedMotion: false, earthRadius,colors});
    const {gl, live, state, active, uniforms, draws} = glDouble(mode);
    fx.layer.onAdd(map, gl);
    assert.deepEqual(fx.stats(), {enabled: true, buffers: 3, programs: 3, textures: 0, drawnLastFrame: 0});
    assert.equal(live.shader.size, 0);
    const before = [...state], enabledBefore = [...active];
    const matrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    fx.ring([-122.3, 37.65], 500, 1000);
    fx.particle([-122.3, 37.65]);
    now = 750;
    fx.layer.render(gl, matrix);
    assert.deepEqual(draws.map(d => d.args), [['TRIANGLES', 0, 6, 1], ['TRIANGLES', 0, 6, 1]]);
    assert.equal(draws[0].radius, 492.1875);
    assert.equal(draws[1].radius, 15);
    assert.equal(draws[1].z, 350);
    assert.ok(draws.every(d => d.depth && !d.depthMask && d.src === 'ONE' && d.dst === 'ONE'));
    assert.deepEqual([...state], before);
    assert.deepEqual([...active], enabledBefore);
    assert.ok(Math.abs(uniforms.matrix[12] - mercatorXYZ([-122.3, 37.65], 0, earthRadius)[0]) < 1e-7);
    assert.equal(fx.stats().drawnLastFrame, 2);
    fx.setTheme('light');
    fx.layer.render(gl, matrix);
    assert.equal(draws.at(-1).src, 'SRC_ALPHA');
    assert.equal(draws.at(-1).dst, 'ONE_MINUS_SRC_ALPHA');
    now = 1600;
    const requested = repaints;
    fx.layer.render(gl, matrix);
    assert.equal(repaints, requested);
    assert.equal(fx.stats().drawnLastFrame, 0);
    fx.layer.onRemove();
    fx.layer.onRemove();
    assert.deepEqual(Object.values(live).map(set => set.size), [0, 0, 0, 0]);
    assert.deepEqual(fx.stats(), {enabled: false, buffers: 0, programs: 0, textures: 0, drawnLastFrame: 0});
    fx.layer.onAdd(map, gl);
    assert.equal(fx.stats().enabled, true);
    fx.clear();
    fx.layer.onRemove();
    assert.deepEqual(Object.values(live).map(set => set.size), [0, 0, 0, 0]);
  });
}

test('FX disables unsupported/failed contexts and reduced motion requests no animation frames', () => {
  for (const [mode, compile] of [['none', true], ['webgl2', false]]) {
    const {gl, live} = glDouble(mode, compile);
    const fx = createFx({}, {theme: 'dark', reducedMotion: false, earthRadius,colors});
    fx.layer.onAdd({}, gl);
    assert.equal(fx.stats().enabled, false);
    assert.deepEqual(Object.values(live).map(set => set.size), [0, 0, 0, 0]);
  }
  const fx = createFx({}, {theme: 'dark', reducedMotion: true, earthRadius,colors});
  fx.layer.onAdd({}, glDouble().gl);
  fx.ring([0, 0], 500, 1000);
  fx.particle([0, 0]);
  fx.layer.render(glDouble().gl, []);
  assert.equal(fx.stats().drawnLastFrame, 0);
  fx.layer.onRemove();
});

test('metre paths, arc interpolation, seeded cracks and polygon area centroids', () => {
  const line=[[0,0],[30,0],[30,40]];
  assert.deepEqual(along(line,45),{point:[30,15],angle:Math.PI/2});
  assert.deepEqual(along(line,100),{point:[30,40],angle:Math.PI/2});
  const east=pathMetres([[0,0],[360/(2*Math.PI*earthRadius)*100,0]],[0,0],earthRadius);
  assert.ok(Math.abs(east[1][0]-100)<1e-7);
  assert.equal(east[1][1],0);
  const rng=seeded(1);
  assert.equal(rng(),1015568748/4294967296);
  assert.equal(rng(),1586005467/4294967296);
  assert.deepEqual(cracks(line,123),cracks(line,123));
  assert.notDeepEqual(cracks(line,123),cracks(line,124));
  for (const branch of cracks(line,123)) {
    assert.equal(branch.length,4);
    const length=Math.hypot(branch[3][0]-branch[0][0],branch[3][1]-branch[0][1]);
    assert.ok(length>=20 && length<=60);
  }
  const square=(x,y,w,h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
  assert.deepEqual(footprintCentroid({type:'Polygon',coordinates:[square(0,0,4,4),square(0,0,2,2)]}),[7/3,7/3]);
  assert.deepEqual(footprintCentroid({type:'MultiPolygon',coordinates:[[square(0,0,2,2)],[square(4,0,2,2)]]}),[3,1]);
  const center=footprintCentroid({type:'Polygon',coordinates:[square(-122.4,37.8,0.0001,0.0001)]});
  assert.ok(Math.abs(center[0]+122.39995)<1e-10);
  assert.ok(Math.abs(center[1]-37.80005)<1e-10);
  assert.equal(footprintCentroid({type:'Point',coordinates:[0,0]}),null);
});

test('Meteor sinks centroid-selected buildings, late tiles and Rebuild; still crater schedules no tail', t => {
  let now=0, repaints=0;
  t.mock.method(performance,'now',() => now);
  const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], {gl}=glDouble();
  const k=360/(2*Math.PI*earthRadius), features=[], states=new Map(), paint={}, events=new Map();
  const polygon=(id,x,width) => ({id,geometry:{type:'Polygon',coordinates:[[
    [(x-width/2)*k,-10*k],[(x+width/2)*k,-10*k],[(x+width/2)*k,10*k],[(x-width/2)*k,10*k],[(x-width/2)*k,-10*k],
  ]]}});
  features.push(polygon(1,0,20),polygon(2,600,20),polygon(3,490,100),polygon(4,510,100));
  const h=['get','render_height'], base=['get','render_min_height'];
  const building={id:'buildings',type:'fill-extrusion',source:'actual', 'source-layer':'building',paint:{'fill-extrusion-height':h,'fill-extrusion-base':base}};
  const map={triggerRepaint:() => repaints++, getStyle:() => ({layers:[building]}),getLayer:() => building,
    setPaintProperty:(_,key,value) => {paint[key]=value;},
    querySourceFeatures:(source,options) => {assert.equal(source,'actual');assert.equal(options.sourceLayer,'building');return features;},
    setFeatureState:(target,state) => {states.set(target.id,state);}, removeFeatureState:target => states.delete(target.id),
    on:(name,fn) => events.set(name,fn), off:name => events.delete(name)};
  const fx=createFx(map,{theme:'light',earthRadius,reducedMotion:false,colors}); fx.layer.onAdd(map,gl);
  assert.equal(fx.fire({weapon:'meteor',lngLat:[0,0],radius:500,duration:600}),600);
  assert.deepEqual([...states.keys()],[1,3]);
  now=990; fx.layer.render(gl,matrix);
  assert.deepEqual(paint['fill-extrusion-height'],['case',['boolean',['feature-state','sunk'],false],['*',h,0.5],h]);
  assert.deepEqual(paint['fill-extrusion-base'],['case',['boolean',['feature-state','sunk'],false],['*',base,0.5],base]);
  features.push(polygon(5,100,20)); events.get('sourcedata')({sourceId:'other'}); assert.equal(states.has(5),false);
  events.get('sourcedata')({sourceId:'actual'}); assert.equal(states.has(5),true);
  fx.rebuild(); now+=160; fx.layer.render(gl,matrix);
  assert.equal(paint['fill-extrusion-height'][2][2],0.75);
  now+=160; fx.layer.render(gl,matrix); assert.equal(states.size,0);
  assert.equal(paint['fill-extrusion-height'][2][2],1);
  assert.equal(fx.fire({weapon:'meteor',lngLat:[0,0],radius:500,duration:600,still:true}),0);
  const requested=repaints; fx.layer.render(gl,matrix); assert.equal(repaints,requested);
  assert.equal(paint['fill-extrusion-height'][2][2],0);
  assert.equal(fx.stats().drawnLastFrame,2);
  now+=10000; fx.layer.render(gl,matrix); assert.equal(fx.stats().drawnLastFrame,2);
  fx.layer.onRemove(); assert.equal(states.size,0); assert.equal(events.size,0);
  fx.layer.onAdd(map,gl); assert.deepEqual([...states.keys()],[1,3,5]);
  fx.rebuild(); fx.settle(); assert.equal(states.size,0);
  fx.layer.render(gl,matrix); assert.equal(fx.stats().drawnLastFrame,0);
  fx.clear(); assert.equal(states.size,0);
  fx.layer.onRemove();
});


for (const theme of ['dark','light']) {
  test(`Meteor ${theme}: no crater before impact, translucent end state and bounded particle tail`, t => {
    let now=0;
    t.mock.method(performance,'now',() => now);
    const {gl,draws}=glDouble(), map={triggerRepaint() {}};
    const fx=createFx(map,{theme,reducedMotion:false,earthRadius,colors});
    fx.layer.onAdd(map,gl);
    const e=fx.fire({weapon:'meteor',lngLat:[0,0],radius:500,duration:1040});
    assert.equal(e,1040);
    const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    const frame=time => { now=time; draws.length=0; fx.layer.render(gl,matrix); return [...draws]; };
    const fall=frame(300);
    assert.ok(fall.length>0);
    assert.ok(fall.every(d => d.uniforms.k===2));
    const head=fall.at(-1).data;
    assert.equal(head.length,54);
    // Falls in from screen upper-left (bearing 0: west and north), never along the camera's line of sight.
    const d=head[2]/Math.tan(35*Math.PI/180);
    assert.ok(Math.abs(head[2]-1100*(1-300/676))<.001);
    assert.ok(Math.abs(head[0]+.89*d)<.01 && Math.abs(head[1]+.45*d)<.01);
    assert.deepEqual([head[24],head[31],head[33],head[34]],[90,.7,1,60].map(Math.fround));
    assert.deepEqual([head[42],head[46],head[47],head[49],head[52]],[30,1,1,1,34]);
    const impact=frame(700), flash=impact.find(d => d.uniforms.k===1 && d.z===3);
    assert.ok(Math.abs(flash.radius-52)<1e-10);
    assert.ok(Math.abs(flash.uniforms.c[3]-(1-.024/.25))<1e-10);
    const chips=impact.find(d => d.uniforms.k===2 && d.args[3]===150);
    assert.ok(chips);
    for (let i=0;i<chips.data.length;i+=18) {
      const p=chips.data.slice(i,i+18);
      assert.ok(p[8]<=1.2);
      assert.ok(Math.abs(2*p[5]/p[9]-p[8])<1e-6);
      assert.deepEqual(p.slice(15,17),[3,3]);
    }
    const tail=frame(1300), dust=tail.find(d => d.uniforms.k===2 && d.args[3]===80);
    assert.equal(dust.dst,'ONE_MINUS_SRC_ALPHA');
    assert.equal(dust.src,theme==='dark' ? 'ONE' : 'SRC_ALPHA');
    assert.deepEqual(dust.data.slice(10,14),[.5,.5,.5,Math.fround(.22)]);
    for (let i=0;i<dust.data.length;i+=18) {
      assert.ok(Math.hypot(...dust.data.slice(i,i+2))>=100);
      assert.ok(Math.hypot(...dust.data.slice(i,i+2))<=450);
      assert.equal(dust.data[i+16],0);
    }
    const end=frame(3541);
    assert.equal(end.length,2);
    assert.deepEqual(end.map(d => [d.radius,d.uniforms.c[3],d.dst]),
      [[525,.45,'ONE_MINUS_SRC_ALPHA'],[500,.6,'ONE_MINUS_SRC_ALPHA']]);
    fx.clear(); assert.equal(frame(4000).length,0);
    fx.layer.onRemove();
  });
}

test('crack count stays bounded for short and highly segmented roads', () => {
  assert.equal(cracks([[0,0],[100,0]],123).length,7);
  assert.equal(cracks(Array.from({length:100},(_,i) => [i,0]),123).length,7);
});

const {trafficLines,seedCars,carPosition,advanceCars,editCars,trafficSpeed,fallbackStep,percentile}=await import('../fxmath.js');
function trafficFixture() {
  const degree=360/(2*Math.PI*earthRadius);
  return {coords:new Float64Array([0,0,1000*degree,0,0,0,1000*degree,0]),
    offsets:new Uint32Array([0,2,4]),way_ids:new Float64Array([11,22]),
    oneway:new Uint8Array([1,0]),weights:new Uint16Array([1,3]),highway:new Uint8Array([0,1])};
}
test('traffic is seeded, weighted by trip count and length, capped, and runs both directions', () => {
  const {lines}=trafficLines(trafficFixture(),earthRadius,['motorway','residential']);
  const cars=seedCars(lines,80,2027);
  assert.deepEqual(seedCars(lines,80,2027),cars);
  assert.notDeepEqual(seedCars(lines,80,8),cars);
  const busy=cars.filter(c => c.line.id===22), quiet=cars.filter(c => c.line.id===11);
  assert.equal(cars.length,14);
  assert.equal(quiet.length,4); assert.equal(busy.length,10);
  assert.ok(quiet.every(c => c.direction===1));
  assert.deepEqual([...new Set(busy.map(c => c.direction))],[1,-1]);
  assert.equal(seedCars(lines,6).length,6);
  assert.equal(seedCars(lines,0).length,0);
  assert.equal(seedCars(lines,5).length,4);
  const doubled=lines.map(l => ({...l,length:l.length*2}));
  assert.equal(seedCars(doubled,80).length,28);
  assert.equal(trafficSpeed('motorway'),900); assert.equal(trafficSpeed('residential'),270);
  assert.equal(trafficSpeed('unknown'),300);
});
test('cumulative interpolation, right offsets, wrapping, Flip, stop/fade and deterministic refill', () => {
  const {lines}=trafficLines(trafficFixture(),earthRadius,['motorway','residential']);
  const car={line:lines[1],position:250,direction:1,fade:1,stopped:false}, out=new Float32Array(8);
  carPosition(car,out); assert.deepEqual([...out.slice(0,4)],[250,5,1,0]); // Mercator south is positive.
  car.direction=-1; carPosition(car,out); assert.deepEqual([...out.slice(0,4)],[250,-5,-1,-0]);
  const corner={points:[[0,0],[30,0],[30,40]],cumulative:new Float64Array([0,30,70]),ratio:1,oneway:true};
  carPosition({line:corner,position:45,direction:1},out); assert.deepEqual([...out.slice(0,4)],[30,15,0,1]);
  car.position=990; car.direction=1; advanceCars([car],1,out);
  assert.ok(Math.abs(car.position-260)<.00001);
  const cars=seedCars(lines,8), initial=structuredClone(cars), buffer=new Float32Array(64);
  editCars(cars,[11],true); assert.ok(cars.filter(c => c.line.id===11).every(c => c.direction===-1));
  editCars(cars,[22],false);
  const hit=cars.find(c => c.line.id===22), position=hit.position;
  advanceCars(cars,.2,buffer); assert.equal(hit.position,position); assert.equal(hit.fade,.5);
  advanceCars(cars,.2,buffer); assert.equal(hit.fade,0);
  assert.deepEqual(seedCars(lines,8),initial);
});
test('fallback advances at p95 above 33 ms, once per stage; percentiles use nearest rank', () => {
  assert.equal(fallbackStep([],0),0);
  assert.equal(fallbackStep(Array(100).fill(33),0),0);
  const intervals=[...Array(94).fill(16),...Array(6).fill(34)];
  assert.equal(percentile(intervals,.95),34);
  for (let step=0;step<3;step++) {
    assert.equal(fallbackStep(intervals,step),step+1);
    assert.equal(fallbackStep([16],step),step);
  }
  assert.equal(fallbackStep(intervals,3),3);
  assert.equal(percentile([10,30,20],.5),20);
});
test('traffic requests one upload, pauses when hidden and under reduced motion, resumes without a jump', t => {
  let now=0, reduce=false, repaint=0;
  t.mock.method(performance,'now',() => now);
  const document={hidden:false,addEventListener:(key,fn) => {document[key]=fn;},removeEventListener:key => {delete document[key];}};
  const original=globalThis.document; globalThis.document=document;
  t.after(() => { if (original===undefined) delete globalThis.document; else globalThis.document=original; });
  const map={triggerRepaint:() => repaint++}, {gl,uploads}=glDouble();
  const fx=createFx(map,{theme:'dark',reducedMotion:() => reduce,earthRadius,colors});
  fx.setTraffic(trafficFixture(),['motorway','residential']); fx.layer.onAdd(map,gl);
  const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  fx.layer.render(gl,matrix); const first=fx.trafficSample(2), count=uploads.length;
  now=16; fx.layer.render(gl,matrix);
  assert.equal(uploads.length,count+1); assert.notDeepEqual(fx.trafficSample(2),first);
  reduce=true; const stopped=fx.trafficSample(2), requests=fx.trafficFramesRequested();
  now=1016; fx.layer.render(gl,matrix);
  assert.deepEqual(fx.trafficSample(2),stopped); assert.equal(fx.trafficFramesRequested(),requests);
  assert.equal(fx.trafficStats().moving,false);
  reduce=false; document.hidden=true; document.visibilitychange(); const paints=repaint;
  now=5016; fx.layer.render(gl,matrix);
  assert.equal(repaint,paints); assert.equal(fx.trafficStats().paused,true);
  assert.equal(fx.trafficFramesRequested(),requests);
  document.hidden=false; document.visibilitychange(); fx.layer.render(gl,matrix);
  assert.deepEqual(fx.trafficSample(2),stopped);
  now+=16; fx.layer.render(gl,matrix); assert.ok(fx.trafficFramesRequested()>requests);
  fx.editTraffic([11],false,{coords:new Float64Array([0,0,.01,0]),offsets:new Uint32Array([0,2]),ids:new Float64Array([999])});
  assert.ok(fx.trafficStats().cars>0); fx.rebuild();
  assert.deepEqual(fx.trafficSample(2),first);
  fx.layer.onRemove(); assert.equal(document.visibilitychange,undefined);
});
test('FX time scale changes effects, tails and traffic on one continuous clock', t => {
  let now=0; t.mock.method(performance,'now',() => now);
  const {gl}=glDouble(), fx=createFx({triggerRepaint(){}},{theme:'dark',reducedMotion:false,earthRadius,colors});
  fx.layer.onAdd({triggerRepaint(){}},gl); fx.timeScale(.1);
  fx.ring([0,0],500,1000); now=1000;
  assert.equal(fx.clock(),100);
  assert.equal(fx.ringRadius().radius,500*(1-.9**3));
  fx.timeScale(2); now=1100; assert.equal(fx.clock(),300);
  fx.layer.onRemove();
});

test('three slow windows halve cars and particles, then hide buildings once across Rebuild and style reload', t => {
  let now=0; t.mock.method(performance,'now',() => now);
  const layouts=[], b={id:'building',type:'fill-extrusion','source-layer':'building'};
  const map={triggerRepaint(){},setPaintProperty(){},getStyle:() => ({layers:[b]}),setLayoutProperty:(...args) => layouts.push(args)};
  const {gl}=glDouble(), fx=createFx(map,{theme:'dark',reducedMotion:false,earthRadius,colors});
  fx.setTraffic(trafficFixture(),['motorway','residential']); fx.layer.onAdd(map,gl);
  const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  fx.layer.render(gl,matrix);
  const initial=fx.trafficStats().cars;
  for (let window=1;window<=4;window++) {
    for (let frame=0;frame<75;frame++) { now+=40; fx.layer.render(gl,matrix); }
    assert.deepEqual(fx.perfStats().ladder_steps,[1,2,3].slice(0,window));
    assert.equal(fx.perfStats().particles_scale,window===1 ? 1 : .5);
  }
  const count=Math.floor(initial/4)*2;
  assert.equal(fx.trafficStats().cars,count);
  assert.deepEqual(layouts,[['building','visibility','none']]);
  fx.rebuild(); assert.equal(fx.trafficStats().cars,count);
  fx.layer.onRemove(); fx.layer.onAdd(map,gl);
  assert.deepEqual(layouts,[['building','visibility','none'],['building','visibility','none']]);
  fx.layer.onRemove();
});

test('crack ribbon tapers from six ground metres to a point by arc length', () => {
  const v=ribbonVertices([[0,0],[30,0],[30,40]],6,1,true);
  assert.deepEqual(v.slice(0,8),[0,3,1,0,0,-3,-1,0]);
  assert.equal(v.length,48);
  assert.deepEqual(v.slice(-4),[30,40,-1,0]);
  assert.deepEqual(v.slice(24,26),[30-12/7,0]);
  assert.deepEqual(ribbonVertices([[0,0],[0,0]],6,1,true),[]);
  assert.deepEqual(ribbonVertices([[0,0],[100,0]],6,.5,true).slice(8,10),[50,1.5]);
});
test('chevron train spans the road at forty metre spacing and reverses after braking', () => {
  const path=[[0,0],[100,0],[100,100]];
  assert.deepEqual(chevrons(path,200,0).map(v => v.point),[[0,0],[40,0],[80,0],[100,20],[100,60]]);
  assert.equal(chevrons(path,200,.4)[0].angle,0);
  assert.equal(chevrons(path,200,.55)[0].angle,Math.PI);
  assert.deepEqual(chevrons(path,200,.4),chevrons(path,200,.5));
  assert.equal(chevrons(path,0,.2).length,0);
  assert.deepEqual(chevrons(path,200,0,100).map(v => v.point),[[0,0],[100,0]]); // zoom-scaled gap
});
const {viewSpans,recycleCars,markLines,clipSegment}=await import('../fxmath.js');
function viewFixture() {
  const line=(id,y,speed,weight,oneway=true) => ({id,oneway,speed,weight,points:[[0,y],[1000,y]],cumulative:new Float64Array([0,1000]),ratio:1,length:1000});
  return [line(1,0,900,200),line(2,50,270,1,false),line(3,5000,900,200)];
}
test('view spans cover in-view roads only; targets favour motorways and busy roads; closed roads drop out', () => {
  const lines=viewFixture(), spans=viewSpans(lines,[0,-100,500,100]);
  assert.deepEqual(spans.map(s => s.line.id),[1,2]);
  assert.deepEqual([spans[0].parts,spans[0].length],[[[0,500]],500]); // clipped to the box
  assert.ok(Math.abs(spans[0].want-500/30)<1e-9);
  assert.ok(spans[1].want<spans[0].want/2); // two directions, but residential and one trip
  markLines(lines,[1],false); markLines(lines,[3],true);
  assert.deepEqual(viewSpans(lines,[0,-100,500,100]).map(s => s.line.id),[2]);
  assert.equal(lines[2].flip,true); markLines(lines,[2],true); assert.equal(lines[1].flip,undefined); // two-way never flips
});
test('recycling moves off-screen and surplus cars into the view, keeps the total, skips stopped and reroute cars', () => {
  const lines=viewFixture(), box=[0,-100,1000,100], spans=viewSpans(lines,box);
  const cars=Array.from({length:40},(_,i) => ({line:lines[2],position:i*20,direction:1,fade:1,stopped:i===0}));
  cars[1].line={...lines[0],extra:true};
  const xy=new Float32Array(cars.length*8); advanceCars(cars,0,xy);
  const moves=recycleCars(cars,xy,spans,box,seeded(1));
  assert.deepEqual(recycleCars(cars,xy,spans,box,seeded(1)),moves);
  assert.ok(moves.length>0 && moves.length<=38);
  assert.ok(moves.every(m => m.index>1 && spans.some(s => s.line===m.line) && m.position>=0 && m.position<=1000));
  assert.ok(moves.every(m => m.line.id===2 || m.direction===1));
  const want=spans.reduce((n,s) => n+s.want,0);
  assert.equal(moves.length,Math.min(38,Math.floor(want)));
  for (const m of moves) Object.assign(cars[m.index],{line:m.line,position:m.position,direction:m.direction});
  advanceCars(cars,0,xy);
  // Settled: a second pass has nothing left to move.
  assert.ok(recycleCars(cars,xy,spans,box,seeded(2)).length<=2);
  // A flipped one-way receives reversed cars; an over-full road gives up its surplus.
  lines[0].flip=true;
  const crowd=Array.from({length:30},(_,i) => ({line:lines[0],position:i*30,direction:-1,fade:1,stopped:false}));
  const xy2=new Float32Array(240); advanceCars(crowd,0,xy2);
  const few=[{line:lines[0],want:2,parts:[[0,1000]],length:1000},{line:lines[1],want:20,parts:[[0,1000]],length:1000}];
  const out=recycleCars(crowd,xy2,few,box,seeded(3));
  assert.ok(out.length>=15 && out.every(m => m.line===lines[1] || m.direction===-1));
});
test('spans clip segments to the view: a crossing segment counts, and recycled cars land inside the box', () => {
  const road=(points,id=9) => {
    const cumulative=new Float64Array(points.length);
    for (let i=1;i<points.length;i++) cumulative[i]=cumulative[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
    return {id,oneway:true,speed:900,weight:200,points,cumulative,ratio:1,length:cumulative.at(-1)};
  };
  const box=[-10,-10,10,10];
  const crossing=viewSpans([road([[-1000,0],[1000,0]])],box);
  assert.equal(crossing.length,1); assert.deepEqual(crossing[0].parts,[[990,1010]]);
  assert.deepEqual(clipSegment([-1000,50],[1000,50],box),null);
  // Vertex inside: still only the visible 20 m, not both 1 km neighbours; a zigzag gives two intervals.
  const lines=[road([[-1000,0],[0,0],[1000,0]]),road([[-30,0],[30,0],[30,5],[-30,5]],8)];
  const spans=viewSpans(lines,box);
  assert.deepEqual(spans[0].parts,[[990,1010]]);
  assert.deepEqual(spans[1].parts.map(p => p.map(v => Math.round(v*1e6)/1e6)),[[20,40],[85,105]]);
  const far=road([[0,5000],[2000,5000]],7);
  const cars=Array.from({length:40},(_,i) => ({line:far,position:i*40,direction:1,fade:1,stopped:false}));
  const xy=new Float32Array(320); advanceCars(cars,0,xy);
  const moves=recycleCars(cars,xy,spans,box,seeded(4));
  assert.ok(moves.length>0);
  for (const m of moves) Object.assign(cars[m.index],{line:m.line,position:m.position,direction:m.direction});
  advanceCars(cars,0,xy);
  for (const m of moves) {
    const x=xy[m.index*8], y=xy[m.index*8+1];
    assert.ok(x>=-10-1e-6 && x<=10+1e-6 && y>=-10-1e-6 && y<=10+1e-6,`${x},${y}`);
  }
});
test('recycled cars fade in while moving; stopped cars still fade out', () => {
  const lines=viewFixture(), car={line:lines[0],position:0,direction:1,fade:0,stopped:false}, out=new Float32Array(8);
  advanceCars([car],0,out); assert.equal(car.fade,0);
  advanceCars([car],.2,out); assert.equal(car.fade,.5); assert.equal(out[4],.5);
  advanceCars([car],1,out); assert.equal(car.fade,1);
});
test('traffic streak speed range, CSS floors and high zoom caps', () => {
  assert.equal(carStreakLength(270),25);
  assert.equal(carStreakLength(600),40);
  assert.equal(carStreakLength(900),60);
  assert.deepEqual(streakSize(25,.001),[3,1.5]);
  assert.deepEqual(streakSize(60,100),[20,2.5]);
  assert.deepEqual(streakSize(40,.5),[10,1.5]);
});
test('closed cars emit red brakes while opposite two-way traffic emits dim tails', () => {
  const {lines}=trafficLines(trafficFixture(),earthRadius,['motorway','residential']);
  const cars=[{line:lines[0],position:100,direction:1,fade:1,stopped:true},
    {line:lines[1],position:100,direction:-1,fade:1,stopped:false}], out=new Float32Array(16);
  advanceCars(cars,.2,out);
  assert.equal(out[4],.5); assert.equal(out[5],-2); assert.equal(out[6],60);
  assert.equal(out[12],1); assert.equal(out[13],Math.fround(-.65)); assert.equal(out[14],25);
});

test('Stomp uses ground ribbons, unlit dust and chips; Flip tail survives its reveal deadline', t => {
  let now=0; t.mock.method(performance,'now',() => now);
  const {gl,draws}=glDouble(), map={triggerRepaint(){},getZoom:() => 13};
  const fx=createFx(map,{theme:'dark',earthRadius,reducedMotion:false,colors});
  fx.layer.onAdd(map,gl);
  const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], line=[[0,0],[.002,0]];
  assert.equal(fx.fire({weapon:'stomp',lngLat:[0,0],line,duration:500}),500);
  now=100; fx.layer.render(gl,matrix);
  const dust=draws.find(d => d.uniforms.k===2 && d.args[3]===60);
  assert.equal(dust.dst,'ONE_MINUS_SRC_ALPHA');
  assert.equal(dust.data[8],Math.fround(1.2));
  for (let i=0;i<dust.data.length;i+=18) {
    assert.ok(dust.data[i+6]>=20 && dust.data[i+6]<=60); assert.equal(dust.data[i+16],8);
  }
  assert.deepEqual(dust.data.slice(10,13),[.5,.5,.5]);
  const chip=draws.find(d => d.uniforms.k===2 && d.args[3]===40);
  assert.equal(chip.data[9],340); assert.equal(chip.data[16],4);
  assert.ok(chip.data.slice(10,13).every(v => v>.2)); // lit chips read on a dark map
  // Cracks: dark fissure under a red (destroyed-road) glow and a hot core, all tapered.
  const cracks=draws.filter(d => d.uniforms.k===3 && d.uniforms.c[0]===1 && d.uniforms.c[1]===0);
  assert.ok(cracks.length>=6);
  fx.clear(); draws.length=0;
  assert.equal(fx.fire({weapon:'flip',lngLat:[0,0],line,duration:500}),500);
  now=800; fx.layer.render(gl,matrix);
  // z13: chevrons ~8 px long, spaced two lengths apart so the train stays legible (not 40 m mush).
  assert.equal(draws.filter(d => d.uniforms.k===3).length,1);
  draws.length=0; now=1301; fx.layer.render(gl,matrix); assert.equal(draws.filter(d => d.uniforms.k===3).length,1);
  const end=draws[0].data;
  draws.length=0; now=10000; fx.settle(); fx.layer.render(gl,matrix);
  assert.deepEqual(draws[0].data,end);
  fx.clear(); draws.length=0;
  fx.fire({weapon:'stomp',lngLat:[0,0],line,still:true});
  fx.layer.render(gl,matrix); assert.equal(draws.length,0);
  fx.layer.onRemove();
});


test('D11 traffic marks only motorway and trunk as visible at regional zoom', () => {
  const fixture=trafficFixture();
  const data={...fixture,highway:new Uint8Array([0,1])};
  assert.deepEqual(trafficLines(data,earthRadius,['motorway','residential']).lines.map(line=>line.major),[true,false]);
  assert.deepEqual(trafficLines(data,earthRadius,['trunk','motorway_link']).lines.map(line=>line.major),[true,false]);
});


for (const theme of ['dark','light']) test(`D2 traffic keeps shared CSS floors at z15 in ${theme}`, () => {
  const {gl,draws}=glDouble();
  const map={getZoom:()=>15,triggerRepaint(){}};
  const fx=createFx(map,{theme,earthRadius,reducedMotion:true,colors});
  fx.layer.onAdd(map,gl); fx.setTraffic(trafficFixture(),['motorway','residential']);
  fx.layer.render(gl,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const traffic=draws.find(d=>d.uniforms.k===5);
  assert.deepEqual(traffic.uniforms.view,[375,812,3,20]);
  assert.equal(traffic.uniforms.h,theme==='dark' ? 1 : 0);
  assert.equal(traffic.uniforms.c[3],1);
  assert.ok(traffic.data.some((value,i)=>i%8===4 && value===1));
  fx.layer.onRemove();
});

test('D4 reduced-motion Flip chevrons persist until clear without requesting animation', t => {
  let now=0; t.mock.method(performance,'now',()=>now);
  const {gl,draws}=glDouble(); let frames=0;
  const fx=createFx({getZoom:()=>16,triggerRepaint(){frames++;}}, {theme:'dark',earthRadius,reducedMotion:true,colors});
  fx.layer.onAdd({},gl);
  fx.fire({weapon:'flip',lngLat:[0,0],line:[[0,0],[.002,0]],duration:500});
  const before=frames, matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  fx.layer.render(gl,matrix); const end=draws.map(d=>d.data);
  assert.equal(end.length,1);
  now=10000; draws.length=0; fx.layer.render(gl,matrix);
  assert.deepEqual(draws.map(d=>d.data),end); assert.equal(frames,before);
  fx.clear(); draws.length=0; fx.layer.render(gl,matrix); assert.equal(draws.length,0);
  fx.layer.onRemove();
});
test('recycling samples the lower 80% of the screen, so a pitched horizon band does not dilute the view', t => {
  let now=0; t.mock.method(performance,'now',() => now);
  const seen=[], map={triggerRepaint(){},getContainer:() => ({clientWidth:200,clientHeight:100}),
    unproject:([x,y]) => { seen.push([x,y]); return {lng:x*1e-6,lat:-y*1e-6}; }};
  const {gl}=glDouble(), fx=createFx(map,{theme:'light',reducedMotion:false,earthRadius,colors});
  fx.setTraffic(trafficFixture(),['motorway','residential']); fx.layer.onAdd(map,gl);
  now=2000; fx.layer.render(gl,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  assert.deepEqual(seen,[[0,20],[200,20],[0,100],[200,100]]);
  fx.layer.onRemove();
});
