import {mercatorXYZ, metresPerMercatorUnit, easeOutCubic, pathMetres, along, seeded, cracks, footprintCentroid, trafficLines, seedCars, editCars, advanceCars, fallbackStep, ribbonVertices, chevrons, streakBounds, viewSpans, recycleCars, markLines} from './core/fxmath.js';

export function createFx(map, {theme, reducedMotion, earthRadius, colors}) {
  let gl, instancing, vertexArrays, vao, enabled = false, drawnLastFrame = 0;
  let palette, effects = [], crater, buildings = [], sunk = new Map(), sinkK = 1, restoring;
  const programs = [], buffers = [], shaders = new Set();
  const visibleCar = c => c.fade>0;
  const activeCar = c => !c.stopped || c.fade>0;
  const movingCar = c => !c.stopped;
  const motionOff = () => typeof reducedMotion === 'function' ? reducedMotion() : reducedMotion;
  let traffic, initialLines=[], cars=[], instances=new Float32Array(0), lastTraffic, trafficWasStill=false;
  let lastRecycle=0, pick=seeded(2027), framesRequested=0, particlesScale=1, ladderSteps=[], windowStart, lastFrame;
  const intervals=new Float64Array(1024); let intervalCount=0;
  let timeScale=1, realTime=performance.now(), fxTime=realTime;
  const hidden = () => globalThis.document?.hidden === true;
  function clock() {
    const now=performance.now();
    if (!hidden()) fxTime+=(now-realTime)*timeScale;
    realTime=now; return fxTime;
  }
  const repaint = () => { if (!hidden()) map.triggerRepaint?.(); };
  function visibility() { realTime=performance.now(); lastTraffic=lastFrame=windowStart=undefined; intervalCount=0; if (!hidden()) repaint(); }
  const halve = list => list.filter((_,i) => i%4<2).slice(0,Math.floor(list.length/4)*2);
  function refill(lines=initialLines) {
    const cap=globalThis.innerWidth<900 ? 3000 : 6000;
    for (const l of lines) l.closed=l.flip=false; pick=seeded(2027);
    cars=seedCars(lines,cap);
    if (ladderSteps.length) cars=halve(cars); instances=new Float32Array(cars.length*8);
    advanceCars(cars,0,instances); lastTraffic=undefined; repaint();
  }
  // Off-screen cars move onto roads in view so any zoom shows a stream; the total never grows.
  function recycle() {
    const el=map.getContainer?.();
    if (!traffic || !cars.length || motionOff() || hidden() || !el || !map.unproject) return;
    lastRecycle=performance.now();
    // A desktop window shrunk to phone width drops to the phone cap.
    const cap=globalThis.innerWidth<900 ? 3000 : 6000;
    if (cars.length>cap) { cars=cars.slice(0,cap); instances=new Float32Array(cars.length*8); advanceCars(cars,0,instances); }
    // Box over the lower 80% of the screen: on a pitched map the horizon band spans kilometres in a
    // few pixels, and counting its roads would spread the cars thin where the viewer is looking.
    const w=el.clientWidth, h=el.clientHeight;
    const corners=pathMetres([[0,h*.2],[w,h*.2],[0,h],[w,h]].map(p => { const l=map.unproject(p); return [l.lng,l.lat]; }),traffic.center,earthRadius);
    const xs=corners.map(p => p[0]), ys=corners.map(p => p[1]);
    const box=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
    for (const m of recycleCars(cars,instances,viewSpans(traffic.lines,box),box,pick))
      Object.assign(cars[m.index],{line:m.line,position:m.position,direction:m.direction,fade:0});
  }
  function hideBuildings() {
    for (const b of buildings) map.setLayoutProperty?.(b.id,'visibility','none');
  }
  function measureFrame(now) {
    if (motionOff() || hidden()) { lastFrame=windowStart=undefined; intervalCount=0; return; }
    if (lastFrame!==undefined && intervalCount<intervals.length) intervals[intervalCount++]=now-lastFrame;
    lastFrame=now; windowStart ??= now;
    if (now-windowStart<3000) return;
    const step=fallbackStep(intervals.subarray(0,intervalCount),ladderSteps.length);
    if (step>ladderSteps.length) {
      ladderSteps.push(step);
      if (step===1) { cars=halve(cars); instances=new Float32Array(cars.length*8); }
      if (step===2) particlesScale=.5;
      if (step===3) hideBuildings();
    }
    windowStart=now; intervalCount=0;
  }
  function sink(k) {
    sinkK = k;
    if (map.isStyleLoaded && !map.isStyleLoaded()) return;
    for (const b of buildings) for (const [property, h] of Object.entries(b.paint))
      map.setPaintProperty(b.id, property, ['case', ['boolean', ['feature-state','sunk'], false], ['*',h,k], h]);
  }
  function scan(event) {
    if (!crater || map.isStyleLoaded && !map.isStyleLoaded()) return;
    for (const b of buildings) {
      if (event && event.sourceId !== b.source) continue;
      for (const feature of map.querySourceFeatures(b.source, {sourceLayer: b.sourceLayer})) {
        if (feature.id == null) continue;
        const center = footprintCentroid(feature.geometry);
        if (!center) continue;
        const [x,y] = pathMetres([center], crater.lngLat, earthRadius)[0];
        if (Math.hypot(x,y) > crater.radius) continue;
        const target = {source: b.source, sourceLayer: b.sourceLayer, id: feature.id};
        sunk.set(JSON.stringify(target), target);
        map.setFeatureState(target, {sunk: true});
      }
    }
  }
  function unbind() {
    map.off?.('sourcedata', scan); map.off?.('moveend', recycle);
    for (const target of sunk.values()) if (!map.isStyleLoaded || map.isStyleLoaded()) map.removeFeatureState?.(target, 'sunk');
    sunk.clear();
    for (const b of buildings) if ((!map.isStyleLoaded || map.isStyleLoaded()) && map.getLayer?.(b.id))
      for (const [key,value] of Object.entries(b.paint)) map.setPaintProperty(b.id,key,value);
    buildings = [];
  }
  function bind() {
    buildings = (map.getStyle?.().layers ?? []).filter(b => b.type === 'fill-extrusion' && b['source-layer'] === 'building').map(b => ({
      id:b.id, source:b.source, sourceLayer:b['source-layer'], paint: Object.fromEntries(
        ['height','base'].map(key => [`fill-extrusion-${key}`, b.paint?.[`fill-extrusion-${key}`] ?? 0]))}));
    map.on?.('sourcedata',scan); map.on?.('moveend',recycle);
    if (crater) { sink(sinkK); scan(); }
    if (ladderSteps.includes(3)) hideBuildings();
  }
  function dispose() {
    enabled = false; drawnLastFrame = 0;
    unbind();
    globalThis.document?.removeEventListener?.('visibilitychange',visibility);
    lastTraffic=lastFrame=windowStart=undefined; intervalCount=0;
    for (const shader of shaders) gl.deleteShader(shader);
    shaders.clear();
    if (vao) vertexArrays.remove(vao);
    vao = null;
    for (const b of buffers) gl.deleteBuffer(b);
    for (const p of programs) gl.deleteProgram(p.id);
    buffers.length = programs.length = 0;
  }
  function shader(type, source) {
    const result = gl.createShader(type);
    if (!result) throw new Error('FX unavailable');
    shaders.add(result); gl.shaderSource(result, source); gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error('FX unavailable');
    return result;
  }
  function add(effect) {
    effect.start = clock(); effects.push(effect); repaint();
  }
  function ring(lngLat, radius, duration) {
    if (!enabled || motionOff()) return;
    add({kind:'ring',lngLat,radius,duration});
  }
  // One instance layout: origin, velocity, size/birth/life/gravity, color,
  // growth/stretch/pixel-floor/reserved. All distances remain in metres.
  function mote(out, p, v, size, birth, life, gravity, color, alpha, growth=0, stretch=1, floor=0) {
    out.push(...p,...v,size,birth,life,gravity,...color,alpha,growth,stretch,floor,0);
  }
  function burst(e) {
    const random=seeded(e.seed), meteor=e.kind==='meteor', s=e.scale;
    e.chips=[]; e.embers=[]; e.dust=[]; e.smoke=[]; e.trail=[];
    const point=() => e.path?.length ? [...along(e.path,random()*e.length).point,1] : [0,0,1];
    const n=Math.min(100,Math.max(40,e.length/25));
    for (let i=0;i<(meteor ? Math.round(150*s) : n);i++) {
      const a=random()*Math.PI*2, speed=meteor ? 40+random()*120 : 15+random()*45;
      const up=60+random()*140, hot=meteor || random()<.35;
      mote(e.chips,point(),[Math.cos(a)*speed,Math.sin(a)*speed,up],3+random()*5,0,2*up/340,340,e.colors[1],.9,0,meteor ? 3 : 1,meteor ? 3 : 4);
    }
    if (!meteor) {
      // Dust puff: 20-60 m motes with an 8 px floor so it reads from z13 to z17.
      for (let i=0;i<n*1.5;i++) {
        const a=random()*Math.PI*2, v=10+random()*30;
        mote(e.dust,point(),[Math.cos(a)*v,Math.sin(a)*v,15+random()*20],20+random()*40,0,1.2,0,e.colors[1],.45,18,1,8);
      }
      return;
    }
    for (let i=0;i<40;i++) {
      const a=random()*Math.PI*2, d=random()*e.radius*.6;
      mote(e.embers,[Math.cos(a)*d,Math.sin(a)*d,2],[0,0,4],2,0,2,0,e.colors[0],.7,0,1,1);
    }
    for (let i=0;i<80;i++) {
      const a=random()*Math.PI*2, d=(.2+random()*.7)*e.radius;
      mote(e.dust,[Math.cos(a)*d,Math.sin(a)*d,2],[Math.cos(a)*12,Math.sin(a)*12,32],40+random()*80,0,2.5,0,e.colors[1],.22);
    }
    for (let i=0;i<6;i++) {
      const a=random()*Math.PI*2, d=random()*e.radius*.5;
      for (let j=0;j<10;j++) {
        const birth=j*.08, life=2.5-birth;
        mote(e.smoke,[Math.cos(a)*d,Math.sin(a)*d,2],[12,0,600*s/life],40,birth,life,0,e.colors[1],.16,160/life);
      }
    }
    const fall=e.duration*.00065; e.trailEnd=fall+1.1;
    // Trail motes are born at the head and shrink (size and pixel floor) as they die: a tapered streak.
    for (let birth=0;birth<fall;birth+=1/(2400*s)) {
      const h=1100*s*(1-birth/fall), d=h/Math.tan(35*Math.PI/180);
      const smoke=random()<.12, hot=random();
      mote(e.trail,[e.approach[0]*d,e.approach[1]*d,h],[(random()-.5)*12,(random()-.5)*12,12],(smoke ? 40 : 24+hot*16)*s,birth,smoke ? 1.1 : .3+hot*.35,0,smoke ? [.16,.16,.16] : [1,.5+hot*.45,.15+hot*.6],smoke ? .25 : .6,smoke ? 24 : -20*s,1,smoke ? 0 : 6+hot*8);
      e.trail[e.trail.length-1]=smoke ? 1 : 0;
    }
  }
  function fire({weapon, lngLat, radius = 0, scale = 1, duration = 500, line, seed = 1, still = false, started}) {
    const c = colors(), path = line?.length > 1 ? pathMetres(line,lngLat,earthRadius) : null;
    const length = path?.reduce((sum,p,i) => sum+(i ? Math.hypot(p[0]-path[i-1][0],p[1]-path[i-1][1]) : 0),0) ?? 0;
    if (weapon === 'meteor') scale=Math.sqrt(radius/500);
    const deadline=duration;
    if (weapon === 'flip') duration=1200;
    // Meteors fall in from screen upper-left. Approaching from the camera's side at 35 deg puts the
    // whole fall on the line of sight at pitch 55 (it projects onto the target and vanishes).
    const angle=(map.getBearing?.() ?? 0)*Math.PI/180, up=[Math.sin(angle),-Math.cos(angle)];
    const e = {approach:[.45*up[0]+.89*up[1],.45*up[1]-.89*up[0]],kind:weapon,lngLat,radius,scale,duration,path,length,seed,colors:c,done:still || motionOff()};
    if (weapon === 'meteor') { crater = e; sinkK = e.done ? 0 : 1; sink(sinkK); scan(); }
    if (path) e.cracks = cracks(path,seed);
    if (!e.done) burst(e);
    add(e);
    if (started !== undefined) effects.at(-1).start = clock()-(performance.now()-started)*timeScale;
    return e.done ? 0 : deadline;
  }
  // Impact shake: moves the map canvas only (not the camera), so hit tests, traffic and the panel stay put.
  // Damped seeded jitter, stronger for bigger meteors; slightly zoomed so the canvas edges never show.
  let shaking;
  function shake(e) {
    const canvas=map.getCanvas?.();
    if (!canvas?.animate || motionOff() || hidden()) return;
    const random=seeded(e.seed), amp=Math.min(14,7*e.scale), side=Math.max(1,Math.min(canvas.clientWidth,canvas.clientHeight)), frames=[];
    for (let i=0;i<=12;i++) {
      const k=i===12 ? 0 : amp*Math.pow(1-i/12,2), z=1+2*k/side;
      frames.push({transform:`translate(${((random()-.5)*2*k).toFixed(1)}px,${((random()-.5)*2*k).toFixed(1)}px) scale(${z.toFixed(4)})`});
    }
    shaking?.cancel();
    shaking=canvas.animate(frames,{duration:560/timeScale,easing:'linear'});
  }
  function settle() {
    if (restoring) { clear(); return; }
    effects = effects.filter(e => e === crater || e.kind === 'flip');
    for (const e of effects) if (e.kind === 'flip') e.done = true;
    if (crater) { crater.done = true; sink(0); scan(); }
    restoring = undefined; repaint();
  }
  function clear() {
    if (traffic) refill();
    shaking?.cancel(); shaking = undefined;
    effects = []; crater = undefined; restoring = undefined; sink(1);
    for (const target of sunk.values()) if (!map.isStyleLoaded || map.isStyleLoaded()) map.removeFeatureState?.(target,'sunk');
    sunk.clear(); drawnLastFrame = 0; repaint();
  }
  const layer = {
    id:'fx', type:'custom', renderingMode:'3d',
    onAdd(nextMap, context) {
      dispose(); map = nextMap; gl = context;
      const webgl2 = typeof gl.drawArraysInstanced === 'function';
      const angle = webgl2 ? null : gl.getExtension('ANGLE_instanced_arrays');
      if (!webgl2 && !angle) return;
      instancing = webgl2 ? {draw:(...a) => gl.drawArraysInstanced(...a), divisor:(i,v) => gl.vertexAttribDivisor(i,v), key:gl.VERTEX_ATTRIB_ARRAY_DIVISOR}
        : {draw:(...a) => angle.drawArraysInstancedANGLE(...a), divisor:(i,v) => angle.vertexAttribDivisorANGLE(i,v), key:angle.VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE};
      const oes = webgl2 ? null : gl.getExtension('OES_vertex_array_object');
      vertexArrays = webgl2 ? {create:() => gl.createVertexArray(), bind:v => gl.bindVertexArray(v), remove:v => gl.deleteVertexArray(v), key:gl.VERTEX_ARRAY_BINDING}
        : oes && {create:() => oes.createVertexArrayOES(), bind:v => oes.bindVertexArrayOES(v), remove:v => oes.deleteVertexArrayOES(v), key:oes.VERTEX_ARRAY_BINDING_OES};
      const oldBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
      try {
        const input = webgl2 ? 'in' : 'attribute', varying = webgl2 ? 'out' : 'varying';
        const head = webgl2 ? '#version 300 es\n' : '';
        const common = `${input} vec2 a;uniform mat4 m;uniform float s,r,z,t;uniform vec4 view;${varying} mediump vec2 p;${varying} mediump vec4 col;uniform vec4 c;uniform mediump float k;`;
        const vertices = [
          'p=a;col=c;gl_Position=m*vec4(a*r*s,z*s,1.);',
          `float age=max(0.,t-d.y),life=clamp(1.-age/d.z,0.,1.);p=a;col=vec4(mix(bc.rgb,vec3(dot(bc.rgb,vec3(.2126,.7152,.0722))),r),bc.a*life*step(d.y,t));vec3 pos=b+v*age/(1.+shape.w*age*3.);pos.z=max(1.,pos.z-.5*d.w*age*age);vec4 center=m*vec4(pos*s,1.);vec4 ahead=m*vec4((pos+v-vec3(0.,0.,d.w*age))*s,1.);vec2 dir=(ahead.xy/ahead.w-center.xy/center.w)*view.xy;dir=length(dir)>.001 ? normalize(dir) : vec2(1.,0.);float size=d.x+shape.x*age;float pixels=max(shape.z*(.2+.3*life),length((m*vec4(size*s,0.,0.,0.)).xy*view.xy)/max(.001,center.w)*.5);vec2 offset=(dir*a.x*shape.y+vec2(-dir.y,dir.x)*a.y)*pixels*2./view.xy;gl_Position=center+vec4(offset*center.w,0.,0.);`,
          `if(k>4.5){p=a;float light=min(1.,abs(v.y));col=vec4(c.rgb,c.a*v.x*light*(v.y<0. && v.y>-1.5 ? z : 1.));vec4 center=m*vec4(b.xy*s,s,1.);vec4 front=m*vec4(b.zw*v.z*.5*s,0.,0.);vec2 dir=front.xy*view.xy;float l=length(dir)/max(.001,center.w)*.5;dir=length(dir)>.001 ? normalize(dir) : vec2(1.,0.);vec4 side=m*vec4(vec2(-b.w,b.z)*1.5*s,0.,0.);float width=length(side.xy*view.xy)/max(.001,center.w)*.5;vec2 offset=(dir*((a.x+1.)*clamp(l,view.z,view.w)-clamp(l,view.z,view.w)*2.)+vec2(-dir.y,dir.x)*a.y*clamp(width,${streakBounds[2]},${streakBounds[3]}))*2./view.xy;gl_Position=center+vec4(offset*center.w,0.,0.);}else{p=b.yx;col=c;gl_Position=m*vec4(a*s,z*s,1.);}`,

        ];
        for (let i = 0; i < 3; i++) {
          const extra = i === 1 ? `${input} vec3 b,v;${input} vec4 d,bc,shape;` : i === 2 ? `${input} vec4 b,v;` : '';
          const vs = shader(gl.VERTEX_SHADER, head+common+extra+'void main(){'+vertices[i]+'}');
          const fs = shader(gl.FRAGMENT_SHADER, head+`precision mediump float;${webgl2 ? 'in' : 'varying'} mediump vec2 p;${webgl2 ? 'in' : 'varying'} mediump vec4 col;uniform float w,h;uniform mediump float k;${webgl2 ? 'out vec4 o;' : ''}void main(){float r=length(p),alpha=1.;if(k>4.5){alpha=mix(step(abs(p.y),.65),exp(-4.*p.y*p.y)*pow((p.x+1.)*.5,1.5),h);}else if(k>3.5){alpha=pow(1.-smoothstep(0.,1.,abs(r-(1.-w*.5))/(w*.5)),2.);}else if(k<.5){if(r>1.)discard;alpha=smoothstep(1.-w,1.,r);}else if(k<2.5){alpha=pow(1.-smoothstep(0.,1.,r),2.);}else{alpha=pow(1.-smoothstep(0.,1.,abs(p.y)),2.)*(1.-smoothstep(.8,1.,abs(p.x)));}float a=col.a*alpha;${webgl2 ? 'o' : 'gl_FragColor'}=vec4(col.rgb*mix(1.,a,h),a);}`);
          const id = gl.createProgram();
          if (!id) throw new Error('FX unavailable');
          programs.push({id});
          gl.attachShader(id,vs); gl.attachShader(id,fs);
          ['a','b','v','d','bc','shape'].forEach((name,index) => gl.bindAttribLocation(id,index,name));
          gl.linkProgram(id);
          if (!gl.getProgramParameter(id,gl.LINK_STATUS)) throw new Error('FX unavailable');
          programs[i].u = Object.fromEntries(['m','s','r','z','t','c','w','k','h','view'].map(n => [n,gl.getUniformLocation(id,n)]));
          gl.detachShader(id,vs); gl.detachShader(id,fs);
        }
        for (let i = 0; i < 3; i++) {
          const b = gl.createBuffer(); if (!b) throw new Error('FX unavailable'); buffers.push(b);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER,buffers[0]);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
        if (vertexArrays) { vao = vertexArrays.create(); if (!vao) throw new Error('FX unavailable'); }
        enabled = true; bind(); globalThis.document?.addEventListener?.('visibilitychange',visibility); repaint();
      } catch { dispose(); }
      finally {
        for (const item of shaders) gl.deleteShader(item);
        shaders.clear(); gl.bindBuffer(gl.ARRAY_BUFFER,oldBuffer);
      }
    },
    render(context,matrix) {
      drawnLastFrame = 0;
      if (!enabled || context !== gl || gl.isContextLost() || hidden()) return;
      const now = clock(); measureFrame(performance.now());
      effects = effects.filter(e => e === crater || e.kind === 'flip' || now-e.start < (e.kind === 'meteor' ? e.duration+2500 : e.kind === 'stomp' ? 2300 : e.duration));
      if (!effects.length && !restoring && !cars.length) return;
      const old = Object.fromEntries(['CURRENT_PROGRAM','ARRAY_BUFFER_BINDING','BLEND_SRC_RGB','BLEND_DST_RGB','BLEND_SRC_ALPHA','BLEND_DST_ALPHA','BLEND_EQUATION_RGB','BLEND_EQUATION_ALPHA','DEPTH_WRITEMASK','DEPTH_FUNC'].map(k => [k,gl.getParameter(gl[k])]));
      const oldVao = vertexArrays && gl.getParameter(vertexArrays.key);
      const blend = gl.isEnabled(gl.BLEND), depth = gl.isEnabled(gl.DEPTH_TEST), cull = gl.isEnabled(gl.CULL_FACE);
      if (vao) vertexArrays.bind(vao);
      const attrs = Array.from({length:6},(_,i) => ({
        values:Object.fromEntries(['ENABLED','BUFFER_BINDING','SIZE','TYPE','NORMALIZED','STRIDE'].map(k => [k,gl.getVertexAttrib(i,gl[`VERTEX_ATTRIB_ARRAY_${k}`])])),
        offset:gl.getVertexAttribOffset(i,gl.VERTEX_ATTRIB_ARRAY_POINTER), divisor:gl.getVertexAttrib(i,instancing.key)}));
      let active = false;
      const still=motionOff();
      const dt=lastTraffic===undefined || still || trafficWasStill ? 0 : Math.max(0,(now-lastTraffic)/1000);
      lastTraffic=now; trafficWasStill=still;
      try {
        gl.enable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
        gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(theme === 'dark' ? gl.ONE : gl.SRC_ALPHA,theme === 'dark' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        if (traffic && cars.length) {
          if (performance.now()-lastRecycle>1000) recycle();
          advanceCars(cars,dt,instances);
          const p=programs[2], u=p.u, origin=traffic.origin, translated=traffic.matrix;
          translated.set(matrix);
          for (let row=0;row<4;row++) translated[12+row]=matrix[12+row]+matrix[row]*origin[0]+matrix[4+row]*origin[1];
          gl.useProgram(p.id); gl.uniformMatrix4fv(u.m,false,translated);
          gl.uniform1f(u.s,traffic.scale); gl.uniform1f(u.k,5); gl.uniform1f(u.z,theme === 'dark' ? .3 : .7); // opposite-direction tail strength
          gl.uniform1f(u.h,theme === 'dark' ? 1 : 0); gl.uniform4f(u.c,...(palette ??= colors())[0],(map.getZoom?.() ?? 13)<=11 ? .3 : 1);
          for (let i=0;i<cars.length;i++) if ((map.getZoom?.() ?? 13)<=11 && !cars[i].line.major || theme === 'light' && cars[i].line.extra) instances[i*8+4]=0;
          const dpr=globalThis.devicePixelRatio || 1;
          gl.uniform4f(u.view,(gl.drawingBufferWidth || 1)/dpr,(gl.drawingBufferHeight || 1)/dpr,...streakBounds.slice(0,2));
          gl.bindBuffer(gl.ARRAY_BUFFER,buffers[0]); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0); instancing.divisor(0,0);
          gl.bindBuffer(gl.ARRAY_BUFFER,buffers[2]); gl.bufferData(gl.ARRAY_BUFFER,instances,gl.DYNAMIC_DRAW);
          for (let i=1;i<=2;i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i,4,gl.FLOAT,false,32,i===1 ? 0 : 16); instancing.divisor(i,1); }
          instancing.draw(gl.TRIANGLES,0,6,cars.length); drawnLastFrame++;
          for (let i=1;i<=2;i++) { instancing.divisor(i,0); gl.disableVertexAttribArray(i); }
        }
        for (const e of effects) {
          gl.blendFunc(theme === 'dark' ? gl.ONE : gl.SRC_ALPHA,theme === 'dark' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
          const elapsed = e.done ? e.duration+2500 : now-e.start;
          const progress = Math.min(1,elapsed/e.duration), impact = e.duration*0.65, tail = Math.max(0,elapsed-impact)/1000;
          active ||= !e.done && elapsed < (e.kind === 'meteor' ? e.duration+2500 : e.kind === 'stomp' ? 2300 : e.duration);
          const c = e.colors ?? (palette ??= colors()), origin = mercatorXYZ(e.lngLat,0,earthRadius), scale = 1/metresPerMercatorUnit(e.lngLat[1],earthRadius);
          const translated = new Float32Array(matrix), mpp=1/(512*2**(map.getZoom?.() ?? 13)*scale);
          for (let row=0;row<4;row++) translated[12+row]=matrix[12+row]+matrix[row]*origin[0]+matrix[4+row]*origin[1];
          function setup(index,color,alpha=1,z=0.1) {
            const p=programs[index], u=p.u; gl.useProgram(p.id);
            gl.uniformMatrix4fv(u.m,false,translated); gl.uniform1f(u.s,scale); gl.uniform1f(u.z,z);
            gl.uniform4f(u.c,...color,alpha); gl.uniform1f(u.h,theme === 'dark' ? 1 : 0);
            gl.uniform4f(u.view,(gl.drawingBufferWidth || 1)/(globalThis.devicePixelRatio || 1),(gl.drawingBufferHeight || 1)/(globalThis.devicePixelRatio || 1),0,0); return u;
          }
          function disc(radius,width,color,alpha=1,fill=false,z=1,soft=false) {
            if (!(radius>0) || alpha<=0) return;
            const u=setup(0,color,alpha,z);
            gl.bindBuffer(gl.ARRAY_BUFFER,buffers[0]); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0); instancing.divisor(0,0);
            gl.uniform1f(u.r,radius); gl.uniform1f(u.w,Math.min(1,width/radius)); gl.uniform1f(u.k,soft ? 4 : fill ? 1 : 0);
            instancing.draw(gl.TRIANGLES,0,6,1); drawnLastFrame++;
          }
          function particles(data,time,dust=false) {
            if (motionOff() || !data.length) return;
            gl.blendFunc(theme === 'dark' ? gl.ONE : gl.SRC_ALPHA,dust || theme !== 'dark' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);
            const u=setup(1,c[0]); gl.uniform1f(u.r,elapsed>=e.duration ? 1 : 0); gl.uniform1f(u.t,time); gl.uniform1f(u.k,2);
            gl.bindBuffer(gl.ARRAY_BUFFER,buffers[0]); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0); instancing.divisor(0,0);
            gl.bindBuffer(gl.ARRAY_BUFFER,buffers[1]); const instances=new Float32Array(data);
            gl.bufferData(gl.ARRAY_BUFFER,instances,gl.DYNAMIC_DRAW);
            // Halving keeps every other mote (stride), not the oldest half, so trails stay whole.
            let offset=0, skip=Math.round(1/particlesScale);
            for (let i=1;i<6;i++) { const size=i<3 ? 3 : 4; gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i,size,gl.FLOAT,false,72*skip,offset); instancing.divisor(i,1); offset+=size*4; }
            instancing.draw(gl.TRIANGLES,0,6,Math.ceil(data.length/18/skip)); drawnLastFrame++;
            for (let i=1;i<6;i++) { instancing.divisor(i,0); gl.disableVertexAttribArray(i); }
          }
          function ribbon(path,width,color,alpha=1,fraction=1,taper=false) {
            const vertices=ribbonVertices(path,width,fraction,taper);
            const u=setup(2,color,alpha); gl.uniform1f(u.k,3);
            gl.bindBuffer(gl.ARRAY_BUFFER,buffers[2]); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,16,0); instancing.divisor(0,0);
            gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,16,8); instancing.divisor(1,0);
            instancing.draw(gl.TRIANGLES,0,vertices.length/4,1); gl.disableVertexAttribArray(1); drawnLastFrame++;
          }
          if (e.kind === 'ring') disc(e.radius*easeOutCubic(progress),1/(map.getZoom ? 512*2**map.getZoom()*scale : 0.1),c[0],1-progress,false,1,true);
          if (e.kind === 'particle') disc(15,1,c[0],1,true,400*easeOutCubic(progress));
          if (e.kind === 'stomp' && e.path && !e.done) {
            const cool=Math.min(1,Math.max(0,(elapsed-120)/400)), color=c[0].map((v,i) => v+(c[2][i]-v)*cool);
            for (const width of [14,3]) ribbon(e.path,Math.max(width,width*mpp/2),color,Math.min(1,elapsed/120)*Math.max(0,1-(elapsed-500)/600));
            // Cracks: a dark fissure with a red glow that cools from hot to dim (Stomp closes the road).
            const grow=Math.min(1,elapsed/150), fade=Math.max(0,1-elapsed/2300), heat=Math.max(.3,1-elapsed/900);
            for (const branch of e.cracks) {
              gl.blendFunc(theme === 'dark' ? gl.ONE : gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
              ribbon(branch,Math.max(6,3*mpp),[.025,.02,.015],.95*fade,grow,true);
              gl.blendFunc(theme === 'dark' ? gl.ONE : gl.SRC_ALPHA,theme === 'dark' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
              ribbon(branch,Math.max(12,6*mpp),c[2],.8*heat*fade,grow,true);
              ribbon(branch,Math.max(3,1.5*mpp),[1,.8,.7],heat*heat*fade,grow,true);
            }
            particles(e.chips,elapsed/1000,true); particles(e.dust,elapsed/1000,true); gl.blendFunc(theme === 'dark' ? gl.ONE : gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA); disc(120*easeOutCubic(Math.min(1,elapsed/900)),Math.max(8,3*mpp),c[1],Math.max(0,1-elapsed/1600),false,1,true);
          }
          if (e.kind === 'flip' && e.path) {
            const time=e.done || elapsed>=e.duration ? .8 : elapsed/1000, fade=1;
            if (time>=.4 && time<.65) ribbon(e.path,18,c[0],.9,Math.min(1,(time-.4)/.15));
            const size=Math.max(12,8*mpp/Math.max(.5,Math.cos((map.getPitch?.() ?? 0)*Math.PI/180)));
            for (const {point:p,angle:a} of chevrons(e.path,e.length,time,Math.max(40,2*size))) {
              const q=[Math.cos(a),Math.sin(a)];
              const shape=[[p[0]-q[0]*size-q[1]*size*.65,p[1]-q[1]*size+q[0]*size*.65],p,[p[0]-q[0]*size+q[1]*size*.65,p[1]-q[1]*size-q[0]*size*.65]];
              ribbon(shape,Math.max(5,3*mpp),c[0],fade);
            }
          }
          if (e.kind === 'meteor') {
            // Spent motes are released; the crater itself stays in effects until Rebuild.
            if (elapsed/1000>e.trailEnd) e.trail=[];
            if (elapsed>=e.duration+2500) e.chips=e.embers=e.dust=e.smoke=[];
            if (!e.done && e.trail?.length) {
              const light=[], smoke=[], t=e.trail;
              for (let i=0;i<t.length;i+=18) {
                const age=elapsed/1000-t[i+7];
                if (age<0 || age>t[i+8]) continue;
                const out=t[i+17] ? smoke : light;
                for (let j=i;j<i+18;j++) out.push(t[j]);
              }
              particles(light,elapsed/1000); particles(smoke,elapsed/1000,true);
            }
            if (elapsed<impact) {
              const h=1100*e.scale*(1-elapsed/impact), d=h/Math.tan(35*Math.PI/180), head=[];
              for (const [size,alpha,floor,color] of [[220,.3,110,[1,.3,.15]],[90,.7,60,[1,.6,.18]],[30,1,34,[1,1,1]]])
                mote(head,[e.approach[0]*d,e.approach[1]*d,h],[-e.approach[0],-e.approach[1],-Math.tan(35*Math.PI/180)],size*e.scale,0,1,0,color,alpha,0,1,floor);
              particles(head,0);
            } else {
              if (!e.done && !e.shook && tail<.25) { e.shook=true; shake(e); }
              const fade=(restoring ? Math.max(0,1-(now-restoring.start)/320) : 1)*Math.min(1,tail/.3);
              gl.blendFunc(theme === 'dark' ? gl.ONE : gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
              disc(e.radius*1.05,1,theme === 'dark' ? [0,0,0] : [.12,.12,.12],.45*fade,true,.2);
              disc(e.radius,e.radius*.02,c[2],.6*fade,false,.4,true);
              gl.blendFunc(theme === 'dark' ? gl.ONE : gl.SRC_ALPHA,theme === 'dark' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
              if (!e.done && elapsed<e.duration+2500) {
                for (const delay of [0,120]) {
                  const t=(elapsed-impact-delay)/(e.duration-impact);
                  if (t>=0 && t<1) disc(e.radius*easeOutCubic(t),e.radius*.08,c[0],Math.min(1,(1-t)/.3)*(delay ? .35 : 1));
                }
                if (tail<.25) {
                  disc(e.radius*(.3+tail*2.4),1,[1,.55,.12],.9*(1-tail/.25),true,2);
                  disc(e.radius*(.08+tail),1,[1,1,1],1-tail/.25,true,3);
                }
                particles(e.chips,tail); particles(e.embers,tail);
                const after=Math.max(0,(elapsed-e.duration)/1000);
                if (elapsed>=e.duration) { particles(e.dust,after,true); particles(e.smoke,after,true); }
              }
              if (!restoring) sink(e.done ? 0 : Math.max(0,1-tail/1.2));
            }
          }
        }
        if (restoring) {
          const t=Math.min(1,(now-restoring.start)/320); sink(restoring.k+(1-restoring.k)*t);
          if (t>=1) clear(); else active=true;
        }
      } finally {
        if (vao) vertexArrays.bind(oldVao);
        else attrs.forEach(({values:a,offset,divisor},i) => {
          if (a.BUFFER_BINDING) { gl.bindBuffer(gl.ARRAY_BUFFER,a.BUFFER_BINDING); gl.vertexAttribPointer(i,a.SIZE,a.TYPE,a.NORMALIZED,a.STRIDE,offset); }
          instancing.divisor(i,divisor); if (a.ENABLED) gl.enableVertexAttribArray(i); else gl.disableVertexAttribArray(i);
        });
        gl.bindBuffer(gl.ARRAY_BUFFER,old.ARRAY_BUFFER_BINDING); gl.useProgram(old.CURRENT_PROGRAM);
        gl.blendFuncSeparate(old.BLEND_SRC_RGB,old.BLEND_DST_RGB,old.BLEND_SRC_ALPHA,old.BLEND_DST_ALPHA);
        gl.blendEquationSeparate(old.BLEND_EQUATION_RGB,old.BLEND_EQUATION_ALPHA); gl.depthMask(old.DEPTH_WRITEMASK); gl.depthFunc(old.DEPTH_FUNC);
        if (!blend) gl.disable(gl.BLEND); if (!depth) gl.disable(gl.DEPTH_TEST); if (cull) gl.enable(gl.CULL_FACE);
      }
      if (!motionOff()) {
        if (cars.length && cars.some(activeCar)) { framesRequested++; repaint(); }
        else if (active) repaint();
      }
    },
    onRemove:dispose,
  };
  return {layer,ring,fire,settle,clear, clock,
    timeScale(k) { clock(); timeScale=k; repaint(); },
    setTraffic(data,classes) {
      traffic=trafficLines(data,earthRadius,classes);
      traffic.origin=mercatorXYZ(traffic.center,0,earthRadius);
      traffic.scale=1/metresPerMercatorUnit(traffic.center[1],earthRadius);
      traffic.matrix=new Float32Array(16); initialLines=traffic.lines; refill();
    },
    editTraffic(ids,flip,after) {
      if (!traffic) return;
      editCars(cars,ids,flip); markLines(traffic.lines,ids,flip);
      if (motionOff()) for (const c of cars) if (c.stopped) c.fade=0;
      if (theme === 'dark' && after?.offsets.length>1) {
        const extra=trafficLines(after,earthRadius,[],traffic.center,true).lines;
        const cap=(globalThis.innerWidth<900 ? 3000 : 6000)/(ladderSteps.length ? 2 : 1);
        const bonus=seedCars(extra,Math.min(Math.floor(cap/4),Math.max(0,cap-cars.length)));
        // Reserve space for after-path traffic even when the baseline fills the cap.
        if (!bonus.length && extra.length) { cars=cars.slice(0,Math.floor(cap*.75)); cars.push(...seedCars(extra,Math.floor(cap/4))); }
        else cars.push(...bonus);
        instances=new Float32Array(cars.length*8); advanceCars(cars,0,instances);
      }
      repaint();
    },
    trafficStats:() => ({cars:enabled ? cars.filter(visibleCar).length : 0,moving:enabled && !motionOff() && !hidden() && cars.some(movingCar),paused:hidden() || motionOff() || !enabled}),
    trafficSample(n) { const sample=new Float32Array(cars.length*8); advanceCars(cars,0,sample); return Array.from({length:Math.min(n,cars.length)},(_,i) => [sample[i*8],sample[i*8+1]]); },
    trafficFramesRequested:() => framesRequested,
    perfStats:() => ({cars:enabled ? cars.filter(visibleCar).length : 0,particles_scale:particlesScale,ladder_steps:[...ladderSteps]}),
    endState:() => ({crater:Boolean(crater),sunk:sunk.size,sinkK}),
    particle(lngLat) { if (enabled && !motionOff()) add({kind:'particle',lngLat,duration:1500}); },
    rebuild() { refill(); if (!crater || motionOff()) clear(); else { effects=[crater]; crater.done=true; restoring={start:clock(),k:sinkK}; repaint(); } },
    ringRadius() {
      const e=effects.findLast(e => e.kind==='meteor' || e.kind==='ring'); if (!e) return null;
      const elapsed=e.done ? e.duration : clock()-e.start;
      const t=e.kind==='meteor' ? Math.max(0,(elapsed-e.duration*0.65)/(e.duration*0.35)) : elapsed/e.duration;
      return {center:e.lngLat,radius:e.radius*easeOutCubic(Math.min(1,t))};
    },
    setTheme(value) { theme=value; palette=colors(); for (const e of effects) e.colors=palette; },
    stats:() => ({enabled,buffers:buffers.length,programs:programs.length,textures:0,drawnLastFrame}),
  };
}
