import JSZip from 'jszip';
import path from 'path';
import { attr, child, children, find, num, parseXml, readRels, readXml, relOfType } from './ooxml.js';
import {
  colorFrom,
  fillFrom,
  fontStack,
  isHexColor,
  lineFrom,
  readTheme,
  representativeColor,
  resolveTypeface,
  styleRefFill
} from './drawingml.js';
import { buildRichText } from './richText.js';
import { customPath, presetShape } from './presetGeometry.js';
import { parseTableStyles, tableBlock } from './pptxTables.js';
import { mimeForExt, processImage, toDataUrl, WEB_IMAGE_EXT } from './imageProcessing.js';
import { readChart } from './pptxCharts.js';

// Extracts editable content from a .pptx (Office Open XML) deck onto the
// 960×540 editor canvas:
//  - text keeps per-run formatting (font, size, weight, italic,
//    underline, strike, colour), bullets and numbering, indents, line
//    spacing, box margins, vertical anchoring and shrink-on-overflow,
//    inherited from the slide, its layout, its master and the theme;
//  - shapes (preset and custom geometry) keep fill, outline and rotation;
//  - tables keep rows, columns, merges, fills and borders;
//  - pictures are cropped as in the source and downscaled to fit;
//  - backgrounds keep solid colours, gradients and pictures, and the
//    master/layout's decorative shapes carry over;
//  - charts become chart blocks redrawn from their cached data;
//  - SmartArt becomes ordinary shapes from its pre-drawn layout;
//  - embedded objects (OLE) show their preview picture;
//  - anything else we can't redraw becomes a labelled placeholder
//    rather than vanishing.
// Output matches extractSlidesFromPdf so every format feeds one model.

const TARGET_WIDTH = 960;
const TARGET_HEIGHT = 540;
const EMU_PER_POINT = 12700;
// Imported images are stored inline as data URLs, so keep them bounded
// to stay well inside Mongo's 16MB document limit.
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 9 * 1024 * 1024;

const DEFAULT_FONT_PT = 18;
const ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };
const ANCHOR = { t: 'top', ctr: 'middle', b: 'bottom', just: 'top', dist: 'top' };
// PowerPoint's single line spacing is about 1.2× the font size; Fabric's
// is 1.13×, so lineHeight values are scaled by this.
const LINE_SCALE = 1.2 / 1.13;

export class PptxParseError extends Error {}

// --- placeholders (layout/master inheritance) ----------------------------

