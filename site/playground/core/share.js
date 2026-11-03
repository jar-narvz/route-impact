/** Raw, single-edit hash grammar. Dependencies are supplied by the caller. */
const invalid = () => ({ok: false, error: 'Invalid share link'});

export function parseShare(hash, options = {}) {
  try {
    const {box, sizes, presetNames, lookupWay} = options;
    if (typeof hash !== 'string') return invalid();
    // Unlike $, this end assertion also rejects a final newline.
    const road = /^#(stomp|flip)=([1-9][0-9]{0,14})(?![\s\S])/.exec(hash);
    if (road) {
      const way_id = Number(road[2]), way = lookupWay(way_id);
      if (!way || road[1] === 'flip' && !way.oneway) return invalid();
      return {ok: true, edit: {weapon: road[1], way_id}};
    }
    const meteor = /^#meteor=(-?[0-9]+(?:\.[0-9]{1,5})?),(-?[0-9]+(?:\.[0-9]{1,5})?),([1-9][0-9]*)(?![\s\S])/.exec(hash);
    if (meteor) {
      const [lat, lon, radius_m] = meteor.slice(1).map(Number);
      if (![lat, lon, radius_m].every(Number.isFinite)
        || lat < box.min_lat || lat > box.max_lat || lon < box.min_lon || lon > box.max_lon
        || !sizes.some(size => size.radius_m === radius_m)) return invalid();
      return {ok: true, edit: {weapon: 'meteor', lat, lon, radius_m}};
    }
    const preset = /^#preset=([a-zA-Z0-9_-]+)(?![\s\S])/.exec(hash);
    if (preset && presetNames.includes(preset[1])) return {ok: true, edit: {preset: preset[1]}};
    return invalid();
  } catch {
    return invalid();
  }
}

export function serializeShare(edit, options) {
  try {
    let hash;
    if (edit.preset !== undefined) hash = `#preset=${edit.preset}`;
    else if (edit.weapon === 'meteor') hash = `#meteor=${edit.lat},${edit.lon},${edit.radius_m}`;
    else if (['stomp', 'flip'].includes(edit.weapon)) hash = `#${edit.weapon}=${edit.way_id}`;
    else return invalid();
    const result = parseShare(hash, options);
    return result.ok ? {...result, hash} : result;
  } catch {
    return invalid();
  }
}
