export const metresPerMercatorUnit = (latitude, earthRadius) =>
  2 * Math.PI * earthRadius * Math.cos(latitude * Math.PI / 180);

export function mercatorXYZ([lng, lat], altitude, earthRadius) {
  const phi = lat * Math.PI / 180;
  return [(lng + 180) / 360, (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2,
    altitude / metresPerMercatorUnit(lat, earthRadius)];
}

export function mercatorRing(lngLat, radius, count, earthRadius) {
  const [x, y, z] = mercatorXYZ(lngLat, 0, earthRadius);
  const r = radius / metresPerMercatorUnit(lngLat[1], earthRadius);
  return Array.from({length: count}, (_, i) => {
    const angle = i * 2 * Math.PI / count;
    return [x + r * Math.cos(angle), y + r * Math.sin(angle), z];
  });
}

export const easeOutCubic = t => 1 - (1 - t) ** 3;
export const easeInCubic = t => t ** 3;

export function seeded(seed) {
  let value = Number(seed) >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

export function pathMetres(line, center, earthRadius) {
  const origin = mercatorXYZ(center, 0, earthRadius), scale = metresPerMercatorUnit(center[1], earthRadius);
  return line.map(point => { const p = mercatorXYZ(point, 0, earthRadius); return [(p[0]-origin[0])*scale, (p[1]-origin[1])*scale]; });
}

export function along(line, distance) {
  for (let i = 1; i < line.length; i++) {
    const a = line[i-1], b = line[i], length = Math.hypot(b[0]-a[0], b[1]-a[1]);
    if (distance <= length || i === line.length-1) {
      const t = length ? Math.min(1, distance/length) : 0;
      return {point: [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t], angle: Math.atan2(b[1]-a[1], b[0]-a[0])};
    }
    distance -= length;
  }
  return {point: line[0] ?? [0,0], angle: 0};
}

export function cracks(line, seed) {
  const random = seeded(seed);
  const length=line.reduce((sum,p,i) => sum+(i ? Math.hypot(p[0]-line[i-1][0],p[1]-line[i-1][1]) : 0),0);
  return Array.from({length:6+Math.floor(random()*5)},() => {
    const {point:origin,angle}=along(line,random()*length), side=random()<.5 ? -1 : 1, reach=20+40*random();
    return [origin,...Array.from({length:3},(_,j) => {
      const turn = angle+side*(0.6+random());
      return [origin[0]+Math.cos(turn)*reach*(j+1)/3,origin[1]+Math.sin(turn)*reach*(j+1)/3];
    })];
  });
}

// Triangle ribbon with arc-length taper; offsets and widths are ground metres.
export function ribbonVertices(path, width, fraction = 1, taper = false) {
  const total=path.reduce((n,p,i) => n+(i ? Math.hypot(p[0]-path[i-1][0],p[1]-path[i-1][1]) : 0),0), vertices=[];
  let distance=0;
  for (let i=1;i<path.length && distance<total*fraction;i++) {
    const a=path[i-1], end=path[i], length=Math.hypot(end[0]-a[0],end[1]-a[1]);
    if (!length) continue;
    const step=Math.min(length,total*fraction-distance), b=end.map((v,j) => a[j]+(v-a[j])*step/length);
    const x=-(end[1]-a[1])/length*width/2, y=(end[0]-a[0])/length*width/2;
    const start=taper ? 1-distance/total : 1, finish=taper ? 1-(distance+step)/total : 1;
    const v=(p,k,side) => [p[0]+x*k*side,p[1]+y*k*side,side,0];
    const al=v(a,start,1), ar=v(a,start,-1), bl=v(b,finish,1), br=v(b,finish,-1);
    vertices.push(...al,...ar,...bl,...bl,...ar,...br); distance+=step;
  }
  return vertices;
}
export function chevrons(path, length, time, gap = 40) {
  const reverse=time>=.55, t=Math.min(time,.4)/.4;
  const offset=reverse ? -gap*(time-.55)/.65 : gap*(2*t-t*t);
  const result=[];
  for (let d=((offset%gap)+gap)%gap;d<length;d+=gap) {
    const {point,angle}=along(path,d);
    result.push({point,angle:angle+(reverse ? Math.PI : 0)});
  }
  return result;
}
export const carStreakLength = speed => Math.max(25,Math.min(60,speed/15));
export const streakBounds = [3,20,1.5,2.5]; // Half length/width in CSS pixels.
export const streakSize = (length, pixelsPerMetre) => [
  Math.max(streakBounds[0],Math.min(streakBounds[1],length/2*pixelsPerMetre)),
  Math.max(streakBounds[2],Math.min(streakBounds[3],1.5*pixelsPerMetre))];

export function footprintCentroid(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const origin = polygons[0]?.[0]?.[0] ?? [0,0];
  let area = 0, x = 0, y = 0;
  for (const rings of polygons) for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]; let a = 0, cx = 0, cy = 0;
    for (let i = 1; i < ring.length; i++) {
      const p = ring[i-1].map((v,j) => v-origin[j]), q = ring[i].map((v,j) => v-origin[j]), cross = p[0]*q[1]-q[0]*p[1];
      a += cross; cx += (p[0]+q[0])*cross; cy += (p[1]+q[1])*cross;
    }
    if (!a) continue;
    const weight = (r ? -1 : 1)*Math.abs(a);
    area += weight; x += cx/(3*a)*weight; y += cy/(3*a)*weight;
  }
  return area ? [origin[0]+x/area,origin[1]+y/area] : null;
}

