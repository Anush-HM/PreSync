import { attr, child, children, find, num, readRels, readXml, relOfType } from './ooxml.js';

// DrawingML pieces shared by the PowerPoint and Word importers: theme
// colours and fonts, colour transforms (lumMod, tint…), fills, lines,
// and a mapping from Office fonts to web-safe CSS font stacks.

// --- colour maths ---------------------------------------------------------

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

// Applies the colour transforms DrawingML allows inside a colour element.
export function applyColorMods(hex, node) {
  let rgb = hexToRgb(hex);
  for (const mod of children(node)) {
    const name = mod.nodeName.replace(/^a:/, '');
    const val = (num(mod, 'val') ?? 100000) / 100000;
    if (name === 'tint') rgb = rgb.map((c) => c * val + 255 * (1 - val));
    else if (name === 'shade') rgb = rgb.map((c) => c * val);
    else if (['lumMod', 'lumOff', 'satMod', 'satOff', 'hueOff'].includes(name)) {
      const hsl = rgbToHsl(rgb);
      if (name === 'lumMod') hsl[2] = clamp01(hsl[2] * val);
      if (name === 'lumOff') hsl[2] = clamp01(hsl[2] + val);
      if (name === 'satMod') hsl[1] = clamp01(hsl[1] * val);
      if (name === 'satOff') hsl[1] = clamp01(hsl[1] + val);
      if (name === 'hueOff') hsl[0] = (hsl[0] + val * 100000 / 21600000 + 1) % 1;
      rgb = hslToRgb(hsl);
    } else if (name === 'inv') rgb = rgb.map((c) => 255 - c);
    else if (name === 'gray') rgb = Array(3).fill(0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]);
  }
  return rgbToHex(rgb);
}

// Transparency on a colour (a:alpha), 0–1. Fully opaque when absent.
export function alphaOf(colorNode) {
  const a = child(colorNode, 'a:alpha');
  return a ? (num(a, 'val') ?? 100000) / 100000 : 1;
}

export function mixHex(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v * (1 - t) + y[i] * t));
}

export function isHexColor(v) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

const PRESET_COLORS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  gray: '#808080', grey: '#808080', darkGray: '#a9a9a9', lightGray: '#d3d3d3', orange: '#ffa500', navy: '#000080'
};

// --- theme ---------------------------------------------------------------

const CLR_MAP_DEFAULT = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };

// Reads a master's theme: colour scheme, major/minor fonts and the
// fill/line/background style lists that style references point into.
export async function readTheme(zip, masterPath, master) {
  const theme = { colors: {}, fonts: { major: null, minor: null }, fillStyles: [], lineStyles: [], bgFillStyles: [] };
  const themePath = masterPath && relOfType(await readRels(zip, masterPath), '/theme');
  const root = themePath && (await readXml(zip, themePath));
  const elements = root && child(root, 'a:themeElements');
  for (const c of children(find(elements, 'a:clrScheme'))) {
    const name = c.nodeName.replace(/^a:/, '');
    const srgb = child(c, 'a:srgbClr');
    const sys = child(c, 'a:sysClr');
    const val = attr(srgb, 'val') || attr(sys, 'lastClr');
    if (val) theme.colors[name] = `#${val.toLowerCase()}`;
  }
  const fontScheme = find(elements, 'a:fontScheme');
  theme.fonts.major = attr(find(fontScheme, 'a:majorFont', 'a:latin'), 'typeface');
  theme.fonts.minor = attr(find(fontScheme, 'a:minorFont', 'a:latin'), 'typeface');
  const fmt = find(elements, 'a:fmtScheme');
  theme.fillStyles = children(find(fmt, 'a:fillStyleLst'));
  theme.lineStyles = children(find(fmt, 'a:lnStyleLst'));
  theme.bgFillStyles = children(find(fmt, 'a:bgFillStyleLst'));

  // The master's colour map says which scheme colour bg1/tx1/… mean.
  const clrMap = master && child(master, 'p:clrMap');
  theme.clrMap = { ...CLR_MAP_DEFAULT };
  if (clrMap) for (const key of Object.keys(CLR_MAP_DEFAULT)) theme.clrMap[key] = attr(clrMap, key) || theme.clrMap[key];
  return theme;
}