export function placeholderOf(sp) {
  const ph =
    find(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph') ||
    find(sp, 'p:nvPicPr', 'p:nvPr', 'p:ph') ||
    find(sp, 'p:nvGraphicFramePr', 'p:nvPr', 'p:ph');
  if (!ph) return null;
  return { type: attr(ph, 'type') || 'body', idx: attr(ph, 'idx') };
}

function indexPlaceholders(root) {
  const byIdx = new Map();
  const byType = new Map();
  const tree = root && find(root, 'p:cSld', 'p:spTree');
  for (const sp of children(tree, 'p:sp')) {
    const ph = placeholderOf(sp);
    if (!ph) continue;
    if (ph.idx !== null && !byIdx.has(ph.idx)) byIdx.set(ph.idx, sp);
    if (!byType.has(ph.type)) byType.set(ph.type, sp);
  }
  return { byIdx, byType };
}

// Every layout/master placeholder a slide shape inherits from, nearest first.
function inheritedPlaceholders(indexes, ph) {
  const typeKeys = ph.type === 'ctrTitle' ? ['ctrTitle', 'title'] : ph.type === 'subTitle' ? ['subTitle', 'body'] : [ph.type];
  const chain = [];
  for (const index of indexes) {
    const match =
      (ph.idx !== null && index.byIdx.get(ph.idx)) || typeKeys.map((t) => index.byType.get(t)).find(Boolean);
    if (match) chain.push(match);
  }
  return chain;
}

function masterStyleName(ph) {
  if (!ph) return null;
  if (ph.type === 'title' || ph.type === 'ctrTitle') return 'p:titleStyle';
  if (['body', 'subTitle', 'obj'].includes(ph.type)) return 'p:bodyStyle';
  return 'p:otherStyle';
}

function xfrmOf(sp) {
  const xfrm = find(sp, 'p:spPr', 'a:xfrm') || find(sp, 'p:grpSpPr', 'a:xfrm') || child(sp, 'p:xfrm');
  const off = child(xfrm, 'a:off');
  const ext = child(xfrm, 'a:ext');
  if (!off || !ext) return null;
  return {
    x: num(off, 'x'),
    y: num(off, 'y'),
    cx: num(ext, 'cx'),
    cy: num(ext, 'cy'),
    rot: (num(xfrm, 'rot') || 0) / 60000,
    flipH: attr(xfrm, 'flipH') === '1',
    flipV: attr(xfrm, 'flipV') === '1'
  };
}

// --- text -----------------------------------------------------------------

export function paragraphText(p) {
  let text = '';
  for (const c of children(p)) {
    if (c.nodeName === 'a:r' || c.nodeName === 'a:fld') text += child(c, 'a:t')?.textContent || '';
    else if (c.nodeName === 'a:br') text += '\n';
  }
  return text;
}

// Symbol fonts store bullets as private code points; these are the
// glyphs they draw.
const SYMBOL_BULLETS = {
  wingdings: { 'Ø': '➢', '§': '▪', 'ü': '✓', 'q': '❑', 'v': '❖', 'n': '■', 'l': '●', 'Ü': '➤', 'ð': '➔', 'à': '➔', 'o': '□', 'p': '□', 'w': '◆', 'u': '◆', 'ª': '▫', '¨': '◻', 'è': '➜', 'Þ': '➝' },
  symbol: { '·': '•', 'Ø': '➢', '¨': '♦', 'ß': '⇐', 'à': '◊', 'Þ': '⇒' }
};

function bulletChar(char, font) {
  const key = (font || '').toLowerCase();
  if (key.startsWith('wingdings')) return SYMBOL_BULLETS.wingdings[char] || '•';
  if (key === 'symbol') return SYMBOL_BULLETS.symbol[char] || char;
  return char;
}

function roman(n) {
  const table = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}

function alpha(n) {
  let out = '';
  while (n > 0) { n -= 1; out = String.fromCharCode(97 + (n % 26)) + out; n = Math.floor(n / 26); }
  return out;
}

export function autoNumber(scheme, n) {
  const m = /^(arabic|alphaLc|alphaUc|romanLc|romanUc|circleNumDb|circleNumWdBlack)(.*)$/.exec(scheme || 'arabicPeriod');
  let base = String(n);
  if (m?.[1] === 'alphaLc') base = alpha(n);
  if (m?.[1] === 'alphaUc') base = alpha(n).toUpperCase();
  if (m?.[1] === 'romanLc') base = roman(n);
  if (m?.[1] === 'romanUc') base = roman(n).toUpperCase();
  const suffix = m?.[2] || 'Period';
  if (suffix === 'Period') return `${base}.`;
  if (suffix === 'ParenR') return `${base})`;
  if (suffix === 'ParenBoth') return `(${base})`;
  if (suffix === 'Minus') return `${base} -`;
  return base; // Plain
}

const BULLET_TAGS = ['a:buNone', 'a:buChar', 'a:buAutoNum', 'a:buBlip'];

function firstAttr(nodes, name) {
  for (const n of nodes) {
    const v = attr(n, name);
    if (v !== null) return v;
  }
  return null;
}

function firstChild(nodes, tag) {
  for (const n of nodes) {
    const c = child(n, tag);
    if (c) return c;
  }
  return null;
}

const NBSP = '\u00a0';

function spaces(px, fontPx) {
  const n = Math.round(px / Math.max(1, fontPx * 0.25));
  return n > 0 ? NBSP.repeat(Math.min(n, 60)) : '';
}

// Builds the text extractor for one slide. `levelChain(lvl)` returns the
// inherited paragraph-property nodes for a level, nearest first.
function makeTextExtractor({ theme, fontPx, emuToPx }) {
  // own: the run's rPr; defaults: inherited defRPr nodes, nearest first.
  // Table-style overrides sit between the two, as in PowerPoint.
  function runStyle(own, defaults, overrides, fallbackColor, fontScale) {
    const rPrs = [own, ...defaults].filter(Boolean);
    const pick = (name, override) => {
      const v = attr(own, name);
      if (v !== null) return v;
      if (override !== undefined) return override ? '1' : '0';
      return firstAttr(defaults, name);
    };
    const style = {};
    const sz = firstAttr(rPrs, 'sz');
    const pt = (sz ? Number(sz) / 100 : DEFAULT_FONT_PT) * fontScale;
    style.fontSize = fontPx(pt);
    const b = pick('b', overrides.b);
    style.fontWeight = b === '1' || b === 'true' ? 'bold' : 'normal';
    const i = pick('i', overrides.i);
    style.fontStyle = i === '1' || i === 'true' ? 'italic' : 'normal';
    const u = firstAttr(rPrs, 'u');
    style.underline = !!u && u !== 'none';
    const strike = firstAttr(rPrs, 'strike');
    style.linethrough = !!strike && strike !== 'noStrike';
    let color = representativeColor(fillFrom(own, theme)) || overrides.color || null;
    if (!color) {
      for (const r of defaults) {
        const f = fillFrom(r, theme);
        if (f) {
          color = representativeColor(f);
          break;
        }
      }
    }
    style.fill = color || fallbackColor || '#000000';
    const typeface = resolveTypeface(firstAttr(rPrs.map((r) => child(r, 'a:latin')).filter(Boolean), 'typeface'), theme);
    style.fontFamily = fontStack(typeface || theme.fonts.minor || 'Calibri');
    return { style, cap: firstAttr(rPrs, 'cap'), pt };
  }

  // Returns text-block fields: { text, styles, fontSize, fontFamily, …,
  // textAlign, lineHeight } for a txBody, or null when it has no text.
  return function textFields(txBody, { levelChain = () => [], overrides = {}, fallbackColor = null, autofit = null } = {}) {
    if (!txBody) return null;
    const fontScale = autofit?.fontScale ?? 1;
    const spacingReduction = autofit?.lnSpcReduction ?? 0;
    const paragraphs = [];
    const aligns = new Map();
    let lineHeight = null;
    const counters = []; // auto-number counters by level
    let anyText = false;
    const gaps = []; // space between consecutive paragraphs, px
    let prevAfter = 0;

    for (const p of children(txBody, 'a:p')) {
      const pPr = child(p, 'a:pPr');
      const lvl = num(pPr, 'lvl') || 0;
      const chain = [pPr, ...levelChain(lvl)].filter(Boolean);
      const defRPrs = chain.map((n) => child(n, 'a:defRPr')).filter(Boolean);
      const plain = paragraphText(p);
      const runs = [];

      // Runs and line breaks.
      for (const c of children(p)) {
        if (c.nodeName === 'a:r' || c.nodeName === 'a:fld') {
          const { style, cap } = runStyle(child(c, 'a:rPr'), defRPrs, overrides, fallbackColor, fontScale);
          let text = child(c, 'a:t')?.textContent || '';
          if (cap === 'all' || cap === 'small') text = text.toUpperCase();
          runs.push({ text, style });
        } else if (c.nodeName === 'a:br') {
          const { style } = runStyle(child(c, 'a:rPr'), defRPrs, overrides, fallbackColor, fontScale);
          runs.push({ text: '\n', style });
        }
      }
      const endRPr = child(p, 'a:endParaRPr');
      const endStyle = runStyle(endRPr, defRPrs, overrides, fallbackColor, fontScale).style;
      const firstStyle = runs.find((r) => r.text.trim())?.style || runs[0]?.style || endStyle;

      // Tabs: advance to the next tab stop, estimating the width so far.
      const tabSize = emuToPx(Number(firstAttr(chain, 'defTabSz')) || 914400);
      let col = 0;
      for (const run of runs) {
        if (run.text === '\n') { col = 0; continue; }
        let out = '';
        for (const ch of run.text) {
          if (ch === '\t') {
            const next = (Math.floor(col / tabSize) + 1) * tabSize;
            out += spaces(next - col, run.style.fontSize);
            col = next;
          } else {
            out += ch;
            col += run.style.fontSize * 0.5;
          }
        }
        run.text = out;
      }

      // Bullets and numbering.
      const hasText = plain.trim().length > 0;
      const bulletNode = chain.map((n) => children(n).find((c) => BULLET_TAGS.includes(c.nodeName))).find(Boolean);
      const marL = emuToPx(Number(firstAttr(chain, 'marL')) || 0);
      const indent = emuToPx(Number(firstAttr(chain, 'indent')) || 0);
      let prefix = null;
      counters.length = Math.min(counters.length, lvl + 1);
      if (hasText && bulletNode && bulletNode.nodeName !== 'a:buNone') {
        const buFont = attr(firstChild(chain, 'a:buFont'), 'typeface');
        if (bulletNode.nodeName === 'a:buChar') prefix = bulletChar(attr(bulletNode, 'char') || '•', buFont);
        else if (bulletNode.nodeName === 'a:buAutoNum') {
          const start = num(bulletNode, 'startAt') || 1;
          counters[lvl] = counters[lvl] === undefined ? start : counters[lvl] + 1;
          prefix = autoNumber(attr(bulletNode, 'type'), counters[lvl]);
        } else prefix = '•';
        const bulletStyle = { ...firstStyle };
        const buClr = firstChild(chain, 'a:buClr');
        if (buClr) bulletStyle.fill = colorFrom(buClr, theme) || bulletStyle.fill;
        const buSz = firstChild(chain, 'a:buSzPct');
        if (buSz) bulletStyle.fontSize = Math.max(4, Math.round(bulletStyle.fontSize * ((num(buSz, 'val') || 100000) / 100000)));
        if (buFont && !/^(wingdings|symbol)/i.test(buFont) && bulletNode.nodeName === 'a:buChar') {
          bulletStyle.fontFamily = fontStack(resolveTypeface(buFont, theme));
        }
        const bulletX = Math.max(0, marL + indent);
        const gap = Math.max(firstStyle.fontSize * 0.3, marL - bulletX - prefix.length * firstStyle.fontSize * 0.5);
        runs.unshift(
          { text: spaces(bulletX, firstStyle.fontSize), style: firstStyle },
          { text: prefix, style: bulletStyle },
          { text: spaces(gap, firstStyle.fontSize) || NBSP, style: firstStyle }
        );
      } else {
        if (hasText && bulletNode?.nodeName === 'a:buNone') counters.length = Math.min(counters.length, lvl);
        const lead = spaces(Math.max(0, marL + indent), firstStyle.fontSize);
        if (lead && hasText) runs.unshift({ text: lead, style: firstStyle });
      }
      if (!runs.length) runs.push({ text: '', style: endStyle });
      if (hasText) anyText = true;

      if (hasText) {
        const algn = ALIGN[firstAttr(chain, 'algn')] || 'left';
        aligns.set(algn, (aligns.get(algn) || 0) + plain.length);
      }
      // Space before/after paragraphs: percentages are of the line (1.2×
      // the font size), points are absolute.
      const spacing = (tag) => {
        const node = firstChild(chain, tag);
        const pct = num(child(node, 'a:spcPct'), 'val');
        const pts = num(child(node, 'a:spcPts'), 'val');
        if (pts !== null) return fontPx(pts / 100);
        if (pct !== null) return (pct / 100000) * firstStyle.fontSize * 1.2 * (1 - spacingReduction);
        return 0;
      };
      if (paragraphs.length > 0) gaps.push(prevAfter + spacing('a:spcBef'));
      prevAfter = spacing('a:spcAft');
      if (lineHeight === null && hasText) {
        const lnSpc = firstChild(chain, 'a:lnSpc');
        const pct = num(child(lnSpc, 'a:spcPct'), 'val');
        const pts = num(child(lnSpc, 'a:spcPts'), 'val');
        if (pts) lineHeight = fontPx(pts / 100) / (firstStyle.fontSize * 1.13);
        else lineHeight = Math.max(0.5, (pct ? pct / 100000 : 1) - spacingReduction) * LINE_SCALE;
      }
      paragraphs.push({ runs });
    }
    if (!anyText) return null;

    // Trailing empty paragraphs only add height.
    while (paragraphs.length > 1 && paragraphs[paragraphs.length - 1].runs.every((r) => !r.text.trim())) paragraphs.pop();

    const rich = buildRichText(paragraphs);
    let textAlign = 'left';
    let best = -1;
    for (const [a, n] of aligns) if (n > best) { textAlign = a; best = n; }
    const fields = {
      text: rich.text,
      fontSize: rich.base.fontSize || fontPx(DEFAULT_FONT_PT),
      ...rich.base
    };
    if (rich.styles) fields.styles = rich.styles;
    if (textAlign !== 'left') fields.textAlign = textAlign;
    fields.lineHeight = Math.round(Math.min(4, Math.max(0.5, lineHeight ?? LINE_SCALE)) * 1000) / 1000;
    // One spacing per block (the editor's model): the most common gap.
    const counts = new Map();
    for (const g of gaps.slice(0, paragraphs.length - 1)) {
      const k = Math.round(g * 10) / 10;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let gap = 0;
    let seen = 0;
    for (const [k, n] of counts) if (n > seen) { gap = k; seen = n; }
    if (gap > 0.5) fields.paragraphSpacing = gap;
    return fields;
  };
}

// --- coordinate mapping ---------------------------------------------------

// Maps EMU coordinates (after any group transforms) onto the editor canvas.
function makeMapper(slideCx, slideCy) {
  const scale = TARGET_WIDTH / slideCx; // canvas aspect == source aspect, fill exactly
  const offsetX = 0;
  const offsetY = 0;
  const round1 = (v) => Math.round(v * 10) / 10;
  return {
    box: ({ x, y, cx, cy }) => ({
      x: round1(x * scale + offsetX),
      y: round1(y * scale + offsetY),
      width: round1(cx * scale),
      height: round1(cy * scale)
    }),
    // Points -> canvas px: 1pt is 12700 EMU on the slide.
    fontPx: (pt) => Math.max(4, Math.round(pt * EMU_PER_POINT * scale * 10) / 10),
    emuToPx: (emu) => emu * scale
  };
}

// Group shapes position children in their own coordinate space.
function groupTransform(grpSp, parentTransform) {
  const xfrm = find(grpSp, 'p:grpSpPr', 'a:xfrm');
  const off = child(xfrm, 'a:off');
  const ext = child(xfrm, 'a:ext');
  const chOff = child(xfrm, 'a:chOff');
  const chExt = child(xfrm, 'a:chExt');
  if (!off || !ext || !chOff || !chExt) return parentTransform;
  const sx = num(chExt, 'cx') ? num(ext, 'cx') / num(chExt, 'cx') : 1;
  const sy = num(chExt, 'cy') ? num(ext, 'cy') / num(chExt, 'cy') : 1;
  const local = (b) => ({
    ...b,
    x: num(off, 'x') + (b.x - num(chOff, 'x')) * sx,
    y: num(off, 'y') + (b.y - num(chOff, 'y')) * sy,
    cx: b.cx * sx,
    cy: b.cy * sy
  });
  return (b) => parentTransform(local(b));
}

// --- images ---------------------------------------------------------------

async function embedImage(zip, target, ctx, { crop = null, maxSide = 1600 } = {}) {
  const ext = path.posix.extname(target).slice(1).toLowerCase();
  const file = zip.file(target);
  if (!file) return null;
  let data = await file.async('nodebuffer');
  let mime = mimeForExt(ext);
  const processed = await processImage(data, ext, { crop, maxSide, maxBytes: MAX_IMAGE_BYTES });
  if (processed) {
    data = processed.buffer;
    mime = processed.mime;
  } else if (!WEB_IMAGE_EXT.has(ext)) {
    ctx.warnings.add('image-format');
    return null;
  } else if (crop && (crop.l || crop.t || crop.r || crop.b)) {
    ctx.warnings.add('image-crop');
  }
  if (data.length > MAX_IMAGE_BYTES || ctx.imageBytes + data.length > MAX_TOTAL_IMAGE_BYTES) {
    ctx.skippedImages += 1;
    return null;
  }
  ctx.imageBytes += data.length;
  return toDataUrl(data, mime);
}

function cropOf(blipFill) {
  const src = child(blipFill, 'a:srcRect');
  if (!src) return null;
  const f = (k) => (num(src, k) || 0) / 100000;
  return { l: f('l'), t: f('t'), r: f('r'), b: f('b') };
}

// --- slide parts ----------------------------------------------------------

async function loadPart(zip, partPath, ctx) {
  if (!partPath) return null;
  if (!ctx.parts.has(partPath)) {
    const root = await readXml(zip, partPath);
    ctx.parts.set(partPath, root ? { path: partPath, root, rels: await readRels(zip, partPath) } : null);
  }
  return ctx.parts.get(partPath);
}

// A background (p:bg) of one part, as slide fields; null when the part
// doesn't define one.
async function backgroundOf(zip, part, theme, ctx) {
  const bg = part && find(part.root, 'p:cSld', 'p:bg');
  if (!bg) return null;
  const bgPr = child(bg, 'p:bgPr');
  const bgRef = child(bg, 'p:bgRef');
  const fill = bgPr ? fillFrom(bgPr, theme) : styleRefFill(bgRef, theme.bgFillStyles, theme);
  if (!fill) return null;
  if (fill.type === 'solid') return { backgroundColor: fill.color };
  if (fill.type === 'gradient') {
    return { backgroundColor: fill.stops[0].color, backgroundGradient: { angle: fill.angle, stops: fill.stops } };
  }
  if (fill.type === 'image') {
    const target = part.rels.get(fill.rId)?.target;
    const url = target && (await embedImage(zip, target, ctx, { maxSide: 1920 }));
    if (url) return { backgroundImageUrl: url, ...(fill.tile ? { backgroundRepeat: true } : {}) };
    return null;
  }
  return null;
}

// First descendant with a tag name, depth first.
function descendant(node, tag) {
  for (const c of children(node)) {
    if (c.nodeName === tag) return c;
    const found = descendant(c, tag);
    if (found) return found;
  }
  return null;
}

// A SmartArt graphic's pre-drawn layout (the dsp:drawing part PowerPoint
// caches next to the diagram data), parsed with its dsp: tags renamed to
// p: so the slide shape reader can walk it.
async function smartArtDrawing(zip, data, part) {
  const relIds = child(data, 'dgm:relIds');
  const dm = attr(relIds, 'r:dm');
  const dataPath = dm && part.rels.get(dm)?.target;
  const dataRoot = dataPath && (await readXml(zip, dataPath));
  let drawingPath = null;
  const ext = dataRoot && descendant(dataRoot, 'dsp:dataModelExt');
  const relId = attr(ext, 'relId');
  if (relId) drawingPath = part.rels.get(relId)?.target || null;
  if (!drawingPath) {
    // Older files: the slide's only diagram drawing, if unambiguous.
    const drawings = [...part.rels.values()].filter((r) => r.type.endsWith('/diagramDrawing'));
    if (drawings.length === 1) drawingPath = drawings[0].target;
  }
  const file = drawingPath && zip.file(drawingPath);
  if (!file) return null;
  const xml = (await file.async('string'))
    .replace(/<(\/?)dsp:/g, '<$1p:')
    .replace(/xmlns:dsp=/g, 'xmlns:p=');
  const root = parseXml(xml);
  const tree = root && child(root, 'p:spTree');
  return tree ? { tree, rels: await readRels(zip, drawingPath) } : null;
}

async function extractSlide(zip, slidePath, slideIndex, ctx) {
  const slide = await loadPart(zip, slidePath, ctx);
  if (!slide) throw new PptxParseError(`Missing slide part ${slidePath}`);
  const layout = await loadPart(zip, relOfType(slide.rels, '/slideLayout'), ctx);
  const master = layout && (await loadPart(zip, relOfType(layout.rels, '/slideMaster'), ctx));
  if (master && !ctx.themes.has(master.path)) ctx.themes.set(master.path, await readTheme(zip, master.path, master.root));
  const theme = (master && ctx.themes.get(master.path)) || (await readTheme(zip, null, null));
  if (!ctx.tableStyles) ctx.tableStyles = parseTableStyles(await readXml(zip, 'ppt/tableStyles.xml'), theme);
  const phIndexes = [indexPlaceholders(layout?.root), indexPlaceholders(master?.root)];
  const { map } = ctx;
  const textFields = makeTextExtractor({ theme, fontPx: map.fontPx, emuToPx: map.emuToPx });

  const blocks = [];
  let blockN = 0;
  const nextId = () => `s${slideIndex}-b${blockN++}`;

  function levelChainFor(sp, chain, ph) {
    const styleName = masterStyleName(ph);
    return (lvl) => {
      const tag = `a:lvl${lvl + 1}pPr`;
      const nodes = [sp, ...chain].map((shape) => find(shape, 'p:txBody', 'a:lstStyle', tag));
      if (styleName && master) nodes.push(find(master.root, 'p:txStyles', styleName, tag));
      nodes.push(find(ctx.presentation, 'p:defaultTextStyle', tag));
      return nodes.filter(Boolean);
    };
  }

  function bodyProps(sp, chain) {
    const bodyPrs = [sp, ...chain].map((s) => find(s, 'p:txBody', 'a:bodyPr')).filter(Boolean);
    const get = (name) => firstAttr(bodyPrs, name);
    const norm = bodyPrs.map((b) => child(b, 'a:normAutofit')).find(Boolean);
    return {
      insets: {
        l: Number(get('lIns') ?? 91440),
        t: Number(get('tIns') ?? 45720),
        r: Number(get('rIns') ?? 91440),
        b: Number(get('bIns') ?? 45720)
      },
      anchor: ANCHOR[get('anchor')] || 'top',
      wrap: get('wrap') !== 'none',
      vert: get('vert'),
      autofit: norm
        ? { fontScale: (num(norm, 'fontScale') ?? 100000) / 100000, lnSpcReduction: (num(norm, 'lnSpcReduction') ?? 0) / 100000 }
        : null
    };
  }

  function shapeAppearance(sp, chain) {
    const spPrs = [sp, ...chain].map((s) => child(s, 'p:spPr')).filter(Boolean);
    const style = child(sp, 'p:style');
    let fill = null;
    for (const spPr of spPrs) {
      fill = fillFrom(spPr, theme);
      if (fill) break;
    }
    if (!fill && style) fill = styleRefFill(child(style, 'a:fillRef'), theme.fillStyles, theme);
    let line = null;
    const ln = spPrs.map((s) => child(s, 'a:ln')).find(Boolean);
    const lnRef = style && child(style, 'a:lnRef');
    const refColor = lnRef && colorFrom(lnRef, theme);
    const refEntry = lnRef && theme.lineStyles[(num(lnRef, 'idx') || 0) - 1];
    if (ln) {
      line = lineFrom(ln, theme);
      if (line && !line.none) {
        line.color = line.color || refColor;
        line.width = line.width ?? num(refEntry, 'w') ?? 12700;
      }
    } else if (lnRef && num(lnRef, 'idx') > 0 && refColor) {
      line = { color: refColor, width: num(refEntry, 'w') ?? 12700, dash: false };
    }
    const fontRefColor = style && colorFrom(child(style, 'a:fontRef'), theme);
    return { fill, line, fontRefColor };
  }

  function geometryOf(sp, chain, cx, cy) {
    const spPrs = [sp, ...chain].map((s) => child(s, 'p:spPr')).filter(Boolean);
    const cust = spPrs.map((s) => child(s, 'a:custGeom')).find(Boolean);
    if (cust) {
      const d = customPath(cust);
      if (d) return { shape: 'path', path: d };
    }
    const prst = spPrs.map((s) => child(s, 'a:prstGeom')).find(Boolean);
    return prst ? presetShape(prst, cx, cy) : { shape: 'rect' };
  }

  function placed(box, xf) {
    const out = { x: box.x, y: box.y, width: Math.max(1, box.width), height: Math.max(1, box.height) };
    if (xf.rot) out.rotation = Math.round((((xf.rot % 360) + 360) % 360) * 10) / 10;
    return out;
  }

  function shapeBlocks(sp, transform, { decor = false } = {}) {
    const ph = placeholderOf(sp);
    if (decor && ph) return []; // layout/master placeholders are prompts, not content
    const chain = ph ? inheritedPlaceholders(phIndexes, ph) : [];
    const xf = [sp, ...chain].map(xfrmOf).find(Boolean);
    if (!xf) return [];
    const t = transform(xf);
    const box = map.box(t);
    const out = [];
    const { fill, line, fontRefColor } = shapeAppearance(sp, chain);
    const geom = geometryOf(sp, chain, xf.cx, xf.cy);
    const visibleFill = fill && fill.type !== 'none' && fill.type !== 'group';
    const visibleLine = line && !line.none && line.color;

    if (visibleFill || visibleLine) {
      const block = { id: nextId(), type: 'shape', ...placed(box, xf), fontSize: 16, text: '', shape: geom.shape };
      if (geom.path) block.path = geom.path;
      if (geom.radiusRatio) block.radius = Math.round(Math.min(box.width, box.height) * geom.radiusRatio * 10) / 10;
      if (geom.approximate) ctx.warnings.add('shape-approx');
      if (visibleFill) {
        if (fill.type === 'gradient') {
          block.fillGradient = { angle: fill.angle, stops: fill.stops };
          block.background = fill.stops[0].color;
        } else if (fill.type === 'image') {
          // Picture-filled shapes are drawn as the picture.
          block.imageFillRId = fill.rId;
        } else {
          block.background = fill.color;
          if (fill.alpha < 1) block.opacity = Math.round(fill.alpha * 100) / 100;
        }
      }
      if (visibleLine) {
        block.stroke = line.color;
        block.strokeWidth = Math.max(0.5, Math.round(map.emuToPx(line.width ?? 12700) * 10) / 10);
        if (line.dash) block.dash = true;
      }
      if (xf.flipH) block.flipH = true;
      if (xf.flipV) block.flipV = true;
      if (decor) block.role = 'decor';
      out.push(block);
    }

    const body = child(sp, 'p:txBody');
    if (body) {
      const props = bodyProps(sp, chain);
      // SmartArt shapes can place their text in a rectangle of its own.
      const txXfrm = child(sp, 'p:txXfrm');
      const txOff = child(txXfrm, 'a:off');
      const txExt = child(txXfrm, 'a:ext');
      const textBox = txOff && txExt
        ? map.box(transform({ x: num(txOff, 'x'), y: num(txOff, 'y'), cx: num(txExt, 'cx'), cy: num(txExt, 'cy') }))
        : box;
      const fields = textFields(body, {
        levelChain: levelChainFor(sp, chain, ph),
        fallbackColor: fontRefColor,
        autofit: props.autofit
      });
      if (fields) {
        const ins = {
          l: map.emuToPx(props.insets.l),
          t: map.emuToPx(props.insets.t),
          r: map.emuToPx(props.insets.r),
          b: map.emuToPx(props.insets.b)
        };
        let x = textBox.x + ins.l;
        let width = Math.max(20, textBox.width - ins.l - ins.r);
        if (!props.wrap) {
          // No wrapping in the source: make sure the longest line fits.
          const longest = Math.max(...fields.text.split('\n').map((l) => l.length));
          const needed = longest * fields.fontSize * 0.55;
          if (needed > width) {
            const extra = needed - width;
            if (fields.textAlign === 'center') x -= extra / 2;
            else if (fields.textAlign === 'right') x -= extra;
            width = needed;
          }
        }
        const r1 = (v) => Math.round(v * 10) / 10;
        const block = {
          id: nextId(),
          type: 'textbox',
          x: r1(x),
          y: r1(textBox.y + ins.t),
          width: r1(width),
          height: r1(Math.max(1, textBox.height - ins.t - ins.b)),
          ...fields
        };
        if (props.anchor !== 'top') block.verticalAlign = props.anchor;
        if (xf.rot) block.rotation = placed(box, xf).rotation;
        if (props.vert === 'vert' || props.vert === 'eaVert') block.rotation = ((block.rotation || 0) + 90) % 360;
        if (props.vert === 'vert270') block.rotation = ((block.rotation || 0) + 270) % 360;
        if (ph?.type === 'title' || ph?.type === 'ctrTitle') block.role = 'title';
        else if (ph?.type === 'subTitle') block.role = 'subtitle';
        if (decor) block.role = 'decor';
        out.push(block);
      }
    }
    return out;
  }

  async function pictureBlock(pic, transform, part, frameXf = null) {
    const blipFill = child(pic, 'p:blipFill');
    const rId = attr(child(blipFill, 'a:blip'), 'r:embed');
    const target = rId && part.rels.get(rId)?.target;
    const xf = frameXf || xfrmOf(pic);
    if (!target || !xf) return [];
    const box = map.box(transform(xf));
    const url = await embedImage(zip, target, ctx, {
      crop: cropOf(blipFill),
      maxSide: Math.min(2400, Math.max(400, Math.round(Math.max(box.width, box.height) * 2)))
    });
    if (!url) return [placeholderBlock(box, 'Picture (format not supported)')];
    const block = { id: nextId(), type: 'image', ...placed(box, xf), fontSize: 16, text: '', imageUrl: url };
    if (xf.flipH) block.flipH = true;
    if (xf.flipV) block.flipV = true;
    return [block];
  }

  // Content we can't redraw stays visible as a labelled, dashed frame
  // the user can see, move and replace.
  function placeholderBlock(box, label) {
    ctx.placeholders += 1;
    return [
      {
        id: nextId(),
        type: 'shape',
        x: box.x, y: box.y, width: Math.max(20, box.width), height: Math.max(20, box.height),
        fontSize: 16, text: '', shape: 'rect',
        background: '#f3f4f2', stroke: '#8a8f88', strokeWidth: 1.5, dash: true, role: 'placeholder'
      },
      {
        id: nextId(),
        type: 'textbox',
        x: box.x + 8, y: box.y + 8, width: Math.max(20, box.width - 16), height: Math.max(10, box.height - 16),
        fontSize: Math.max(10, Math.min(18, Math.round(box.height / 8))),
        text: label, fill: '#4a4f49', textAlign: 'center', verticalAlign: 'middle', role: 'placeholder'
      }
    ];
  }

  async function frameBlocks(frame, transform, part) {
    const xf = xfrmOf(frame);
    if (!xf) return [];
    const box = map.box(transform(xf));
    const data = find(frame, 'a:graphic', 'a:graphicData');
    const uri = attr(data, 'uri') || '';
    const tbl = child(data, 'a:tbl');
    if (tbl) {
      const block = tableBlock(tbl, {
        box,
        theme,
        tableStyles: ctx.tableStyles,
        emuToPx: map.emuToPx,
        warnings: ctx.warnings,
        textFields: (txBody, opts) => {
          const fields = textFields(txBody, {
            ...opts,
            levelChain: (lvl) => {
              const tag = `a:lvl${lvl + 1}pPr`;
              return [find(txBody, 'a:lstStyle', tag), find(ctx.presentation, 'p:defaultTextStyle', tag)].filter(Boolean);
            }
          });
          return fields || { text: '', fontSize: map.fontPx(DEFAULT_FONT_PT) };
        }
      });
      ctx.tables += 1;
      return [{ id: nextId(), ...block }];
    }
    if (uri.endsWith('/chart')) {
      const rId = attr(child(data, 'c:chart'), 'r:id');
      const target = rId && part.rels.get(rId)?.target;
      const parsed = await readChart(zip, target, { theme, fontPx: map.fontPx }).catch(() => null);
      if (!parsed?.chart) {
        ctx.warnings.add('chart');
        return placeholderBlock(box, 'Chart\n(its data could not be read)');
      }
      if (parsed.notes.size) ctx.warnings.add('chart-simplified');
      ctx.charts += 1;
      const block = { id: nextId(), type: 'chart', ...placed(box, xf), fontSize: 16, text: '', chart: parsed.chart };
      return [block];
    }
    if (uri.endsWith('/diagram')) {
      const drawing = await smartArtDrawing(zip, data, part).catch(() => null);
      if (drawing) {
        // Drawing coordinates are relative to the graphic frame.
        const inFrame = (b) => transform({ ...b, x: xf.x + b.x, y: xf.y + b.y });
        const drawingPart = { ...part, rels: drawing.rels };
        const out = await walk(drawing.tree, inFrame, drawingPart);
        if (out.length) {
          ctx.smartArt += 1;
          return out;
        }
      }
      ctx.warnings.add('smartart');
      return placeholderBlock(box, 'SmartArt graphic\n(no saved layout to redraw)');
    }
    if (uri.endsWith('/ole') || descendant(data, 'p:oleObj')) {
      // Embedded documents (Excel sheets, Visio drawings…) carry a preview
      // picture of themselves; show that in the object's frame.
      const pic = descendant(data, 'p:pic');
      if (pic) {
        const preview = await pictureBlock(pic, transform, part, xf);
        if (preview.length && preview[0].type === 'image') {
          preview[0].role = 'object';
          ctx.warnings.add('object-preview');
          return preview;
        }
      }
      ctx.warnings.add('object');
      return placeholderBlock(box, 'Embedded object');
    }
    ctx.warnings.add('object');
    return placeholderBlock(box, 'Embedded object');
  }

  async function walk(tree, transform, part, opts = {}) {
    const out = [];
    for (const node of children(tree)) {
      switch (node.nodeName) {
        case 'p:grpSp':
          out.push(...(await walk(node, groupTransform(node, transform), part, opts)));
          break;
        case 'p:sp':
        case 'p:cxnSp':
          out.push(...shapeBlocks(node, transform, opts));
          break;
        case 'p:pic':
          if (!(opts.decor && placeholderOf(node))) out.push(...(await pictureBlock(node, transform, part)));
          break;
        case 'p:graphicFrame':
          out.push(...(await frameBlocks(node, transform, part)));
          break;
        case 'mc:AlternateContent': {
          // Newer features ship with a fallback older readers understand.
          const fallback = child(node, 'mc:Fallback');
          if (fallback) out.push(...(await walk(fallback, transform, part, opts)));
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  // Decorative shapes from the master and layout sit behind the slide's own.
  const identity = (b) => b;
  const showMaster = attr(slide.root, 'showMasterSp') !== '0';
  const layoutShowsMaster = layout && attr(layout.root, 'showMasterSp') !== '0';
  if (showMaster && layoutShowsMaster && master) {
    blocks.push(...(await walk(find(master.root, 'p:cSld', 'p:spTree'), identity, master, { decor: true })));
  }
  if (showMaster && layout) {
    blocks.push(...(await walk(find(layout.root, 'p:cSld', 'p:spTree'), identity, layout, { decor: true })));
  }
  blocks.push(...(await walk(find(slide.root, 'p:cSld', 'p:spTree'), identity, slide)));

  // Picture-filled shapes become image blocks in the same place.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b.imageFillRId) continue;
    const part = [slide, layout, master].find((p) => p?.rels.has(b.imageFillRId));
    const target = part?.rels.get(b.imageFillRId)?.target;
    const url = target && (await embedImage(zip, target, ctx, { maxSide: 1600 }));
    const { imageFillRId: _drop, ...rest } = b;
    blocks[i] = url
      ? { ...rest, type: 'image', imageUrl: url, shape: undefined, background: undefined }
      : rest;
    if (!url) delete blocks[i].imageFillRId;
    for (const k of Object.keys(blocks[i])) if (blocks[i][k] === undefined) delete blocks[i][k];
  }

  // Background: the slide's own, else its layout's, else its master's.
  let background = null;
  for (const part of [slide, layout, master]) {
    background = await backgroundOf(zip, part, theme, ctx);
    if (background) break;
  }

  // Speaker notes live in the notes slide's body placeholder.
  let notes = '';
  const notesPath = relOfType(slide.rels, '/notesSlide');
  const notesRoot = notesPath && (await readXml(zip, notesPath));
  if (notesRoot) {
    for (const sp of children(find(notesRoot, 'p:cSld', 'p:spTree'), 'p:sp')) {
      if (placeholderOf(sp)?.type !== 'body') continue;
      notes = children(child(sp, 'p:txBody'), 'a:p').map(paragraphText).join('\n').trim();
      break;
    }
  }

  const out = {
    id: `slide-${slideIndex + 1}`,
    order: slideIndex,
    blocks,
    notes,
    needsImageFallback: blocks.length === 0
  };
  if (background?.backgroundColor && isHexColor(background.backgroundColor)) out.backgroundColor = background.backgroundColor;
  if (background?.backgroundGradient) out.backgroundGradient = background.backgroundGradient;
  if (background?.backgroundImageUrl) out.backgroundImageUrl = background.backgroundImageUrl;
  return out;
}

// What the importer had to approximate or leave out, in words the
// import summary can show.
const WARNING_TEXT = {
  chart: 'Some charts could not be read and are shown as labelled placeholders.',
  'chart-simplified': 'Some charts use 3-D, combined types, trendlines or more series than PreSync draws, and are shown simplified.',
  smartart: 'Some SmartArt has no saved layout and is shown as a labelled placeholder.',
  'object-preview': 'Embedded objects (such as spreadsheets) show their preview picture and cannot be edited here.',
  object: 'Some embedded objects are shown as labelled placeholders.',
  'image-format': 'Some pictures use a format browsers cannot show (such as EMF or TIFF) and are shown as placeholders.',
  'image-crop': 'Some cropped pictures are shown uncropped.',
  'shape-approx': 'Some shapes with uncommon outlines are drawn as rectangles.',
  'table-style': 'Some tables use a style we do not recognise and keep only their own cell formatting.'
};

// Main entry point: given a .pptx as a Buffer, returns slides in the
// same shape as extractSlidesFromPdf. `report` (optional) receives what
// was approximated.
export async function extractSlidesFromPptx(buffer, report = null) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new PptxParseError('File is not a valid .pptx (zip) archive');
  }

  const presentationPath = 'ppt/presentation.xml';
  const presentation = await readXml(zip, presentationPath);
  if (!presentation) throw new PptxParseError('Missing ppt/presentation.xml');

  const size = child(presentation, 'p:sldSz');
  const slideCx = num(size, 'cx') || 12192000; // 16:9 default
  const slideCy = num(size, 'cy') || 6858000;

  const rels = await readRels(zip, presentationPath);
  const slidePaths = children(child(presentation, 'p:sldIdLst'), 'p:sldId')
    .map((s) => rels.get(attr(s, 'r:id'))?.target)
    .filter(Boolean);
  if (slidePaths.length === 0) throw new PptxParseError('Presentation has no slides');

  const ctx = {
    map: makeMapper(slideCx, slideCy),
    presentation,
    parts: new Map(),
    themes: new Map(),
    tableStyles: null,
    imageBytes: 0,
    skippedImages: 0,
    placeholders: 0,
    tables: 0,
    charts: 0,
    smartArt: 0,
    warnings: new Set()
  };

  const slides = [];
  for (let i = 0; i < slidePaths.length; i++) {
    slides.push(await extractSlide(zip, slidePaths[i], i, ctx));
  }
  if (report) {
    report.warnings = [...ctx.warnings].map((w) => WARNING_TEXT[w]).filter(Boolean);
    report.skippedImages = ctx.skippedImages;
    report.placeholders = ctx.placeholders;
    report.tables = ctx.tables;
    report.charts = ctx.charts;
    report.smartArt = ctx.smartArt;
    report.aspect = slideCx / slideCy;
  }
  const canvasWidth  = TARGET_WIDTH;
  const canvasHeight = Math.round(TARGET_WIDTH / (slideCx / slideCy));
  return { slides, canvasWidth, canvasHeight };
}
