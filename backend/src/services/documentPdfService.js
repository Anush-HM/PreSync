import { existsSync, readdirSync } from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { processImage } from './imageProcessing.js';
import { borderOnPage, cleanLayout, fillTokens, zoneTexts } from './documentContent.js';

// Lays a document from the document editor out as a PDF. Text is set
// word by word, so mixed sizes share a baseline, justified lines fill the
// column, and run backgrounds and badges can be drawn behind the text.
// All layout is in points; the stored page is in px at 96 dpi.

const PX_PT = 0.75;
const DEFAULT_SIZE = 11;
const DEFAULT_LINE = 1.15;
const LIST_INDENT = 18;
const CELL_PAD = 5;
const CALLOUT_PAD = 10;
const PARA_GAP = 6;

const STYLES = {
  title: { size: 26, bold: true, color: '#171a19', before: 0, after: 12 },
  subtitle: { size: 14, color: '#5b625d', before: 0, after: 8 },
  caption: { size: 9, italic: true, color: '#5b625d', before: 0, after: 6 },
  h1: { size: 20, bold: true, color: '#1d4532', before: 16, after: 6 },
  h2: { size: 16, bold: true, color: '#285c43', before: 14, after: 5 },
  h3: { size: 13, bold: true, color: '#347653', before: 12, after: 4 },
  h4: { size: 12, bold: true, before: 10, after: 4 },
  h5: { size: 11, bold: true, before: 10, after: 3 },
  h6: { size: 11, bold: true, italic: true, before: 10, after: 3 }
};
const TONES = {
  info: { fill: '#e3eef8', edge: '#2f6f9f', text: '#16324f' },
  success: { fill: '#e3f2e8', edge: '#347653', text: '#1d4532' },
  warning: { fill: '#fbf0da', edge: '#c89b3c', text: '#6b4e12' },
  danger: { fill: '#f9e3e6', edge: '#ac3045', text: '#5e1823' }
};
const POLYGONS = {
  triangle: [[50, 0], [100, 100], [0, 100]],
  diamond: [[50, 0], [100, 50], [50, 100], [0, 50]],
  hexagon: [[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]],
  star5: [[50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35]],
  rightArrow: [[0, 25], [60, 25], [60, 0], [100, 50], [60, 100], [60, 75], [0, 75]]
};

// --- fonts ----------------------------------------------------------------------

// Installed files for a family: the Windows originals, else open
// metric-compatible stand-ins. Variants are regular, bold, italic, both.
const windows = (...names) => names;
const open = (base) => ['Regular', 'Bold', 'Italic', 'BoldItalic'].map((v) => `${base}-${v}`);
const FONT_FILES = {
  arial: [windows('arial', 'arialbd', 'ariali', 'arialbi'), open('LiberationSans')],
  helvetica: [windows('arial', 'arialbd', 'ariali', 'arialbi'), open('LiberationSans')],
  calibri: [windows('calibri', 'calibrib', 'calibrii', 'calibriz'), open('Carlito')],
  cambria: [open('Caladea')],
  georgia: [windows('georgia', 'georgiab', 'georgiai', 'georgiaz'), open('Gelasio')],
  'times new roman': [windows('times', 'timesbd', 'timesi', 'timesbi'), open('LiberationSerif')],
  'courier new': [windows('cour', 'courbd', 'couri', 'courbi'), open('LiberationMono')],
  verdana: [windows('verdana', 'verdanab', 'verdanai', 'verdanaz')],
  'trebuchet ms': [windows('trebuc', 'trebucbd', 'trebucit', 'trebucbi')]
};
const FONT_DIRS = [
  ...(process.env.PDF_FONT_DIRS || '').split(path.delimiter).filter(Boolean),
  '/usr/share/fonts', '/usr/local/share/fonts', 'C:\\Windows\\Fonts', '/Library/Fonts', '/System/Library/Fonts/Supplemental'
];
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
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.ttf$/i.test(e.name)) fontIndex.set(e.name.replace(/\.ttf$/i, '').toLowerCase(), full);
    }
  };
  FONT_DIRS.forEach((d) => walk(d, 0));
  return fontIndex;
}