// Resolves a colour element's parent (anything that may hold srgbClr,
// schemeClr, …) to a hex string. `placeholder` stands in for phClr in
// theme style lists.
export function colorFrom(parent, theme, placeholder = null) {
  if (!parent) return null;
  for (const c of children(parent)) {
    let base = null;
    if (c.nodeName === 'a:srgbClr') base = `#${(attr(c, 'val') || '').toLowerCase()}`;
    else if (c.nodeName === 'a:schemeClr') {
      const val = attr(c, 'val');
      if (val === 'phClr') base = placeholder;
      else base = theme.colors[theme.clrMap?.[val] || val] || theme.colors[val] || null;
    } else if (c.nodeName === 'a:sysClr') base = `#${(attr(c, 'lastClr') || '000000').toLowerCase()}`;
    else if (c.nodeName === 'a:prstClr') base = PRESET_COLORS[attr(c, 'val')] || null;
    else if (c.nodeName === 'a:scrgbClr') {
      const pct = (k) => Math.round(((num(c, k) || 0) / 100000) * 255);
      base = rgbToHex([pct('r'), pct('g'), pct('b')]);
    } else continue;
    if (!isHexColor(base)) return null;
    return applyColorMods(base, c);
  }
  return null;
}

// --- fills -----------------------------------------------------------------

const FILL_TAGS = new Set(['a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:grpFill', 'a:pattFill']);

// Reads one fill element (a:solidFill, a:gradFill, …). Returns
// { type: 'none' } | { type: 'solid', color, alpha } |
// { type: 'gradient', angle, stops: [{ pos, color }] } |
// { type: 'image', rId, tile } | { type: 'group' } | null.
export function fillOfElement(el, theme, placeholder = null) {
  if (!el) return null;
  switch (el.nodeName) {
    case 'a:noFill':
      return { type: 'none' };
    case 'a:solidFill': {
      const color = colorFrom(el, theme, placeholder);
      return color ? { type: 'solid', color, alpha: alphaOf(children(el)[0]) } : null;
    }
    case 'a:gradFill': {
      const stops = children(find(el, 'a:gsLst'), 'a:gs')
        .map((gs) => ({ pos: (num(gs, 'pos') || 0) / 100000, color: colorFrom(gs, theme, placeholder) }))
        .filter((s) => s.color)
        .sort((x, y) => x.pos - y.pos);
      if (stops.length === 0) return null;
      // DrawingML angles run clockwise from "left to right"; CSS angles
      // run clockwise from "bottom to top", hence the +90.
      const lin = child(el, 'a:lin');
      const deg = lin ? (num(lin, 'ang') || 0) / 60000 : 90;
      return { type: 'gradient', angle: Math.round((deg + 90) % 360), stops };
    }
    case 'a:blipFill': {
      const rId = attr(child(el, 'a:blip'), 'r:embed');
      return rId ? { type: 'image', rId, tile: !!child(el, 'a:tile') } : null;
    }
    case 'a:grpFill':
      return { type: 'group' };
    case 'a:pattFill': {
      // Patterns become their foreground colour.
      const color = colorFrom(child(el, 'a:fgClr'), theme, placeholder);
      return color ? { type: 'solid', color, alpha: 1 } : null;
    }
    default:
      return null;
  }
}

// The fill specified directly under `parent` (spPr, bgPr, tcPr, rPr…),
// or null when it doesn't specify one.
export function fillFrom(parent, theme, placeholder = null) {
  const el = children(parent).find((c) => FILL_TAGS.has(c.nodeName));
  return el ? fillOfElement(el, theme, placeholder) : null;
}

// A theme style reference (fillRef/bgRef with an idx and a colour that
// replaces phClr in the referenced style).
export function styleRefFill(ref, list, theme) {
  if (!ref) return null;
  const idx = num(ref, 'idx') || 0;
  if (idx === 0) return { type: 'none' };
  const placeholder = colorFrom(ref, theme);
  const entry = list[idx >= 1001 ? idx - 1001 : idx - 1];
  return fillOfElement(entry, theme, placeholder) || (placeholder ? { type: 'solid', color: placeholder, alpha: 1 } : null);
}

