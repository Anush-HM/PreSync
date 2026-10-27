import PptxGenJS from 'pptxgenjs';
import PDFDocument from 'pdfkit';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { CHART_COLORS, chartLayout, pointColor, seriesColor } from './chartLayout.js';

// Turns a deck's slides (the Deck model shape) back into files people
// can take elsewhere: a .pptx with real, editable text boxes, or a PDF.
// Both work from the 960×540 editor canvas, so positions carry over 1:1.

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
const DEFAULT_TEXT_COLOR = '#1a1a2e';
const DEFAULT_LINE_HEIGHT = 1.16;

// --- shared helpers -----------------------------------------------------

function sortedSlides(deck) {
  return [...(deck.slides || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function isHexColor(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

// Decodes an inline data: URL image. Remote URLs are skipped on export
// rather than fetched server-side.
function decodeDataUrl(url) {
  const match = /^data:(image\/(png|jpe?g|gif|webp|svg\+xml|bmp));base64,(.+)$/i.exec(url || '');
  if (!match) return null;
  return { mime: match[1].toLowerCase(), base64: match[3], buffer: Buffer.from(match[3], 'base64') };
}

const STYLE_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'underline', 'linethrough', 'fill'];

// The block's text as lines of runs, each run carrying its full style
// (block defaults overlaid with any per-character style ranges, which
// count characters but not line breaks).
function baseStyle(block) {
  const base = {};
  STYLE_KEYS.forEach((k) => {
    if (block[k] !== undefined && block[k] !== null) base[k] = block[k];
  });
  return base;
}

export function textLines(block) {
  const base = baseStyle(block);
  const ranges = Array.isArray(block.styles) ? [...block.styles].filter((r) => r && r.end > r.start).sort((a, b) => a.start - b.start) : [];
  const lines = [];
  let index = 0;
  for (const lineText of String(block.text || '').split('\n')) {
    const runs = [];
    for (const ch of Array.from(lineText)) {
      const range = ranges.find((r) => r.start <= index && index < r.end) || null;
      const last = runs[runs.length - 1];
      if (last && last.range === range) last.text += ch;
      else runs.push({ text: ch, style: range ? { ...base, ...range.style } : base, range });
      index += 1;
    }
    lines.push(runs.map(({ text, style }) => ({ text, style })));
  }
  return lines;
}

function primaryFont(family) {
  return (family || 'Arial').split(',')[0].replace(/["']/g, '').trim() || 'Arial';
}

// Splits an SVG-style path in the 0–1000 box (M, L, C, Q, A, Z with
// absolute coordinates) into commands.
export function parsePath(d) {
  const out = [];
  const re = /([MLCQAZ])([^MLCQAZ]*)/gi;
  let m;
  while ((m = re.exec(d || ''))) {
    const nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    out.push({ cmd: m[1].toUpperCase(), nums });
  }
  return out;
}

// Rough text height so exported boxes are about as tall as their text.
function estimateTextHeight(block) {
  const fontSize = block.fontSize || 16;
  const lineHeight = fontSize * (block.lineHeight || DEFAULT_LINE_HEIGHT);
  const charsPerLine = Math.max(1, Math.floor((block.width || 300) / (fontSize * 0.5)));
  const lines = (block.text || '')
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return Math.ceil(lines * lineHeight);
}

export function exportFileName(title, ext) {
  const base = (title || 'deck').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, ' ').slice(0, 80) || 'deck';
  return `${base}.${ext}`;
}

// --- PPTX ---------------------------------------------------------------

// 16:9 layout is 10in × 5.625in, so 96 canvas px = 1in and 1px = 0.75pt.
const PX_PER_INCH = CANVAS_WIDTH / 10;
const inch = (px) => px / PX_PER_INCH;
const pt = (px) => Math.round(px * 0.75 * 10) / 10;

const OFFICE_IMAGE = /^image\/(png|jpe?g|gif)$/;
const hex = (c) => (isHexColor(c) ? c.slice(1).toUpperCase() : null);

function pptxRunOptions(style) {
  return {
    fontFace: primaryFont(style.fontFamily),
    fontSize: pt(style.fontSize || 16),
    bold: style.fontWeight === 'bold' || Number(style.fontWeight) >= 600,
    italic: style.fontStyle === 'italic',
    underline: style.underline ? { style: 'sng' } : undefined,
    strike: style.linethrough ? 'sngStrike' : undefined,
    color: hex(style.fill) || DEFAULT_TEXT_COLOR.slice(1)
  };
}

// Text as pptxgenjs runs, one paragraph per line, with the block's
// per-character formatting.
function pptxTextRuns(block) {
  const runs = [];
  const lines = textLines(block);
  lines.forEach((line, i) => {
    const parts = line.length ? line : [{ text: '', style: baseStyle(block) }];
    parts.forEach((run, j) => {
      const options = pptxRunOptions(run.style);
      if (j === parts.length - 1 && i < lines.length - 1) options.breakLine = true;
      runs.push({ text: run.text, options });
    });
  });
  return runs;
}

function geometry(b, fallbackH) {
  const opts = { x: inch(b.x || 0), y: inch(b.y || 0), w: inch(b.width || 100), h: inch(b.height || fallbackH || 100) };
  if (b.rotation) opts.rotate = b.rotation;
  if (b.flipH) opts.flipH = true;
  if (b.flipV) opts.flipV = true;
  return opts;
}

function pptxPathPoints(d, w, h) {
  const X = (v) => inch((v / 1000) * w);
  const Y = (v) => inch((v / 1000) * h);
  const points = [];
  for (const { cmd, nums } of parsePath(d)) {
    if (cmd === 'M') points.push({ x: X(nums[0]), y: Y(nums[1]), moveTo: true });
    else if (cmd === 'L') points.push({ x: X(nums[0]), y: Y(nums[1]) });
    else if (cmd === 'C') points.push({ x: X(nums[4]), y: Y(nums[5]), curve: { type: 'cubic', x1: X(nums[0]), y1: Y(nums[1]), x2: X(nums[2]), y2: Y(nums[3]) } });
    else if (cmd === 'Q') points.push({ x: X(nums[2]), y: Y(nums[3]), curve: { type: 'quadratic', x1: X(nums[0]), y1: Y(nums[1]) } });
    // Arcs become straight segments to their end point.
    else if (cmd === 'A') points.push({ x: X(nums[5]), y: Y(nums[6]) });
    else if (cmd === 'Z') points.push({ close: true });
  }
  return points;
}

function addPptxShape(pptx, slide, b) {
  const opts = geometry(b);
  const fillColor = hex(b.background) || hex(b.fillGradient?.stops?.[0]?.color);
  opts.fill = fillColor ? { color: fillColor, transparency: Math.round((1 - (b.opacity ?? 1)) * 100) } : { type: 'none' };
  opts.line = hex(b.stroke)
    ? { color: hex(b.stroke), width: pt(b.strokeWidth || 1), dashType: b.dash ? 'dash' : 'solid' }
    : { type: 'none' };
  if (b.shape === 'ellipse') return slide.addShape(pptx.ShapeType.ellipse, opts);
  if (b.shape === 'line') {
    return slide.addShape(pptx.ShapeType.line, { ...opts, line: { color: hex(b.stroke) || '000000', width: pt(b.strokeWidth || 1), dashType: b.dash ? 'dash' : 'solid' } });
  }
  if (b.shape === 'roundRect') {
    const r = b.radius ? b.radius / Math.min(b.width || 100, b.height || 100) : 0.17;
    return slide.addShape(pptx.ShapeType.roundRect, { ...opts, rectRadius: Math.min(0.5, r) });
  }
  if (b.shape === 'path' && b.path) {
    const points = pptxPathPoints(b.path, b.width || 100, b.height || 100);
    if (points.length) return slide.addShape('custGeom', { ...opts, points });
  }
  return slide.addShape(pptx.ShapeType.rect, opts);
}

function pptxBorder(border) {
  return border ? { type: 'solid', pt: pt(Math.max(0.5, border.width)), color: hex(border.color) || '000000' } : { type: 'none' };
}

function addPptxTable(slide, b) {
  const t = b.table;
  if (!t?.rows?.length || !t.columns?.length) return;
  const rows = t.rows.map((row) =>
    row.cells
      .filter((c) => !c.covered)
      .map((c) => ({
        text: pptxTextRuns({ ...c, text: c.text || '' }),
        options: {
          fill: hex(c.background) ? { color: hex(c.background) } : undefined,
          align: c.textAlign || 'left',
          valign: c.verticalAlign === 'middle' ? 'middle' : c.verticalAlign === 'bottom' ? 'bottom' : 'top',
          colspan: c.colspan > 1 ? c.colspan : undefined,
          rowspan: c.rowspan > 1 ? c.rowspan : undefined,
          margin: (c.padding || [4, 7, 4, 7]).map((v) => pt(v)),
          border: ['top', 'right', 'bottom', 'left'].map((side) => pptxBorder(c.borders?.[side]))
        }
      }))
  );
  slide.addTable(rows, {
    x: inch(b.x || 0),
    y: inch(b.y || 0),
    colW: t.columns.map(inch),
    rowH: t.rows.map((r) => inch(Math.max(8, r.height || 0))),
    autoPage: false
  });
}

// Charts go out as native PowerPoint charts, so their data stays editable.
function addPptxChart(pptx, slide, b) {
  const c = b.chart;
  if (!c?.series?.length) return;
  const kind = c.kind || 'column';
  const type = {
    column: pptx.ChartType.bar, bar: pptx.ChartType.bar, line: pptx.ChartType.line, area: pptx.ChartType.area,
    pie: pptx.ChartType.pie, doughnut: pptx.ChartType.doughnut, scatter: pptx.ChartType.scatter
  }[kind] || pptx.ChartType.bar;
  const labels = (c.categories || []).map((l) => String(l ?? ''));
  const clean = (vals) => (vals || []).map((v) => (Number.isFinite(v) ? v : null));
  let data;
  if (kind === 'scatter') {
    const xs = c.series[0].xValues || c.series[0].values.map((_, i) => i + 1);
    data = [{ name: 'X', values: clean(xs) }, ...c.series.map((s) => ({ name: s.name || 'Series', values: clean(s.values) }))];
  } else {
    data = c.series.map((s) => ({ name: s.name || 'Series', labels, values: clean(s.values) }));
  }
  const pie = kind === 'pie' || kind === 'doughnut';
  const colors = pie
    ? labels.map((_, i) => hex(pointColor(c, i)) || CHART_COLORS[i % CHART_COLORS.length].slice(1))
    : c.series.map((_, i) => hex(seriesColor(c, i)) || '2E7D5B');
  const textPt = pt(c.fontSize || 12);
  const opts = {
    ...geometry(b, b.height || 260),
    chartColors: colors,
    showLegend: (c.legend || (pie || c.series.length > 1 ? 'bottom' : 'none')) !== 'none',
    legendPos: { bottom: 'b', right: 'r', top: 't' }[c.legend] || 'b',
    legendFontSize: textPt,
    showTitle: !!c.title,
    title: c.title || undefined,
    titleFontSize: Math.round(textPt * 1.3),
    showValue: !!c.dataLabels && !pie,
    showPercent: pie && c.dataLabels !== false,
    catAxisLabelFontSize: textPt,
    valAxisLabelFontSize: textPt,
    dataLabelFontSize: textPt
  };
  if (kind === 'column' || kind === 'bar') {
    opts.barDir = kind === 'bar' ? 'bar' : 'col';
    opts.barGrouping = c.grouping || 'clustered';
  } else if (kind === 'area' && c.grouping && c.grouping !== 'clustered') {
    opts.barGrouping = c.grouping;
  }
  if (c.numberFormat === 'percent') opts.valAxisLabelFormatCode = '0%';
  if (Number.isFinite(c.min)) opts.valAxisMinVal = c.min;
  if (Number.isFinite(c.max)) opts.valAxisMaxVal = c.max;
  if (hex(c.textColor)) {
    opts.catAxisLabelColor = hex(c.textColor);
    opts.valAxisLabelColor = hex(c.textColor);
    opts.legendColor = hex(c.textColor);
    opts.titleColor = hex(c.textColor);
  }
  slide.addChart(type, data, opts);
}

function pptxBackground(s) {
  const img = decodeDataUrl(s.backgroundImageUrl);
  if (img && OFFICE_IMAGE.test(img.mime) && !s.backgroundRepeat) return { data: `${img.mime};base64,${img.base64}` };
  // Gradients have no pptxgenjs equivalent: use their first colour.
  const color = hex(s.backgroundColor) || hex(s.backgroundGradient?.stops?.[0]?.color);
  return color ? { color } : null;
}

export async function exportDeckToPptx(deck) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = deck.title || 'PreSync deck';

  for (const s of sortedSlides(deck)) {
    const slide = pptx.addSlide();
    const background = pptxBackground(s);
    if (background) slide.background = background;
    if (s.notes) slide.addNotes(s.notes);

    for (const b of s.blocks || []) {
      if (b.type === 'image') {
        const img = decodeDataUrl(b.imageUrl);
        if (!img || !OFFICE_IMAGE.test(img.mime)) continue;
        // Always pass w/h so pptxgenjs never has to sniff image sizes.
        slide.addImage({ data: `${img.mime};base64,${img.base64}`, ...geometry(b, b.width) });
        continue;
      }
      if (b.type === 'shape') {
        addPptxShape(pptx, slide, b);
        continue;
      }
      if (b.type === 'table') {
        addPptxTable(slide, b);
        continue;
      }
      if (b.type === 'chart') {
        addPptxChart(pptx, slide, b);
        continue;
      }
      if (!b.text) continue;
      slide.addText(pptxTextRuns(b), {
        ...geometry(b, estimateTextHeight(b)),
        h: inch(b.height || estimateTextHeight(b)),
        align: b.textAlign || 'left',
        valign: b.verticalAlign === 'middle' ? 'middle' : b.verticalAlign === 'bottom' ? 'bottom' : 'top',
        margin: 0,
        lineSpacingMultiple: b.lineHeight || undefined,
        paraSpaceAfter: b.paragraphSpacing ? pt(b.paragraphSpacing) : undefined,
        fit: 'none'
      });
    }
  }

  return pptx.write({ outputType: 'nodebuffer' });
}

// --- PDF ----------------------------------------------------------------

// PDF uses the 14 standard fonts, so map each family to its closest one.
function pdfFont(style) {
  const family = (style.fontFamily || '').toLowerCase();
  const bold = style.fontWeight === 'bold' || Number(style.fontWeight) >= 600;
  const italic = style.fontStyle === 'italic';
  if (/courier|mono|cousine/.test(family)) {
    return `Courier${bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''}`;
  }
  const stack = family.split(',').map((f) => f.replace(/["']/g, '').trim());
  if (/times|georgia|cambria|caladea|tinos|garamond|gelasio|^serif$/.test(stack[0]) || (stack[stack.length - 1] === 'serif' && !/sans/.test(stack[0]))) {
    return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  }
  return `Helvetica${bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''}`;
}

// The standard fonts only cover Latin-1; swap anything else for '?'
// rather than letting it render as garbage.
function pdfSafeText(text) {
  return (text || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[•▪●◦]/g, '·')
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, '?');
}

const PDF_IMAGE = /^image\/(png|jpe?g)$/;

// Metric-compatible open fonts for common Office fonts. When the server
// has them installed (fonts-crosextra-carlito/caladea, fonts-liberation)
// the PDF embeds them, so text keeps its width and line breaks; otherwise
// the standard PDF fonts are used.
const FONT_FILES = {
  calibri: 'Carlito', carlito: 'Carlito',
  cambria: 'Caladea', caladea: 'Caladea',
  arial: 'LiberationSans', helvetica: 'LiberationSans', arimo: 'LiberationSans', 'liberation sans': 'LiberationSans',
  'times new roman': 'LiberationSerif', times: 'LiberationSerif', tinos: 'LiberationSerif', 'liberation serif': 'LiberationSerif',
  'courier new': 'LiberationMono', courier: 'LiberationMono', cousine: 'LiberationMono', 'liberation mono': 'LiberationMono'
};
const FONT_DIRS = (process.env.PDF_FONT_DIRS || '/usr/share/fonts:/usr/local/share/fonts').split(':');
let fontIndex = null;

function indexFonts() {
  if (fontIndex) return fontIndex;
  fontIndex = new Map();
  const walk = (dir, depth) => {
    if (depth > 4 || !existsSync(dir)) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.forEach((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.ttf$/i.test(e.name)) fontIndex.set(e.name.replace(/\.ttf$/i, '').toLowerCase(), full);
    });
  };
  FONT_DIRS.forEach((d) => walk(d, 0));
  return fontIndex;
}

// Path of an installed font file for a run's style, or null.
function embeddedFontFile(style) {
  const bold = style.fontWeight === 'bold' || Number(style.fontWeight) >= 600;
  const italic = style.fontStyle === 'italic';
  const variant = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular';
  const index = indexFonts();
  for (const name of (style.fontFamily || '').split(',').map((f) => f.replace(/["']/g, '').trim().toLowerCase())) {
    const base = FONT_FILES[name];
    if (!base) continue;
    const file = index.get(`${base}-${variant}`.toLowerCase());
    if (file) return file;
  }
  return null;
}

// Sets the run's font on the document; returns whether it is embedded
// (and so can show text beyond Latin-1).
function useFont(doc, style) {
  const file = embeddedFontFile(style);
  if (file) {
    try {
      doc.font(file);
      return true;
    } catch {
      // Fall through to a standard font.
    }
  }
  doc.font(pdfFont(style));
  return false;
}

function pdfColor(c, fallback) {
  return isHexColor(c) ? c : fallback;
}

// A linear gradient over a box, angle in CSS degrees (180 = top to bottom).
function pdfGradient(doc, gradient, x, y, w, h) {
  const a = (((gradient.angle ?? 180) - 90) * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const half = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
  const g = doc.linearGradient(cx - Math.cos(a) * half, cy - Math.sin(a) * half, cx + Math.cos(a) * half, cy + Math.sin(a) * half);
  gradient.stops.forEach((st) => {
    if (isHexColor(st.color)) g.stop(Math.max(0, Math.min(1, st.pos ?? 0)), st.color);
  });
  return g;
}

function drawPdfBackground(doc, s) {
  if (s.backgroundGradient?.stops?.length) doc.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).fill(pdfGradient(doc, s.backgroundGradient, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT));
  else doc.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).fill(pdfColor(s.backgroundColor, '#ffffff'));
  const img = decodeDataUrl(s.backgroundImageUrl);
  if (!img || !PDF_IMAGE.test(img.mime)) return;
  try {
    if (s.backgroundRepeat) {
      const tile = doc.openImage(img.buffer);
      doc.save().rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).clip();
      for (let y = 0; y < CANVAS_HEIGHT; y += tile.height) for (let x = 0; x < CANVAS_WIDTH; x += tile.width) doc.image(tile, x, y);
      doc.restore();
    } else {
      doc.image(img.buffer, 0, 0, { width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
    }
  } catch {
    // A corrupt background image leaves the colour behind it.
  }
}

// Runs `draw` with the block's rotation and flips applied about its centre.
function withTransform(doc, b, draw) {
  const rotation = b.rotation || 0;
  if (!rotation && !b.flipH && !b.flipV) return draw();
  const cx = (b.x || 0) + (b.width || 0) / 2;
  const cy = (b.y || 0) + (b.height || 0) / 2;
  doc.save();
  if (rotation) doc.rotate(rotation, { origin: [cx, cy] });
  if (b.flipH || b.flipV) doc.transform(b.flipH ? -1 : 1, 0, 0, b.flipV ? -1 : 1, b.flipH ? 2 * cx : 0, b.flipV ? 2 * cy : 0);
  draw();
  doc.restore();
  return undefined;
}

function drawPdfShape(doc, b) {
  const x = b.x || 0;
  const y = b.y || 0;
  const w = b.width || 100;
  const h = b.height || 100;
  const fill = b.fillGradient?.stops?.length ? pdfGradient(doc, b.fillGradient, x, y, w, h) : isHexColor(b.background) ? b.background : null;
  const stroke = isHexColor(b.stroke) ? b.stroke : null;
  doc.save();
  doc.fillOpacity(b.opacity ?? 1);
  if (stroke) doc.lineWidth(b.strokeWidth || 1).strokeColor(stroke);
  if (b.dash && stroke) doc.dash((b.strokeWidth || 1) * 4, { space: (b.strokeWidth || 1) * 3 });
  if (b.shape === 'line') {
    doc.moveTo(x, y).lineTo(x + w, y + h).lineWidth(Math.max(1, b.strokeWidth || 1)).stroke(stroke || '#000000');
    doc.restore();
    return;
  }
  if (b.shape === 'ellipse') doc.ellipse(x + w / 2, y + h / 2, w / 2, h / 2);
  else if (b.shape === 'roundRect') doc.roundedRect(x, y, w, h, b.radius || Math.min(w, h) * 0.17);
  else if (b.shape === 'path' && b.path) {
    // The path is in a 0–1000 box; map its points onto the shape's box.
    const X = (v) => x + (v / 1000) * w;
    const Y = (v) => y + (v / 1000) * h;
    for (const { cmd, nums } of parsePath(b.path)) {
      if (cmd === 'M') doc.moveTo(X(nums[0]), Y(nums[1]));
      else if (cmd === 'L') doc.lineTo(X(nums[0]), Y(nums[1]));
      else if (cmd === 'C') doc.bezierCurveTo(X(nums[0]), Y(nums[1]), X(nums[2]), Y(nums[3]), X(nums[4]), Y(nums[5]));
      else if (cmd === 'Q') doc.quadraticCurveTo(X(nums[0]), Y(nums[1]), X(nums[2]), Y(nums[3]));
      else if (cmd === 'A') doc.lineTo(X(nums[5]), Y(nums[6]));
      else if (cmd === 'Z') doc.closePath();
    }
  } else doc.rect(x, y, w, h);
  if (fill && stroke) doc.fillAndStroke(fill, stroke);
  else if (fill) doc.fill(fill);
  else if (stroke) doc.stroke();
  doc.restore();
}

// Draws a block's text with its per-run fonts, sizes and colours inside
// box { x, y, width, height }.
function drawPdfText(doc, b, box) {
  const lines = textLines(b);
  const lh = b.lineHeight || DEFAULT_LINE_HEIGHT;
  const sizeOf = (line) => Math.max(...(line.length ? line : [{ style: { fontSize: b.fontSize } }]).map((r) => r.style.fontSize || b.fontSize || 16));
  const textHeight = lines.reduce((sum, line) => sum + sizeOf(line) * 1.13 * lh, 0) + (lines.length - 1) * (b.paragraphSpacing || 0);
  let y = box.y;
  if (box.height && b.verticalAlign === 'middle') y += Math.max(0, (box.height - textHeight) / 2);
  if (box.height && b.verticalAlign === 'bottom') y += Math.max(0, box.height - textHeight);
  // Like PowerPoint, text may run past its box; table cells clip to theirs.
  const bottom = box.clip ? Math.min(CANVAS_HEIGHT, box.y + Math.max(box.height, textHeight)) : CANVAS_HEIGHT;
  const options = (size) => ({
    width: box.width,
    align: b.textAlign || 'left',
    lineGap: Math.max(0, size * 1.13 * lh - size * 1.16),
    lineBreak: true,
    height: Math.max(size, bottom - y)
  });
  for (const line of lines) {
    if (y >= bottom) break;
    const size = sizeOf(line);
    const runs = line.length ? line : [{ text: ' ', style: baseStyle(b) }];
    runs.forEach((run, i) => {
      const st = run.style;
      const embedded = useFont(doc, st);
      doc.fontSize(st.fontSize || 16).fillColor(pdfColor(st.fill, DEFAULT_TEXT_COLOR));
      const text = embedded ? run.text : pdfSafeText(run.text);
      const opts = { ...options(size), continued: i < runs.length - 1, underline: !!st.underline, strike: !!st.linethrough };
      if (i === 0) doc.text(text, box.x, y, opts);
      else doc.text(text, opts);
    });
    y = Math.max(doc.y, y + size * 1.13 * lh * 0.5) + (b.paragraphSpacing || 0);
  }
}

function drawPdfTable(doc, b) {
  const t = b.table;
  if (!t?.rows?.length || !t.columns?.length) return;
  const colX = [b.x || 0];
  t.columns.forEach((w, i) => colX.push(colX[i] + w));
  const rowY = [b.y || 0];
  t.rows.forEach((r, i) => rowY.push(rowY[i] + (r.height || 0)));
  t.rows.forEach((row, r) => {
    row.cells.forEach((c, ci) => {
      if (c.covered) return;
      const x0 = colX[ci];
      const x1 = colX[Math.min(t.columns.length, ci + (c.colspan || 1))];
      const y0 = rowY[r];
      const y1 = rowY[Math.min(t.rows.length, r + (c.rowspan || 1))];
      if (isHexColor(c.background)) doc.rect(x0, y0, x1 - x0, y1 - y0).fill(c.background);
      const edges = { top: [x0, y0, x1, y0], bottom: [x0, y1, x1, y1], left: [x0, y0, x0, y1], right: [x1, y0, x1, y1] };
      Object.entries(edges).forEach(([side, [ax, ay, bx, by]]) => {
        const border = c.borders?.[side];
        if (!border) return;
        doc.save().moveTo(ax, ay).lineTo(bx, by).lineWidth(Math.max(0.5, border.width || 1)).stroke(pdfColor(border.color, '#000000')).restore();
      });
      if (!c.text) return;
      const [pt0, pr, pb, pl] = c.padding || [4, 7, 4, 7];
      drawPdfText(doc, { ...c, fontSize: c.fontSize || b.fontSize || 16 }, { x: x0 + pl, y: y0 + pt0, width: Math.max(4, x1 - x0 - pl - pr), height: Math.max(0, y1 - y0 - pt0 - pb), clip: true });
    });
  });
}

// Draws a chart from the same primitives the editor uses.
function drawPdfChart(doc, b) {
  const x0 = b.x || 0;
  const y0 = b.y || 0;
  doc.save();
  doc.rect(x0, y0, b.width || 400, b.height || 260).clip();
  for (const it of chartLayout(b.chart, b.width || 400, b.height || 260)) {
    doc.save();
    if (it.type === 'rect' && it.w > 0 && it.h > 0) doc.rect(x0 + it.x, y0 + it.y, it.w, it.h).fill(pdfColor(it.fill, '#888888'));
    else if (it.type === 'line') doc.moveTo(x0 + it.x1, y0 + it.y1).lineTo(x0 + it.x2, y0 + it.y2).lineWidth(it.width || 1).stroke(pdfColor(it.stroke, '#cccccc'));
    else if (it.type === 'poly' && it.points.length) {
      it.points.forEach(([px, py], i) => (i ? doc.lineTo(x0 + px, y0 + py) : doc.moveTo(x0 + px, y0 + py)));
      if (it.closed) {
        doc.closePath().fillOpacity(it.opacity ?? 1).fill(pdfColor(it.fill, '#888888'));
      } else doc.lineWidth(it.width || 1).lineJoin('round').stroke(pdfColor(it.stroke, '#888888'));
    } else if (it.type === 'path') {
      doc.translate(x0, y0).path(it.d);
      if (it.stroke) doc.lineWidth(it.width || 1).fillAndStroke(pdfColor(it.fill, '#888888'), pdfColor(it.stroke, '#ffffff'), 'even-odd');
      else doc.fill(pdfColor(it.fill, '#888888'), 'even-odd');
    } else if (it.type === 'circle') doc.circle(x0 + it.cx, y0 + it.cy, it.r).fill(pdfColor(it.fill, '#888888'));
    else if (it.type === 'text' && it.text) {
      const style = { fontFamily: 'Calibri, Carlito, Arial', fontWeight: it.bold ? 'bold' : 'normal' };
      const embedded = useFont(doc, style);
      const text = embedded ? it.text : pdfSafeText(it.text);
      doc.fontSize(it.size).fillColor(pdfColor(it.color, DEFAULT_TEXT_COLOR));
      const w = doc.widthOfString(text);
      const tx = it.anchor === 'middle' ? it.x - w / 2 : it.anchor === 'end' ? it.x - w : it.x;
      doc.text(text, x0 + tx, y0 + it.y - it.size * 0.58, { lineBreak: false });
    }
    doc.restore();
  }
  doc.restore();
}

export function exportDeckToPdf(deck) {
  const doc = new PDFDocument({
    size: [CANVAS_WIDTH, CANVAS_HEIGHT],
    margin: 0,
    autoFirstPage: false,
    info: { Title: deck.title || 'PreSync deck', Creator: 'PreSync' }
  });

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const slides = sortedSlides(deck);
  if (slides.length === 0) doc.addPage();

  for (const s of slides) {
    doc.addPage();
    drawPdfBackground(doc, s);

    for (const b of s.blocks || []) {
      if (b.type === 'image') {
        const img = decodeDataUrl(b.imageUrl);
        // pdfkit embeds PNG and JPEG only.
        if (!img || !PDF_IMAGE.test(img.mime)) continue;
        withTransform(doc, b, () => {
          try {
            doc.image(img.buffer, b.x || 0, b.y || 0, { width: b.width || 100, height: b.height || undefined });
          } catch {
            // A corrupt image shouldn't sink the whole export.
          }
        });
        continue;
      }
      if (b.type === 'shape') {
        withTransform(doc, b, () => drawPdfShape(doc, b));
        continue;
      }
      if (b.type === 'table') {
        withTransform(doc, b, () => drawPdfTable(doc, b));
        continue;
      }
      if (b.type === 'chart') {
        withTransform(doc, b, () => drawPdfChart(doc, b));
        continue;
      }
      if (!b.text) continue;
      withTransform(doc, b, () => drawPdfText(doc, b, { x: b.x || 0, y: b.y || 0, width: b.width || 300, height: b.height || 0 }));
    }
  }

  doc.end();
  return done;
}
