import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {monochrome} from '../mono.js';

const transform = value => monochrome({layers:[{type:'fill',paint:{'fill-color':value}}]}).layers[0].paint['fill-color'];
const channels = value => value.match(/[\d.]+/g).map(Number);
const linear = x => x <= 0.04045 ? x/12.92 : ((x+0.055)/1.055)**2.4;
function checkGray(value, expected, alpha = 1) {
  const [r,g,b,a] = channels(value);
  assert.equal(r,g); assert.equal(g,b);
  assert.ok(Math.abs(linear(r/255)-expected)<1e-12, `${value}: ${expected}`);
  assert.equal(a,alpha);
}

test('literal colors retain linear-light luminance and alpha', () => {
  for (const value of ['#f00','#ff0000','rgb(255, 0, 0)','rgb(100% 0% 0%)','hsl(0, 100%, 50%)']) checkGray(transform(value),0.2126);
  checkGray(transform('#0f08'),0.7152,136/255);
  checkGray(transform('#0000ff80'),0.0722,128/255);
  checkGray(transform('rgba(0, 0, 255, 0.3)'),0.0722,0.3);
  checkGray(transform('hsla(120, 100%, 50%, 0.25)'),0.7152,0.25);
  checkGray(transform('transparent'),0,0);
  checkGray(transform('black'),0);
  checkGray(transform('WHITE'),1);
});

test('only color output arms change; labels and property names stay exact', () => {
  const red = transform('#f00'), blue = transform('#00f');
  assert.deepEqual(transform(['match',['get','red'],['red','blue'],'#f00','#00f']), ['match',['get','red'],['red','blue'],red,blue]);
  assert.deepEqual(transform(['case',['==',['get','blue'],'red'],'#f00','#00f']), ['case',['==',['get','blue'],'red'],red,blue]);
  assert.deepEqual(transform(['interpolate',['linear'],['get','red'],0,'#f00',1,'#00f']), ['interpolate',['linear'],['get','red'],0,red,1,blue]);
  assert.deepEqual(transform(['step',['get','red'],'#f00',2,'#00f']), ['step',['get','red'],red,2,blue]);
  assert.deepEqual(transform(['coalesce',['get','red'],'#00f']), ['coalesce',['get','red'],blue]);
  assert.deepEqual(transform({property:'red',stops:[[0,'#f00'],[1,'#00f']]}), {property:'red',stops:[[0,red],[1,blue]]});
  assert.deepEqual(transform(['get','red']), ['get','red']);
});

function evaluate(expr, props) {
  if (!Array.isArray(expr)) return expr;
  const [op,...args] = expr, v = args.map(arg => evaluate(arg,props));
  if(op==='get') return props[v[0]];
  if(op==='case') return v[0] ? v[1] : v[2];
  if(op==='<=') return v[0]<=v[1];
  if(op==='+') return v.reduce((a,b)=>a+b);
  if(op==='*') return v.reduce((a,b)=>a*b);
  if(op==='/') return v[0]/v[1];
  if(op==='-') return v[0]-v[1];
  if(op==='^') return v[0]**v[1];
  if(op==='rgba') return v;
  throw new Error(op);
}
test('rgb and rgba expressions preserve dynamic channel luminance and alpha', () => {
  checkGray(transform(['rgb',255,0,0]),0.2126);
  checkGray(transform(['rgba',0,255,0,0.4]),0.7152,0.4);
  const expr = transform(['rgba',['get','r'],['get','g'],['get','b'],['get','alpha']]);
  for (const r of [0,5,200]) {
    const [gray,g,b,a] = evaluate(expr,{r,g:20,b:255,alpha:0.2});
    assert.equal(gray,g); assert.equal(g,b); assert.equal(a,0.2);
    assert.ok(Math.abs(linear(gray/255)-(0.2126*linear(r/255)+0.7152*linear(20/255)+0.0722))<1e-12);
  }
});

function outputs(value) {
  if(typeof value === 'string') return [value];
  if(value.stops) return value.stops.flatMap(([,out])=>outputs(out));
  const op=value[0];
  if(op==='interpolate') return value.filter((_,i)=>i>=4 && i%2===0).flatMap(outputs);
  if(op==='step') return value.filter((_,i)=>i>=2 && i%2===0).flatMap(outputs);
  if(op==='match') return [...value.filter((_,i)=>i>=3 && i<value.length-1 && i%2===1),value.at(-1)].flatMap(outputs);
  if(op==='case') return [...value.filter((_,i)=>i>=2 && i<value.length-1 && i%2===0),value.at(-1)].flatMap(outputs);
  if(op==='coalesce') return value.slice(1).flatMap(outputs);
  return [];
}
for (const theme of ['dark','positron']) test(`real ${theme} style: every color gray, all other values exact, sprites removed`, () => {
  const style = JSON.parse(readFileSync(new URL(`./fixtures/openfreemap_${theme}.json`,import.meta.url)));
  const original = structuredClone(style), output = monochrome(style);
  assert.deepEqual(style,original);
  for(let i=0;i<style.layers.length;i++) {
    const before = style.layers[i], after = output.layers[i];
    for(const [key,value] of Object.entries(before.paint ?? {})) {
      if(key.endsWith('-color')) for(const out of outputs(after.paint[key])) {
        assert.match(out,/^rgba\(/, `${before.id}: ${out}`);
        const [r,g,b] = channels(out); assert.equal(r,g); assert.equal(g,b);
      } else if(key !== 'raster-saturation') assert.deepEqual(after.paint[key],value);
    }
    if(before.type==='symbol') {
      assert.equal(after.layout?.['icon-image'],undefined);
      if(!before.layout?.['text-field']) assert.equal(after.layout.visibility,'none');
      else assert.deepEqual(after.layout['text-field'],before.layout['text-field']);
    }
    if(before.type==='raster') assert.equal(after.paint['raster-saturation'],-1);
    const expected = structuredClone(before);
    for(const key of Object.keys(expected.paint ?? {})) if(key.endsWith('-color')) expected.paint[key]=after.paint[key];
    if(expected.type==='symbol') { if(expected.layout) delete expected.layout['icon-image']; if(!expected.layout?.['text-field']) expected.layout={...expected.layout,visibility:'none'}; }
    if(expected.type==='raster') expected.paint={...expected.paint,'raster-saturation':-1};
    assert.deepEqual(after,expected);
  }
  assert.deepEqual(output.sources,style.sources);
});

test('other CSS color names pass through unchanged', () => {
  for (const name of ['red', 'blue', 'rebeccapurple', 'LightGoldenRodYellow', 'currentColor']) {
    assert.equal(transform(name), name);
  }
});
