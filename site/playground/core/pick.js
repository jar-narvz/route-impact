/** Typed-array CSR grid over shipped segments; distances use the query's metre projection. */
export function createPicker(meta, a) {
  const k = meta.earth_radius_m * Math.PI / 180, cell = 200 / k;
  const cellAt = value => Math.floor(value / cell);
  const pointCount = a.geometry_coords.length / 2;
  const stamp = new Uint32Array(pointCount), wayStamp = new Uint32Array(meta.counts.ways);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let p = 0; p < pointCount; p++) {
    const x = cellAt(a.geometry_coords[2*p+1] / meta.geometry_scale);
    const y = cellAt(a.geometry_coords[2*p] / meta.geometry_scale);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const cols = pointCount ? maxX - minX + 1 : 0;
  const rows = pointCount ? maxY - minY + 1 : 0;
  const cellStart = new Uint32Array(cols * rows + 1);
  function visitSegments(visit) {
    for (let way = 0; way < meta.counts.ways; way++) {
      for (let p = a.geometry_offsets[way] + 1; p < a.geometry_offsets[way+1]; p++) {
        const x0 = cellAt(a.geometry_coords[2*(p-1)+1] / meta.geometry_scale);
        const y0 = cellAt(a.geometry_coords[2*(p-1)] / meta.geometry_scale);
        const x1 = cellAt(a.geometry_coords[2*p+1] / meta.geometry_scale);
        const y1 = cellAt(a.geometry_coords[2*p] / meta.geometry_scale);
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
          for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
            visit((y - minY) * cols + x - minX, p);
        }
      }
    }
  }
  visitSegments(id => cellStart[id+1]++);
  for (let i = 1; i < cellStart.length; i++) cellStart[i] += cellStart[i-1];
  const cellSegments = new Uint32Array(cellStart[cellStart.length-1]);
  const cursor = cellStart.slice(0, -1);
  visitSegments((id, p) => { cellSegments[cursor[id]++] = p; });
  let queryId = 0;
  function scan(lat, lon, maxMetres, visit, squared = false) {
    if (![lat, lon, maxMetres].every(Number.isFinite) || maxMetres < 0 || !pointCount) return null;
    queryId = (queryId + 1) >>> 0;
    if (!queryId) { stamp.fill(0); wayStamp.fill(0); queryId = 1; }
    const kx = k * Math.cos(lat * Math.PI / 180);
    const dy = maxMetres / k, dx = maxMetres / Math.abs(kx);
    // Clip to grid bounds so world-scale queries cannot scan an empty globe.
    for (let y = Math.max(minY, cellAt(lat - dy)); y <= Math.min(maxY, cellAt(lat + dy)); y++) {
      for (let x = Math.max(minX, cellAt(lon - dx)); x <= Math.min(maxX, cellAt(lon + dx)); x++) {
        const id = (y - minY) * cols + x - minX;
        for (let i = cellStart[id]; i < cellStart[id+1]; i++) {
          const p = cellSegments[i];
          if (stamp[p] === queryId) continue;
          stamp[p] = queryId;
          let lo = 0, hi = meta.counts.ways;
          while (lo + 1 < hi) {
            const mid = (lo + hi) >>> 1;
            if (a.geometry_offsets[mid] <= p) lo = mid;
            else hi = mid;
          }
          const way = lo;
          const ax = (a.geometry_coords[2*(p-1)+1] / meta.geometry_scale - lon) * kx;
          const ay = (a.geometry_coords[2*(p-1)] / meta.geometry_scale - lat) * k;
          const bx = (a.geometry_coords[2*p+1] / meta.geometry_scale - lon) * kx;
          const by = (a.geometry_coords[2*p] / meta.geometry_scale - lat) * k;
          const sx = bx - ax, sy = by - ay, length2 = sx*sx + sy*sy;
          const projection = length2 > 0 ? -(ax*sx + ay*sy) / length2 : 0;
          const t = Math.min(Math.max(projection, 0), 1), cx = ax + t*sx, cy = ay + t*sy;
          const distance_m = Math.sqrt(cx*cx + cy*cy);
          if (squared ? cx*cx + cy*cy <= maxMetres*maxMetres : distance_m <= maxMetres) visit(way, distance_m);
        }
      }
    }
  }
  function nearestWay(lat, lon, maxMetres) {
    let best = null;
    scan(lat, lon, maxMetres, (way, distance_m) => {
      if (!best || distance_m < best.distance_m || distance_m === best.distance_m && way < best.way)
        best = {way, distance_m};
    });
    return best;
  }
  function waysWithin(lat, lon, maxMetres) {
    const ways = [];
    scan(lat, lon, maxMetres, way => {
      if (wayStamp[way] === queryId) return;
      wayStamp[way] = queryId;
      ways.push(way);
    }, true);
    return ways.sort((a, b) => a - b);
  }
  return {nearestWay, waysWithin};
}
