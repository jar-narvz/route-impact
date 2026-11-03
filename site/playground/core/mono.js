/** Grayscale only style color outputs. Never walk expression inputs as colors. */
// The basemap uses only these named colors; unknown names pass through.
const names = {transparent: [0, 0, 0, 0], black: [0, 0, 0], white: [255, 255, 255]};

const linear = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const encoded = value => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;

function gray([red, green, blue, alpha = 1]) {
  const luminance = 0.2126 * linear(red / 255) + 0.7152 * linear(green / 255) + 0.0722 * linear(blue / 255);
  const channel = encoded(luminance) * 255;
  return `rgba(${channel}, ${channel}, ${channel}, ${alpha})`;
}

function hueDegrees(value) {
  const number = parseFloat(value);
  if (value.endsWith('turn')) return number * 360;
  if (value.endsWith('grad')) return number * 0.9;
  if (value.endsWith('rad')) return number * 180 / Math.PI;
  return number;
}

function literal(value) {
  const text = value.toLowerCase().trim();
  if (Object.hasOwn(names, text)) return gray(names[text]);
  if (/^#[0-9a-f]{3,8}$/.test(text)) {
    let hex = text.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(char => char + char).join('');
    if (hex.length !== 6 && hex.length !== 8) return value;
    const channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
    return gray([...channels, hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1]);
  }
  const match = text.match(/^(rgba?|hsla?)\((.*)\)$/);
  if (!match) return value;
  const parts = match[2].split(/[,\s/]+/).filter(Boolean);
  const alpha = parts[3] === undefined ? 1 : parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1);
  if (match[1].startsWith('rgb')) {
    return gray([...parts.slice(0, 3).map(part => parseFloat(part) * (part.endsWith('%') ? 2.55 : 1)), alpha]);
  }
  const hue = ((hueDegrees(parts[0]) % 360) + 360) % 360 / 360;
  const saturation = parseFloat(parts[1]) / 100, lightness = parseFloat(parts[2]) / 100;
  const channel = index => {
    const position = (index + hue * 12) % 12;
    return 255 * (lightness - saturation * Math.min(lightness, 1 - lightness)
      * Math.max(-1, Math.min(position - 3, 9 - position, 1)));
  };
  return gray([channel(0), channel(8), channel(4), alpha]);
}

/** Keep dynamic rgb channels dynamic, using the same sRGB transfer functions. */
function rgbExpression(expression) {
  if (expression.slice(1).every(value => typeof value === 'number')) return gray(expression.slice(1));
  const channel = index => ['/', expression[index], 255];
  const toLinear = value => ['case', ['<=', value, 0.04045], ['/', value, 12.92],
    ['^', ['/', ['+', value, 0.055], 1.055], 2.4]];
  const luminance = ['+', ['*', 0.2126, toLinear(channel(1))],
    ['*', 0.7152, toLinear(channel(2))], ['*', 0.0722, toLinear(channel(3))]];
  const grayChannel = ['*', 255, ['case', ['<=', luminance, 0.0031308], ['*', 12.92, luminance],
    ['-', ['*', 1.055, ['^', luminance, 1 / 2.4]], 0.055]]];
  return ['rgba', grayChannel, grayChannel, grayChannel, expression[0] === 'rgba' ? expression[4] : 1];
}

/** Indices of outputs, deliberately excluding inputs, labels and conditions. */
function outputIndices(expression) {
  const operator = expression[0], length = expression.length, indices = [];
  if (['interpolate', 'interpolate-hcl', 'interpolate-lab'].includes(operator)) {
    for (let index = 4; index < length; index += 2) indices.push(index);
  } else if (operator === 'step') {
    for (let index = 2; index < length; index += 2) indices.push(index);
  } else if (operator === 'match' || operator === 'case') {
    for (let index = operator === 'match' ? 3 : 2; index < length - 1; index += 2) indices.push(index);
    indices.push(length - 1);
  } else if (operator === 'coalesce') {
    for (let index = 1; index < length; index++) indices.push(index);
  } else if (operator === 'literal') indices.push(1);
  return indices;
}

function color(value) {
  if (typeof value === 'string') return literal(value);
  if (!value || typeof value !== 'object') return value;
  if (!Array.isArray(value)) {
    const output = {...value};
    if (value.stops) output.stops = value.stops.map(([stop, result]) => [stop, color(result)]);
    if (Object.hasOwn(value, 'default')) output.default = color(value.default);
    return output;
  }
  if (value[0] === 'rgb' || value[0] === 'rgba') return rgbExpression(value);
  const output = structuredClone(value);
  for (const index of outputIndices(value)) output[index] = color(value[index]);
  return output;
}

export function monochrome(style) {
  const output = structuredClone(style);
  for (const layer of output.layers ?? []) {
    for (const key of Object.keys(layer.paint ?? {})) {
      if (key.endsWith('-color')) layer.paint[key] = color(layer.paint[key]);
    }
    if (layer.type === 'symbol') {
      if (layer.layout) delete layer.layout['icon-image'];
      if (!layer.layout?.['text-field']) layer.layout = {...layer.layout, visibility: 'none'};
    }
    if (layer.type === 'raster') layer.paint = {...layer.paint, 'raster-saturation': -1};
  }
  return output;
}