// Visual speeds in m/s, multiplied by 30; export class indices are not assumed.
const trafficSpeeds = {motorway:30, trunk:25, primary:20, secondary:16, tertiary:13,
  motorway_link:16, trunk_link:14, primary_link:12, residential:9, living_street:5};
export const trafficSpeed = name => (trafficSpeeds[name] ?? 10)*30;
export function trafficLines(data, earthRadius, classes = [], center = null, extra = false) {
  center ??= [data.coords[0] ?? 0, data.coords[1] ?? 0];
  const lines = [];
  for (let i=0; i<data.offsets.length-1; i++) {
    const coords=[];
    for (let j=data.offsets[i];j<data.offsets[i+1];j++) coords.push([data.coords[j*2],data.coords[j*2+1]]);
    if (coords.length<2) continue;
    const points=pathMetres(coords,center,earthRadius), cumulative=new Float64Array(points.length);
    const ratio=metresPerMercatorUnit(coords[0][1],earthRadius)/metresPerMercatorUnit(center[1],earthRadius);
    for (let j=1;j<points.length;j++) cumulative[j]=cumulative[j-1]+Math.hypot(points[j][0]-points[j-1][0],points[j][1]-points[j-1][1])*ratio;
    const length=cumulative.at(-1);
    if (length>0) lines.push({points,cumulative,length,ratio,id:extra ? null : data.way_ids[i],
      oneway:extra || Boolean(data.oneway[i]), weight:extra ? 2 : data.weights[i],
      major:['motorway','trunk'].includes(classes[data.highway?.[i]]), speed:trafficSpeed(classes[data.highway?.[i]]),extra});
  }
  return {center,lines};
}
export function seedCars(lines, cap, seed = 2027) {
  const random=seeded(seed), total=lines.reduce((n,l) => n+l.weight*l.length,0), cars=[];
  if (!total || cap<2) return cars;
  // Seed pairs so even a quiet two-way road carries both directions.
  const count=Math.min(Math.floor(cap/2),Math.ceil(total/600)), stride=total/count;
  let mark=random()*stride, end=0;
  for (const line of lines) {
    end+=line.weight*line.length;
    while (mark<end && cars.length<count*2) {
      for (const direction of [1,line.oneway ? 1 : -1])
        cars.push({line,direction,position:random()*line.length,fade:1,stopped:false});
      mark+=stride;
    }
  }
  return cars;
}
export function editCars(cars, ids, flip) {
  const hit=new Set(ids);
  for (const car of cars) if (hit.has(car.line.id)) {
    if (flip && car.line.oneway) car.direction*=-1;
    else if (!flip) car.stopped=true;
  }
}
// Write x/y and unit travel direction into an existing instance array. Mercator y points south.
export function carPosition(car, out, offset = 0) {
  const l=car.line, c=l.cumulative, points=l.points;
  let lo=1, hi=c.length-1;
  while (lo<hi) { const mid=(lo+hi)>>>1; if (c[mid]<car.position) lo=mid+1; else hi=mid; }
  const a=points[lo-1], b=points[lo], length=c[lo]-c[lo-1], t=length ? (car.position-c[lo-1])/length : 0;
  const dx=b[0]-a[0],dy=b[1]-a[1], norm=Math.hypot(dx,dy)||1, ux=dx/norm*car.direction,uy=dy/norm*car.direction;
  const shift=l.oneway ? 0 : 5/l.ratio;
  out[offset]=a[0]+dx*t-uy*shift; out[offset+1]=a[1]+dy*t+ux*shift;
  out[offset+2]=ux; out[offset+3]=uy;
}
export function advanceCars(cars, dt, out) {
  for (let i=0;i<cars.length;i++) {
    const car=cars[i];
    if (car.stopped) car.fade=Math.max(0,car.fade-dt/.4);
    else if (dt) car.fade=Math.min(1,car.fade+dt/.4), car.position=((car.position+car.direction*car.line.speed*dt)%car.line.length+car.line.length)%car.line.length;
    const j=i*8;
    carPosition(car,out,j); out[j+4]=car.fade;
    out[j+5]=car.stopped ? -2 : (car.direction<0 && !car.line.oneway ? -1 : 1)*(car.line.extra ? 1 : .5+car.line.speed/1800);
    out[j+6]=carStreakLength(car.line.speed); out[j+7]=0;
  }
}
export function percentile(values, fraction) {
  if (!values.length) return 0;
  return [...values].sort((a,b) => a-b)[Math.max(0,Math.ceil(values.length*fraction)-1)];
}
export function fallbackStep(intervals, completed) {
  return completed<3 && percentile(intervals,.95)>33 ? completed+1 : completed;
}
export function clipSegment(a, b, box) {
  const dx=b[0]-a[0], dy=b[1]-a[1];
  let t0=0, t1=1;
  for (const [q,d] of [[a[0]-box[0],-dx],[box[2]-a[0],dx],[a[1]-box[1],-dy],[box[3]-a[1],dy]]) {
    if (!d) { if (q<0) return null; continue; }
    const t=q/d;
    if (d<0) { if (t>t1) return null; t0=Math.max(t0,t); } else { if (t<t0) return null; t1=Math.min(t1,t); }
  }
  return [t0,t1];
}
// Roads touching the view box (traffic-frame metres, [minX,minY,maxX,maxY]) with a car target per span:
// ~1 car per `spacing` m per direction on a motorway, fewer on minor or rarely used roads.
export function viewSpans(lines, box, spacing = 30) {
  const spans=[];
  for (const line of lines) {
    if (line.closed) continue;
    const p=line.points, b=line.box ??= p.reduce((m,[x,y]) => [Math.min(m[0],x),Math.min(m[1],y),Math.max(m[2],x),Math.max(m[3],y)],[1/0,1/0,-1/0,-1/0]);
    if (b[0]>box[2] || b[2]<box[0] || b[1]>box[3] || b[3]<box[1]) continue;
    // Clip each segment to the box (Liang-Barsky); keep only visible arc-length intervals.
    const c=line.cumulative, parts=[];
    let length=0;
    for (let i=1;i<p.length;i++) {
      const t=clipSegment(p[i-1],p[i],box);
      if (!t) continue;
      const a=c[i-1]+(c[i]-c[i-1])*t[0], z=c[i-1]+(c[i]-c[i-1])*t[1];
      if (z<=a) continue;
      if (parts.length && parts.at(-1)[1]===a) parts.at(-1)[1]=z; else parts.push([a,z]);
      length+=z-a;
    }
    const density=Math.min(1,Math.max(.4,line.speed/900))*Math.min(1,.5+Math.sqrt(line.weight)/10);
    if (length>0) spans.push({line,parts,length,want:length*(line.oneway ? 1 : 2)*density/spacing});
  }
  return spans;
}
// Moves for off-screen cars and surplus cars on over-full roads onto in-view roads short of their target.
// The total stays fixed; targets shrink together when the view wants more cars than exist.
export function recycleCars(cars, xy, spans, box, random) {
  const have=new Map(), pool=[], inView=[];
  for (let i=0;i<cars.length;i++) {
    const car=cars[i];
    if (car.stopped || car.line.extra) continue;
    const x=xy[i*8], y=xy[i*8+1];
    if (x<box[0] || x>box[2] || y<box[1] || y>box[3]) pool.push(i);
    else { inView.push(i); have.set(car.line,(have.get(car.line) ?? 0)+1); }
  }
  const total=spans.reduce((n,s) => n+s.want,0), k=Math.min(1,(pool.length+inView.length)/(total || 1));
  const target=new Map(spans.map(s => [s.line,s.want*k]));
  for (const i of inView) {
    const line=cars[i].line, n=have.get(line);
    if (n>(target.get(line) ?? 0)+1) { pool.push(i); have.set(line,n-1); }
  }
  let sum=0;
  const need=spans.map(s => sum+=Math.max(0,s.want*k-(have.get(s.line) ?? 0)));
  const moves=[];
  for (let n=Math.min(pool.length,Math.floor(sum));n>0;n--) {
    const r=random()*sum;
    let lo=0, hi=need.length-1;
    while (lo<hi) { const mid=(lo+hi)>>>1; if (need[mid]<=r) lo=mid+1; else hi=mid; }
    const {line,parts,length}=spans[lo];
    let at=random()*length, k=0;
    while (k<parts.length-1 && at>parts[k][1]-parts[k][0]) at-=parts[k][1]-parts[k++][0];
    moves.push({index:pool.pop(),line,position:Math.min(parts[k][1],parts[k][0]+at),
      direction:line.oneway ? (line.flip ? -1 : 1) : random()<.5 ? -1 : 1});
  }
  return moves;
}
// Closed and flipped state lives on the line so recycled cars never land on a destroyed road.
export function markLines(lines, ids, flip) {
  const hit=new Set(ids);
  for (const line of lines) if (hit.has(line.id)) { if (!flip) line.closed=true; else if (line.oneway) line.flip=!line.flip; }
}