function fontFileFor(family, variant) {
  const index = indexFonts();
  // Unknown families (web fonts) use Arial's metrics, for its wide coverage.
  const names = [...String(family || '').split(',').map((f) => f.replace(/["']/g, '').trim().toLowerCase()), 'arial'];
  for (const name of names) {
    for (const set of FONT_FILES[name] || []) {
      const file = index.get(set[variant].toLowerCase());
      if (file) return file;
    }
  }
  return null;
}

function standardFont(family, bold, italic) {
  const serif = /times|georgia|cambria|garamond|serif/i.test(family || '') && !/sans/i.test(family || '');
  const mono = /courier|mono|code/i.test(family || '');
  if (mono) return `Courier${bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''}`;
  if (serif) return `Times-${bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Roman'}`;
  return `Helvetica${bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''}`;
}

// --- text -----------------------------------------------------------------------

function runStyle(node, base) {
  const has = (t) => (node.marks || []).find((m) => m.type === t);
  const ts = has('textStyle')?.attrs || {};
  const badge = has('badge');
  const size = parseFloat(ts.fontSize);
  return {
    size: Number.isFinite(size) ? (/px$/.test(ts.fontSize) ? size * PX_PT : size) : base.size,
    bold: !!(base.bold || has('bold') || badge),
    italic: !!(base.italic || has('italic')),
    underline: !!has('underline'),
    strike: !!has('strike'),
    color: (badge && TONES[badge.attrs?.tone]?.text) || ts.color || base.color || '#171a19',
    background: (badge && TONES[badge.attrs?.tone]?.fill) || ts.backgroundColor || null,
    family: ts.fontFamily || base.family || null
  };
}

const safeColor = (c, fallback) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback);

export function exportDocumentToPdf(document) {
  const page = document.page;
  const margins = {
    top: page.margins.top * PX_PT, right: page.margins.right * PX_PT,
    bottom: page.margins.bottom * PX_PT, left: page.margins.left * PX_PT
  };
  const doc = new PDFDocument({
    size: [page.width * PX_PT, page.height * PX_PT],
    margins,
    bufferPages: true, // headers and footers need the final page count
    info: { Title: document.title || 'Document', Creator: 'PreSync' }
  });
  const layout = cleanLayout(document.layout);
  const top = margins.top;
  const bottom = page.height * PX_PT - margins.bottom;
  const contentWidth = (page.width - page.margins.left - page.margins.right) * PX_PT;

  let y = top;
  let dry = 0; // >0 while measuring: y advances, nothing is drawn
  let pinned = 0; // >0 inside a table cell or callout: no page breaks

  function setFont(style) {
    const variant = (style.bold ? 1 : 0) + (style.italic ? 2 : 0);
    const file = fontFileFor(style.family, variant);
    try {
      doc.font(file || standardFont(style.family, style.bold, style.italic));
    } catch {
      doc.font(standardFont(style.family, style.bold, style.italic));
    }
    doc.fontSize(style.size);
  }

  function newPage() {
    doc.addPage();
    y = top;
  }

  function ensure(height) {
    if (!dry && !pinned && y + height > bottom && y > top) newPage();
  }

  // Words of a paragraph, each sized. `space` is the width of the space
  // that precedes the word on a line.
  function tokens(inline, base) {
    const out = [];
    let pendingBreak = false;
    let spaceBefore = 0;
    for (const node of inline) {
      if (node.type === 'hardBreak') {
        pendingBreak = true;
        continue;
      }
      if (node.type !== 'text') continue;
      const style = runStyle(node, base);
      setFont(style);
      const spaceWidth = doc.widthOfString(' ');
      for (const part of node.text.replace(/\t/g, '    ').split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          spaceBefore = spaceWidth * part.length;
          continue;
        }
        out.push({ text: part, style, width: doc.widthOfString(part), space: spaceBefore, lineBreak: pendingBreak });
        pendingBreak = false;
        spaceBefore = 0;
      }
    }
    if (pendingBreak) out.push({ text: '', style: base, width: 0, space: 0, lineBreak: true });
    return out;
  }

  // A word wider than the column is cut to fit.
  function splitLong(word, width) {
    if (word.width <= width) return [word];
    setFont(word.style);
    const out = [];
    let rest = word.text;
    while (rest) {
      let n = rest.length;
      while (n > 1 && doc.widthOfString(rest.slice(0, n)) > width) n -= 1;
      const text = rest.slice(0, n);
      out.push({ ...word, text, width: doc.widthOfString(text), space: out.length ? 0 : word.space, lineBreak: out.length ? false : word.lineBreak });
      rest = rest.slice(n);
    }
    return out;
  }

  function wrap(words, width) {
    const lines = [];
    let line = { words: [], width: 0, forced: false };
    for (const word of words.flatMap((w) => splitLong(w, width))) {
      const gap = line.words.length ? word.space : 0;
      if (word.lineBreak && line.words.length) {
        line.forced = true;
        lines.push(line);
        line = { words: [], width: 0, forced: false };
      } else if (line.words.length && line.width + gap + word.width > width) {
        lines.push(line);
        line = { words: [], width: 0, forced: false };
      }
      const used = line.words.length ? word.space : 0;
      if (word.text) line.words.push({ ...word, space: used });
      line.width += used + word.width;
    }
    if (line.words.length || !lines.length) {
      line.forced = true;
      lines.push(line);
    }
    return lines;
  }

  function drawLine(line, x, width, baseline, height, align) {
    const extra = align === 'justify' && !line.forced && line.words.length > 1 ? (width - line.width) / (line.words.length - 1) : 0;
    let cx = x + (align === 'center' ? (width - line.width) / 2 : align === 'right' ? width - line.width : 0);
    line.words.forEach((word, i) => {
      if (i > 0) cx += word.space + extra;
      const s = word.style;
      setFont(s);
      if (s.background) {
        const gap = i > 0 ? word.space + extra : 0;
        doc.save().rect(cx - gap, baseline - s.size, word.width + gap, height).fill(safeColor(s.background, '#ffffff')).restore();
      }
      doc.fillColor(safeColor(s.color, '#171a19'));
      doc.text(word.text, cx, baseline, { lineBreak: false, baseline: 'alphabetic', underline: s.underline, strike: s.strike });
      cx += word.width;
    });
  }

  function paragraphBlock(node, ctx, base) {
    const lineHeight = node.attrs?.lineHeight || ctx.lineHeight || DEFAULT_LINE;
    const style = { size: base.size, bold: base.bold, italic: base.italic || ctx.italic, color: base.color || ctx.color, family: ctx.family };
    y += dry || y > top ? base.before || 0 : 0;
    const lines = wrap(tokens(node.content || [], style), ctx.width);
    lines.forEach((line, i) => {
      const size = Math.max(style.size, ...line.words.map((w) => w.style.size));
      const height = size * lineHeight; // as CSS does, so pages match the editor
      ensure(height);
      const baseline = y + size;
      if (!dry) {
        if (i === 0 && ctx.marker) {
          setFont({ ...style, bold: false, italic: false });
          doc.fillColor(safeColor(style.color, '#171a19'));
          doc.text(ctx.marker, ctx.x - LIST_INDENT, baseline, { lineBreak: false, baseline: 'alphabetic', width: LIST_INDENT });
        }
        drawLine(line, ctx.x, ctx.width, baseline, height, node.attrs?.textAlign);
      }
      y += height;
    });
    y += base.after ?? PARA_GAP;
  }

  function listNumber(n, style) {
    if (style === 'lower-alpha' || style === 'upper-alpha') {
      let out = '';
      for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) out = String.fromCharCode(97 + ((v - 1) % 26)) + out;
      return style === 'upper-alpha' ? out.toUpperCase() : out;
    }
    if (style === 'lower-roman') {
      const table = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
      let v = n;
      let out = '';
      for (const [value, text] of table) while (v >= value) { out += text; v -= value; }
      return out || String(n);
    }
    return String(n);
  }

  function listBlock(node, ctx, level) {
    const ordered = node.type === 'orderedList';
    let n = node.attrs?.start || 1;
    const inner = { ...ctx, x: ctx.x + LIST_INDENT, width: ctx.width - LIST_INDENT };
    for (const item of node.content || []) {
      // Both markers exist in the standard PDF fonts.
      const marker = ordered ? `${listNumber(n, node.attrs?.listStyle)}.` : level % 2 ? '-' : '•';
      n += 1;
      (item.content || []).forEach((child, i) => {
        if (child.type === 'bulletList' || child.type === 'orderedList') listBlock(child, inner, level + 1);
        else block(child, { ...inner, marker: i === 0 ? marker : null });
      });
    }
  }

  function measure(fn) {
    const start = y;
    dry += 1;
    fn();
    dry -= 1;
    const height = y - start;
    y = start;
    return height;
  }

  async function pictureBytes(src) {
    const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(src || '');
    if (!m) return null;
    const data = Buffer.from(m[2], 'base64');
    if (m[1].toLowerCase() !== 'gif') return data;
    // PDFKit can't embed GIFs; convert when the canvas module is present.
    const converted = await processImage(data, 'gif', { maxBytes: 0 }).catch(() => null);
    return converted?.buffer || null;
  }

  function figureX(ctx, width, align) {
    if (align === 'center') return ctx.x + (ctx.width - width) / 2;
    if (align === 'right') return ctx.x + ctx.width - width;
    return ctx.x;
  }

  function figureSize(attrs, ctx, fallbackRatio) {
    const width = Math.min(ctx.width, (attrs.width || (ctx.width / PX_PT)) * PX_PT);
    const ratio = attrs.width > 0 && attrs.height > 0 ? attrs.height / attrs.width : fallbackRatio;
    return { width, height: width * ratio };
  }

  function imageBlock(node, ctx) {
    const a = node.attrs || {};
    const { width, height } = figureSize(a, ctx, 0.5625);
    // A free picture takes no room in the text: drawn at its offset from
    // where it is anchored.
    if (a.wrap === 'front') {
      if (!dry) {
        const bytes = pictures.get(a.src);
        try {
          if (bytes) doc.image(bytes, ctx.x + (a.offsetX || 0) * PX_PT, y + (a.offsetY || 0) * PX_PT, { width, height });
        } catch {
          // Damaged picture: leave it out rather than fail the export.
        }
      }
      return;
    }
    const room = bottom - top;
    const fit = !pinned && height > room ? room / height : 1;
    ensure(height * fit);
    if (!dry) {
      const bytes = pictures.get(a.src);
      if (bytes) {
        try {
          doc.image(bytes, figureX(ctx, width * fit, a.align), y, { width: width * fit, height: height * fit });
        } catch {
          // Damaged picture: leave its space empty rather than fail the export.
        }
      } else {
        doc.save().rect(figureX(ctx, width, a.align), y, width * fit, height * fit).lineWidth(0.5).strokeColor('#b1bab3').stroke().restore();
      }
    }
    y += height * fit + PARA_GAP;
  }

  function shapeBlock(node, ctx) {
    const a = node.attrs || {};
    const width = Math.min(ctx.width, (a.width || 160) * PX_PT);
    const height = (a.height || 100) * PX_PT;
    ensure(height);
    if (!dry) {
      const x = figureX(ctx, width, a.align);
      const color = safeColor(a.color, '#285c43');
      doc.save().fillColor(color);
      if (a.shape === 'ellipse') doc.ellipse(x + width / 2, y + height / 2, width / 2, height / 2);
      else if (a.shape === 'roundRect') doc.roundedRect(x, y, width, height, Math.min(width, height) * 0.16);
      else if (POLYGONS[a.shape]) doc.polygon(...POLYGONS[a.shape].map(([px, py]) => [x + (px / 100) * width, y + (py / 100) * height]));
      else doc.rect(x, y, width, height);
      doc.fill().restore();
    }
    y += height + PARA_GAP;
  }

  function quoteBlock(node, ctx) {
    const startPage = doc.page;
    const startY = y;
    const inner = { ...ctx, x: ctx.x + 14, width: ctx.width - 14, italic: true, color: '#3a4540' };
    blocks(node.content, inner);
    if (!dry) {
      const barTop = doc.page === startPage ? startY : top;
      doc.save().rect(ctx.x, barTop, 2.5, y - barTop - PARA_GAP).fill('#a3d4b2').restore();
    }
  }

  function calloutBlock(node, ctx) {
    const tone = TONES[node.attrs?.tone] || TONES.info;
    const inner = { ...ctx, x: ctx.x + CALLOUT_PAD + 3, width: ctx.width - CALLOUT_PAD * 2 - 3 };
    const height = measure(() => blocks(node.content, inner)) + CALLOUT_PAD * 2 - PARA_GAP;
    const fits = height <= bottom - top;
    if (fits) ensure(height);
    if (!dry) {
      doc.save().rect(ctx.x, y, ctx.width, height).fill(tone.fill).rect(ctx.x, y, 3, height).fill(tone.edge).restore();
    }
    const end = y + height;
    y += CALLOUT_PAD;
    if (fits) pinned += 1;
    blocks(node.content, inner);
    if (fits) pinned -= 1;
    y = fits ? end + PARA_GAP : y + CALLOUT_PAD;
  }

  // Columns for the table's grid, scaled to the column it sits in.
  function tableLayout(rows, width) {
    const widths = [];
    const taken = new Map(); // column -> rows it stays covered
    const placed = rows.map((row) => {
      const cells = [];
      let col = 0;
      for (const cell of row.content || []) {
        while (taken.get(col) > 0) col += 1;
        const colspan = cell.attrs?.colspan || 1;
        const rowspan = cell.attrs?.rowspan || 1;
        for (let i = 0; i < colspan; i++) {
          if (cell.attrs?.colwidth?.[i] && !widths[col + i]) widths[col + i] = cell.attrs.colwidth[i] * PX_PT;
          if (rowspan > 1) taken.set(col + i, rowspan);
        }
        cells.push({ cell, col, colspan, rowspan });
        col += colspan;
      }
      for (const [k, v] of taken) taken.set(k, v - 1);
      return cells;
    });
    const columns = Math.max(1, ...placed.flat().map((c) => c.col + c.colspan));
    const known = Array.from({ length: columns }, (_, i) => widths[i] || 0);
    const sum = known.reduce((a, b) => a + b, 0);
    const unset = known.filter((w) => !w).length;
    const filler = unset ? Math.max(24, (width - sum) / unset) : 0;
    const raw = known.map((w) => w || filler);
    const total = raw.reduce((a, b) => a + b, 0);
    const scale = width / total;
    return { placed, grid: raw.map((w) => w * scale) };
  }

  function tableBlock(node, ctx) {
    const rows = node.content || [];
    const { placed, grid } = tableLayout(rows, ctx.width);
    const left = (col) => ctx.x + grid.slice(0, col).reduce((a, b) => a + b, 0);
    const cellCtx = (c) => {
      const width = grid.slice(c.col, c.col + c.colspan).reduce((a, b) => a + b, 0);
      return { ...ctx, marker: null, x: left(c.col) + CELL_PAD, width: Math.max(10, width - CELL_PAD * 2), outer: width };
    };
    const heights = placed.map((cells) => Math.max(14, ...cells.filter((c) => c.rowspan === 1).map((c) =>
      measure(() => blocks(c.cell.content, cellCtx(c))) + CELL_PAD * 2 - PARA_GAP)));
    // A tall merged cell stretches its last row.
    placed.forEach((cells, r) => {
      for (const c of cells) {
        if (c.rowspan === 1) continue;
        const need = measure(() => blocks(c.cell.content, cellCtx(c))) + CELL_PAD * 2 - PARA_GAP;
        const last = Math.min(r + c.rowspan, heights.length) - 1;
        const have = heights.slice(r, last + 1).reduce((a, b) => a + b, 0);
        if (need > have) heights[last] += need - have;
      }
    });
    placed.forEach((cells, r) => {
      ensure(heights[r]);
      const rowTop = y;
      for (const c of cells) {
        const inner = cellCtx(c);
        const last = Math.min(r + c.rowspan, heights.length);
        const height = heights.slice(r, last).reduce((a, b) => a + b, 0);
        if (!dry) {
          const fill = safeColor(c.cell.attrs?.background, null);
          if (fill) doc.save().rect(inner.x - CELL_PAD, rowTop, inner.outer, height).fill(fill).restore();
          doc.save().rect(inner.x - CELL_PAD, rowTop, inner.outer, height).lineWidth(0.5).strokeColor('#b1bab3').stroke().restore();
        }
        y = rowTop + CELL_PAD;
        pinned += 1;
        blocks(c.cell.content, inner);
        pinned -= 1;
      }
      y = rowTop + heights[r];
    });
    y += PARA_GAP * 1.5;
  }

  function block(node, ctx) {
    switch (node.type) {
      case 'paragraph': {
        const base = STYLES[node.attrs?.blockStyle] || { size: ctx.size || DEFAULT_SIZE };
        paragraphBlock(node, ctx, base);
        break;
      }
      case 'heading':
        paragraphBlock(node, ctx, STYLES[`h${node.attrs?.level || 1}`] || STYLES.h6);
        break;
      case 'bulletList':
      case 'orderedList':
        listBlock(node, ctx, 0);
        break;
      case 'blockquote':
        quoteBlock(node, ctx);
        break;
      case 'callout':
        calloutBlock(node, ctx);
        break;
      case 'table':
        tableBlock(node, ctx);
        break;
      case 'image':
        imageBlock(node, ctx);
        break;
      case 'shape':
        shapeBlock(node, ctx);
        break;
      case 'horizontalRule':
        ensure(12);
        if (!dry) doc.save().moveTo(ctx.x, y + 5).lineTo(ctx.x + ctx.width, y + 5).lineWidth(0.75).strokeColor('#b1bab3').stroke().restore();
        y += 12;
        break;
      case 'pageBreak':
        if (!dry && !pinned && y > top) newPage();
        break;
      default:
    }
  }

  function blocks(nodes = [], ctx) {
    nodes.forEach((n) => block(n, ctx));
  }

  function borderLine(border, x1, y1, x2, y2, nx, ny) {
    const w = border.width;
    const stroke = (dx, dy, width, color, dash) => {
      doc.save().moveTo(x1 + dx, y1 + dy).lineTo(x2 + dx, y2 + dy).lineWidth(width).strokeColor(color);
      if (dash) doc.dash(dash[0], { space: dash[1] });
      doc.stroke().restore();
    };
    if (border.style === 'double') {
      stroke(0, 0, Math.max(0.4, w / 3), border.color);
      stroke(nx * w, ny * w, Math.max(0.4, w / 3), border.color);
    } else if (border.style === 'groove') {
      stroke(0, 0, w / 2, border.color);
      stroke((nx * w) / 2, (ny * w) / 2, w / 2, '#c9cec9');
    } else if (border.style === 'dashed') stroke(0, 0, w, border.color, [w * 3, w * 2]);
    else if (border.style === 'dotted') stroke(0, 0, w, border.color, [w, w]);
    else stroke(0, 0, w, border.color);
  }

  function pageBorder(border) {
    const { width, height } = doc.page;
    const i = border.inset;
    if (border.sides.top) borderLine(border, i, i, width - i, i, 0, 1);
    if (border.sides.bottom) borderLine(border, i, height - i, width - i, height - i, 0, -1);
    if (border.sides.left) borderLine(border, i, i, i, height - i, 1, 0);
    if (border.sides.right) borderLine(border, width - i, i, width - i, height - i, -1, 0);
  }

  function zone(slots, baseline, values) {
    const style = { size: 9, color: '#5b625d' };
    setFont(style);
    doc.fillColor(style.color);
    const inner = doc.page.width - margins.left - margins.right;
    for (const [side, text] of Object.entries(slots)) {
      if (!text) continue;
      const shown = fillTokens(text, values);
      const w = doc.widthOfString(shown);
      const x = margins.left + (side === 'center' ? (inner - w) / 2 : side === 'right' ? inner - w : 0);
      doc.text(shown, x, baseline, { lineBreak: false, baseline: 'alphabetic' });
    }
  }

  // Headers, footers and borders go on last, once the page count is known.
  function decoratePages() {
    const { start, count } = doc.bufferedPageRange();
    const title = document.title || 'Document';
    for (let i = 0; i < count; i++) {
      doc.switchToPage(start + i);
      const values = { page: i + 1, pages: count, title };
      if (borderOnPage(layout.pageBorder, i)) pageBorder(layout.pageBorder);
      zone(zoneTexts(layout, 'header', i), Math.min(45, margins.top - 6), values);
      zone(zoneTexts(layout, 'footer', i), doc.page.height - Math.min(36, margins.bottom - 12), values);
    }
  }

  // Pictures are decoded up front, since laying out stays synchronous.
  const pictures = new Map();
  async function collect(node) {
    if (node.type === 'image' && node.attrs?.src && !pictures.has(node.attrs.src)) pictures.set(node.attrs.src, await pictureBytes(node.attrs.src));
    for (const c of node.content || []) await collect(c);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    collect(document.content || {})
      .then(() => {
        blocks(document.content?.content, { x: margins.left, width: contentWidth });
        decoratePages();
        doc.end();
      })
      .catch(reject);
  });
}
