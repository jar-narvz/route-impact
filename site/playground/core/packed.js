/** Keep JSON strings/null as byte ranges; decode only requested elements. */
const decoder = new TextDecoder();

function packedView(bytes, ranges) {
  return Object.freeze({length: ranges.length / 2, get(i) {
    if (!Number.isInteger(i) || i < 0 || i >= ranges.length / 2) throw new RangeError('Packed array index out of range');
    return JSON.parse(decoder.decode(bytes.subarray(ranges[2*i], ranges[2*i+1])));
  }});
}

export function packJsonArray(bytes, {allowObjects = false} = {}) {
  let p = 0, count = 0, ranges = new Uint32Array(128);
  const fail = message => { throw new Error(`Malformed JSON array at byte ${p}: ${message}`); };
  function whitespace() {
    while (bytes[p] === 0x20 || bytes[p] === 0x09 || bytes[p] === 0x0a || bytes[p] === 0x0d) p++;
  }
  function string() {
    p++;
    while (p < bytes.length) {
      const b = bytes[p++];
      if (b === 0x22) return;
      if (b < 0x20) fail('unescaped control character');
      if (b === 0x5c) {
        const escape = bytes[p++];
        if (escape === 0x75) {
          for (let j = 0; j < 4; j++) {
            const hex = bytes[p++];
            if (!(hex >= 0x30 && hex <= 0x39 || hex >= 0x41 && hex <= 0x46 || hex >= 0x61 && hex <= 0x66))
              fail('invalid Unicode escape');
          }
        } else if (!(escape === 0x22 || escape === 0x5c || escape === 0x2f || escape === 0x62 ||
                     escape === 0x66 || escape === 0x6e || escape === 0x72 || escape === 0x74)) {
          fail('invalid or unterminated string escape');
        }
      }
    }
    fail('unterminated string');
  }
  // Exported trip_labels are objects. Index their ranges too, with full JSON
  // syntax validation on get(); string/null arrays remain strict by default.
  function object() {
    const closes = [0x7d];
    p++;
    while (p < bytes.length && closes.length) {
      const b = bytes[p];
      if (b === 0x22) { string(); continue; }
      p++;
      if (b === 0x7b) closes.push(0x7d);
      else if (b === 0x5b) closes.push(0x5d);
      else if ((b === 0x7d || b === 0x5d) && b !== closes.pop()) fail('mismatched object delimiter');
    }
    if (closes.length) fail('unterminated object');
  }
  whitespace();
  if (bytes[p++] !== 0x5b) fail("expected '['");
  whitespace();
  if (bytes[p] !== 0x5d) {
    while (true) {
      const start = p;
      if (bytes[p] === 0x22) string();
      else if (bytes[p] === 0x6e && bytes[p+1] === 0x75 && bytes[p+2] === 0x6c && bytes[p+3] === 0x6c) p += 4;
      else if (allowObjects && bytes[p] === 0x7b) object();
      else fail('expected a string or null');
      if (2*count === ranges.length) {
        const grown = new Uint32Array(ranges.length * 2);
        grown.set(ranges);
        ranges = grown;
      }
      ranges[2*count] = start;
      ranges[2*count+1] = p;
      count++;
      whitespace();
      if (bytes[p] === 0x5d) break;
      if (bytes[p++] !== 0x2c) fail("expected ',' or ']'");
      whitespace();
    }
  }
  p++;
  whitespace();
  if (p !== bytes.length) fail('trailing garbage');
  return packedView(bytes, ranges.slice(0, 2*count));
}
