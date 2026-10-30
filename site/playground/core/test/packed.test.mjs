import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import {gunzipSync} from 'node:zlib';
import {packJsonArray} from '../packed.js';

const encoder = new TextEncoder();
function roundTrip(bytes, options) {
  const expected = JSON.parse(new TextDecoder().decode(bytes));
  const packed = packJsonArray(bytes, options);
  assert.equal(packed.length, expected.length);
  assert.equal(Object.isFrozen(packed), true);
  for (let i = 0; i < expected.length; i++) assert.deepEqual(packed.get(i), expected[i]);
  for (const i of [-1, expected.length, 0.5, NaN, Infinity, '0', undefined])
    assert.throws(() => packed.get(i), RangeError);
}

test('empty, null, escapes, Unicode and whitespace match a full parse', () => {
  const inputs = ['[]', '[null]', '[""]', '["a\\\"b\\\\"]',
    '["\\u00e9", "\\ud83d\\ude00", "é", "漢", "😀"]',
    ' \n\t[ \r "first" ,\n null,\t"last" \n] \r\n'];
  for (const input of inputs) roundTrip(encoder.encode(input));
  // Byte ranges must be relative to a view, including Node Buffer slices.
  const buffer = Buffer.from('prefix["é",null,"漢"]suffix');
  roundTrip(buffer.subarray(6, buffer.length - 6));
  roundTrip(encoder.encode(JSON.stringify(Array.from({length: 257}, (_, i) => `漢 ${i}`))));
});

test('malformed arrays fail clearly during packing', () => {
  const inputs = ['', '{}', 'null', '"x"', '[', '["unfinished', '["escape\\',
    '["\\x"]', '["\\u123"]', '["\\uZZZZ"]', '["line\nbreak"]',
    '[true]', '[0]', '[{}]', '[[]]', '[nul]', '[nullx]', '["a" "b"]',
    '[,"a"]', '["a",]', '[null', '[] trailing', '[] []', '[["a"]]'];
  for (const input of inputs)
    assert.throws(() => packJsonArray(encoder.encode(input)), /Malformed JSON array/);
});

const root = new URL('../../../../tests/fixtures/playground/', import.meta.url);
for (const entry of readdirSync(root, {withFileTypes: true}).filter(e => e.isDirectory())) {
  test(`packed way_names and trip_labels: ${entry.name}`, () => {
    for (const name of ['way_names', 'trip_labels']) {
      const bytes = gunzipSync(readFileSync(new URL(`${entry.name}/${name}.json.gz`, root)));
      roundTrip(bytes, {allowObjects: name === 'trip_labels'});
    }
  });
}

test('object-label opt-in indexes nested and escaped content without parsing other elements', () => {
  roundTrip(encoder.encode('[{"trip_id":"a\\\"}b", "kind":"local", "nested":[{"x":null}]}]'), {allowObjects: true});
  for (const input of ['[{', '[{"x":[]', '[{"x":]}]'])
    assert.throws(() => packJsonArray(encoder.encode(input), {allowObjects: true}), /Malformed JSON array/);
});

test('500 seeded random string arrays round-trip every element', () => {
  let seed = 2027;
  const random = n => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor(seed / 0x100000000 * n);
  };
  const alphabet = ['a', 'Z', '"', '\\', '\n', '\r', '\t', '\b', '\f', '\0',
    '\x01', '\x1f', 'é', '漢', '😀', '𝄞', '\ud800', '\udfff', '[', ']', ',', ' '];
  for (let run = 0; run < 500; run++) {
    const values = Array.from({length: random(30)}, () =>
      Array.from({length: random(50)}, () => alphabet[random(alphabet.length)]).join(''));
    roundTrip(encoder.encode(JSON.stringify(values)));
  }
});