// The solid colour that best represents a fill (gradients use their
// first stop), for places that can only show one colour.
export function representativeColor(fill) {
  if (!fill) return null;
  if (fill.type === 'solid') return fill.color;
  if (fill.type === 'gradient') return fill.stops[0]?.color || null;
  return null;
}

// Outline of a shape (a:ln): { color, width (EMU), dash } or none.
export function lineFrom(ln, theme, placeholder = null) {
  if (!ln) return null;
  if (child(ln, 'a:noFill')) return { none: true };
  const fill = fillFrom(ln, theme, placeholder);
  const color = representativeColor(fill);
  const dash = attr(child(ln, 'a:prstDash'), 'val');
  return {
    color,
    width: num(ln, 'w'),
    dash: !!dash && dash !== 'solid'
  };
}

// --- fonts -------------------------------------------------------------------

// Office fonts and the metric-compatible open fonts that the web app
// loads, so text wraps at the same place it did in the source file.
const FONT_STACKS = {
  'times new roman': '"Times New Roman", Tinos, Times, serif',
  times: '"Times New Roman", Tinos, Times, serif',
  arial: 'Arial, Arimo, Helvetica, sans-serif',
  helvetica: 'Helvetica, Arial, Arimo, sans-serif',
  'courier new': '"Courier New", Cousine, Courier, monospace',
  courier: '"Courier New", Cousine, Courier, monospace',
  calibri: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
  'calibri light': '"Calibri Light", Calibri, Carlito, "Segoe UI", sans-serif',
  cambria: 'Cambria, Caladea, Georgia, serif',
  georgia: 'Georgia, Gelasio, serif',
  verdana: 'Verdana, Geneva, sans-serif',
  tahoma: 'Tahoma, Verdana, sans-serif',
  'trebuchet ms': '"Trebuchet MS", sans-serif',
  'segoe ui': '"Segoe UI", Arial, Arimo, sans-serif',
  'century gothic': '"Century Gothic", "Questrial", sans-serif',
  garamond: 'Garamond, "EB Garamond", serif',
  'book antiqua': '"Book Antiqua", Palatino, serif',
  'palatino linotype': '"Palatino Linotype", Palatino, serif',
  'gill sans mt': '"Gill Sans MT", "Gill Sans", sans-serif',
  aptos: 'Aptos, Calibri, Carlito, "Segoe UI", sans-serif',
  // Open fonts that PDFs made on Linux (LibreOffice) embed, mapped to the
  // Office fonts they stand in for.
  'liberation serif': '"Times New Roman", Tinos, Times, serif',
  'liberation sans': 'Arial, Arimo, Helvetica, sans-serif',
  'liberation mono': '"Courier New", Cousine, Courier, monospace',
  tinos: '"Times New Roman", Tinos, Times, serif',
  arimo: 'Arial, Arimo, Helvetica, sans-serif',
  cousine: '"Courier New", Cousine, Courier, monospace',
  carlito: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
  caladea: 'Cambria, Caladea, Georgia, serif',
  'aptos display': '"Aptos Display", Aptos, Calibri, Carlito, sans-serif'
};

const SERIF_HINT = /(times|roman|serif|georgia|garamond|cambria|book|palatino|minion|baskerville|bodoni|caslon|didot)/i;
const MONO_HINT = /(mono|courier|consol|code)/i;

// A CSS font stack for an Office/PDF font name.
export function fontStack(name) {
  if (!name) return null;
  const clean = name.replace(/^[A-Z]{6}\+/, '').replace(/["']/g, '').trim();
  const known = FONT_STACKS[clean.toLowerCase()] || FONT_STACKS[clean.toLowerCase().replace(/\s+(regular|roman)$/, '')];
  if (known) return known;
  const generic = MONO_HINT.test(clean) ? 'monospace' : SERIF_HINT.test(clean) && !/sans/i.test(clean) ? 'serif' : 'sans-serif';
  return `"${clean}", ${generic}`;
}

// "+mj-lt" / "+mn-lt" point at the theme's heading / body fonts.
export function resolveTypeface(typeface, theme) {
  if (!typeface) return null;
  if (typeface === '+mj-lt' || typeface === '+mj-ea' || typeface === '+mj-cs') return theme.fonts.major;
  if (typeface === '+mn-lt' || typeface === '+mn-ea' || typeface === '+mn-cs') return theme.fonts.minor;
  return typeface;
}
