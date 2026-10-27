import { createRequire } from 'module';
import path from 'path';
import { getDocument, OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fontStack } from './drawingml.js';
import { buildRichText } from './richText.js';
import { loadCanvas, toDataUrl } from './imageProcessing.js';

// Imports a PDF as slides that look like the pages and keep their text
// editable. Each page is drawn twice with PDF.js: once as it is, and
// once with its text left out. The text-free drawing (pictures, shapes,
// backgrounds, tables' lines) becomes the slide's background picture,
// and the text is laid over it as editable text boxes in the place,
// size, weight, style and colour it had on the page. The colour comes
// from comparing the two drawings, which also tells us which text is
// actually visible (scanned pages often carry an invisible OCR layer).
//
// Pages without visible text (scans) keep the full drawing as their
// background, so nothing is lost. Without the optional canvas module the
// importer falls back to text only, and says so.

// Outlines for the 14 standard PDF fonts (Helvetica, Times…), which
// PDFs may use without embedding them.
const STANDARD_FONTS = `${path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`;

// The editor canvas is 960×540 (16:9). Pages are fitted inside it,
// keeping their aspect ratio, and centred.
const TARGET_WIDTH = 960;
const TARGET_HEIGHT = 540;
const RENDER_SCALE = 2; // background pictures at twice the canvas size
const LETTERBOX = '#e9ebe8'; // around pages that aren't 16:9
// Background pictures are stored inline, so the whole deck stays well
// under Mongo's 16MB document limit.
const MAX_TOTAL_BACKGROUND_BYTES = 10 * 1024 * 1024;
const MAX_PAGE_BACKGROUND_BYTES = 700 * 1024;
// Fabric draws a line's baseline at 0.879 × its font size below the
// line's top (1.13 line box, 0.222 descent), so text boxes start there.
const BASELINE = 0.879;
const FABRIC_LINE = 1.13;

// --- rendering ------------------------------------------------------------

// A drawing context that skips text: glyphs reach the canvas as
// fill/stroke of a Path2D (or fillText when fonts are loaded); vector
// shapes use fill()/stroke() on the current path.
function textlessContext(ctx) {
  return new Proxy(ctx, {
    get(target, key) {
      if (key === 'fillText' || key === 'strokeText') return () => {};
      if (key === 'fill' || key === 'stroke') {
        return (...args) => (args[0] && typeof args[0] === 'object' ? undefined : target[key](...args));
      }
      const v = target[key];
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    }
  });
}

async function renderPage(mod, page, viewport, { withText }) {
  const canvas = mod.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  // PDF pages are paper: white unless the page paints something else.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: withText ? ctx : textlessContext(ctx), viewport, background: 'rgba(0,0,0,0)' }).promise;
  return canvas;
}

// Encodes a slide-sized background (page centred on the letterbox) as a
// JPEG no larger than `budget` bytes, trading resolution then quality.
function encodeBackground(mod, pageCanvas, box, budget) {
  for (const [scale, quality] of [[1, 82], [1, 70], [0.75, 70], [0.5, 65], [0.5, 50]]) {
    const w = Math.round(TARGET_WIDTH * RENDER_SCALE * scale);
    const h = Math.round(TARGET_HEIGHT * RENDER_SCALE * scale);
    const canvas = mod.createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = LETTERBOX;
    ctx.fillRect(0, 0, w, h);
    const k = RENDER_SCALE * scale;
    ctx.drawImage(pageCanvas, box.x * k, box.y * k, box.width * k, box.height * k);
    const buf = canvas.toBuffer('image/jpeg', quality);
    if (buf.length <= budget) return buf;
  }
  return null;
}

// --- text ---------------------------------------------------------------

// "ABCDEF+Calibri-BoldItalic" -> { family: 'Calibri', bold, italic }.
export function parsePdfFontName(name = '', flags = {}) {
  const clean = name.replace(/^[A-Z]{6}\+/, '');
  const [familyPart, stylePart = ''] = clean.split(/[-,]/);
  const family = familyPart.replace(/(PSMT|PS|MT)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  const styleText = `${stylePart} ${clean}`;
  return {
    family: family || null,
    bold: !!flags.bold || !!flags.black || /bold|black|heavy|semibold|demi/i.test(styleText),
    italic: !!flags.italic || /italic|oblique/i.test(styleText)
  };
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Samples the text colour of an item from the two drawings: pixels that
// change when text is drawn are text. Returns null when nothing changed
// (invisible text).
function sampleColor(full, bare, width, box) {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.w));
  const y1 = Math.min(full.length / 4 / width, Math.ceil(box.y + box.h));
  let r = 0;
  let g = 0;
  let b = 0;
  let wsum = 0;
  let hits = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const d = Math.abs(full[i] - bare[i]) + Math.abs(full[i + 1] - bare[i + 1]) + Math.abs(full[i + 2] - bare[i + 2]);
      if (d < 30) continue;
      hits += 1;
      // Weight by how strongly the pixel changed, so anti-aliased edges
      // (half text, half background) count less than glyph centres.
      const w = d * d;
      r += full[i] * w;
      g += full[i + 1] * w;
      b += full[i + 2] * w;
      wsum += w;
    }
  }
  if (hits < 3) return null;
  const hex = (v) => Math.round(v / wsum).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// True when every piece of text on the page is drawn invisibly (render
// mode 3/7): the OCR layer of a scanned page.
async function onlyInvisibleText(page) {
  const ops = await page.getOperatorList();
  let mode = 0;
  let shown = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.setTextRenderingMode) mode = ops.argsArray[i][0];
    else if (fn === OPS.showText || fn === OPS.showSpacedText) {
      if (mode !== 3 && mode !== 7) return false;
      shown += 1;
    }
  }
  return shown > 0;
}

// Text items -> positioned, styled pieces on the editor canvas.
function pieces(textContent, page, pageBox, fit, pixels) {
  const out = [];
  for (const item of textContent.items) {
    if (!item.str || !item.str.trim()) continue;
    // Item transform in canvas space (y down), at the fitted scale.
    const tx = Util.transform([fit, 0, 0, -fit, pageBox.x, pageBox.y + pageBox.height], item.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (size < 1) continue;
    const angle = (Math.atan2(tx[1], tx[0]) * 180) / Math.PI;
    const width = item.width * fit;
    const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : null;
    const style = textContent.styles[item.fontName] || {};
    const parsed = parsePdfFontName(font?.name || '', font || {});
    const family = parsed.family ? fontStack(parsed.family) : fontStack(style.fontFamily === 'serif' ? 'Times New Roman' : 'Arial');
    const ascent = style.ascent || 0.8;
    const piece = {
      text: item.str,
      x: tx[4],
      baseline: tx[5],
      size,
      width,
      angle: Math.abs(angle) < 1 ? 0 : Math.round(angle * 10) / 10,
      style: {
        fontFamily: family,
        fontSize: Math.round(size * 10) / 10,
        fontWeight: parsed.bold ? 'bold' : 'normal',
        fontStyle: parsed.italic ? 'italic' : 'normal'
      }
    };
    if (pixels) {
      const k = RENDER_SCALE;
      const top = piece.baseline - ascent * size;
      const box =
        piece.angle === 0
          ? { x: (piece.x - pageBox.x) * k, y: (top - pageBox.y) * k, w: width * k, h: size * 1.15 * k }
          : null;
      // Colour as drawn; text whose drawing we can't tell apart from
      // what's behind it falls back to black.
      piece.style.fill = (box && sampleColor(pixels.full, pixels.bare, pixels.width, box)) || '#000000';
    }
    out.push(piece);
  }
  return out;
}

const NBSP = '\u00a0';
const MARKER = /^(?:[•▪▫‣◦●○■□◆❖➢➤✓–\-*]|\(?(?:\d{1,3}|[a-zA-Z]|[ivxlcdm]{1,6})[.)])$/i;
const MARKER_LEAD = /^((?:[•▪▫‣◦●○■□◆❖➢➤✓–\-*]|\(?(?:\d{1,3}|[a-zA-Z]|[ivxlcdm]{1,6})[.)]))( +)/i;

// Pieces on one baseline, close enough together, form a line; a wide
// gap (a column gutter or table cell) starts a new line.
function groupLines(items) {
  const sorted = [...items].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const lines = [];
  for (const p of sorted) {
    const line = lines.find(
      (l) =>
        l.angle === p.angle &&
        Math.abs(l.baseline - p.baseline) < Math.min(l.size, p.size) * 0.35 &&
        p.x - l.right < Math.max(l.size, p.size) * 1.2 &&
        p.x - l.right > -Math.max(l.size, p.size) * 0.5
    );
    if (line) {
      const gap = p.x - line.right;
      const last = line.runs[line.runs.length - 1];
      if (line.runs.length === 1 && MARKER.test(last.text.trim()) && gap > 0) {
        // A list marker drawn on its own: keep the gap up to the text
        // as non-breaking space, which the editor treats as a list item.
        last.text = last.text.trim();
        line.runs.push({ text: NBSP.repeat(Math.max(1, Math.round(gap / (p.size * 0.25)))), style: last.style });
      } else if (gap > p.size * 0.15 && !/\s$/.test(last.text) && !/^\s/.test(p.text)) {
        line.runs.push({ text: ' ', style: last.style });
      }
      line.runs.push({ text: p.text, style: p.style });
      line.right = Math.max(line.right, p.x + p.width);
      line.size = Math.max(line.size, p.size);
    } else {
      lines.push({
        angle: p.angle,
        baseline: p.baseline,
        x: p.x,
        right: p.x + p.width,
        size: p.size,
        runs: [{ text: p.text, style: p.style }]
      });
    }
  }
  return lines.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
}

// Consecutive lines that line up (left edges or centres) and sit at a
// steady line spacing become one text block.
function groupBlocks(lines) {
  const blocks = [];
  for (const line of lines) {
    const center = (line.x + line.right) / 2;
    const block = line.angle
      ? null
      : blocks.find((b) => {
        if (b.angle || b.closed) return false;
        const last = b.lines[b.lines.length - 1];
        const gap = line.baseline - last.baseline;
        const size = Math.max(last.size, line.size);
        if (Math.abs(line.size - last.size) > size * 0.25) return false;
        if (gap < size * 0.8 || gap > size * 2.1) return false;
        if (b.gap && Math.abs(gap - b.gap) > size * 0.35) return false;
        const lastCenter = (last.x + last.right) / 2;
        if (Math.abs(line.x - last.x) < size * 0.8 || Math.abs(center - lastCenter) < size * 0.8) return true;
        // Indented lines under a list item, or back out to its marker.
        const left = Math.min(...b.lines.map((l) => l.x));
        const listy = b.lines.some((l) => MARKER_LEAD.test(lineText(l)) || /^[^\s]+\u00a0/.test(lineText(l)));
        return listy && line.x >= left - size * 0.3 && line.x - left < size * 4;
      });
    if (block) {
      block.gap = block.gap || line.baseline - block.lines[block.lines.length - 1].baseline;
      block.lines.push(line);
    } else {
      blocks.push({ angle: line.angle, lines: [line], gap: null });
    }
    // A block is finished once text has moved well below it.
    for (const b of blocks) {
      const last = b.lines[b.lines.length - 1];
      if (line.baseline - last.baseline > last.size * 2.5) b.closed = true;
    }
  }
  return blocks;
}

function lineText(line) {
  return line.runs.map((r) => r.text).join('');
}

function blockFromLines(b, id) {
  const lines = b.lines;
  const blockLeft = Math.min(...lines.map((l) => l.x));
  const sizes = lines.map((l) => l.size);
  const size = median(sizes);
  const left = Math.min(...lines.map((l) => l.x));
  const right = Math.max(...lines.map((l) => l.right));
  const lefts = lines.map((l) => l.x);
  const rights = lines.map((l) => l.right);
  const centers = lines.map((l) => (l.x + l.right) / 2);
  const spread = (v) => Math.max(...v) - Math.min(...v);
  let textAlign = 'left';
  if (lines.length > 1 && spread(lefts) > size * 0.5) {
    if (spread(centers) < size * 0.5) textAlign = 'center';
    else if (spread(rights) < size * 0.5) textAlign = 'right';
  }
  // Indents become leading non-breaking spaces, and a marker followed by
  // ordinary spaces is joined to its text the same way, so lists keep
  // their shape in the editor.
  const paragraphs = lines.map((l) => {
    const runs = l.runs.map((r) => ({ ...r }));
    const m = MARKER_LEAD.exec(runs[0].text);
    if (m) runs[0].text = m[1] + NBSP.repeat(m[2].length) + runs[0].text.slice(m[0].length);
    const indent = textAlign === 'left' ? l.x - blockLeft : 0;
    if (indent > l.size * 0.2) runs.unshift({ text: NBSP.repeat(Math.round(indent / (l.size * 0.25))), style: runs[0].style });
    return { runs };
  });
  const rich = buildRichText(paragraphs);
  const gaps = lines.slice(1).map((l, i) => l.baseline - lines[i].baseline);
  const lineHeight = gaps.length ? median(gaps) / (size * FABRIC_LINE) : 1;
  // Web fonts rarely match the PDF's metrics exactly: leave room so a
  // line never wraps where the page didn't.
  const width = right - left;
  const slack = Math.min(width * 0.12 + size, 80);
  let x = left;
  if (textAlign === 'center') x -= slack / 2;
  if (textAlign === 'right') x -= slack;
  const firstSize = lines[0].size;
  const block = {
    id,
    type: 'textbox',
    x: Math.round(x * 10) / 10,
    y: Math.round((lines[0].baseline - BASELINE * firstSize) * 10) / 10,
    width: Math.round(Math.max(20, width + slack) * 10) / 10,
    ...rich.base,
    fontSize: rich.base.fontSize || Math.round(size * 10) / 10,
    text: rich.text,
    lineHeight: Math.round(Math.min(4, Math.max(0.5, lineHeight)) * 1000) / 1000
  };
  if (rich.styles) block.styles = rich.styles;
  if (textAlign !== 'left') block.textAlign = textAlign;
  if (b.angle) {
    // Rotated text turns about its own start; the editor turns blocks
    // about their centre, so place the centre where that start lands.
    const w = block.width;
    const h = firstSize * FABRIC_LINE;
    const a = (b.angle * Math.PI) / 180;
    const vx = -w / 2;
    const vy = BASELINE * firstSize - h / 2;
    const cx = lines[0].x - (vx * Math.cos(a) - vy * Math.sin(a));
    const cy = lines[0].baseline - (vx * Math.sin(a) + vy * Math.cos(a));
    block.x = Math.round((cx - w / 2) * 10) / 10;
    block.y = Math.round((cy - h / 2) * 10) / 10;
    block.rotation = ((b.angle % 360) + 360) % 360;
  }
  return block;
}

// The slide's title: the largest text in the top part of the page.
function markTitle(blocks) {
  const candidates = blocks.filter((b) => b.y < TARGET_HEIGHT * 0.5 && !b.rotation && b.text.trim().length <= 120);
  if (!candidates.length) return;
  const sizeOf = (b) => Math.max(b.fontSize, ...(b.styles || []).map((s) => s.style.fontSize || 0));
  const best = [...candidates].sort((a, b) => sizeOf(b) - sizeOf(a) || a.y - b.y)[0];
  const others = blocks.filter((b) => b !== best).map(sizeOf);
  if (!others.length || sizeOf(best) >= median(others) * 1.15) best.role = 'title';
}

// Main entry point: given a PDF as a Buffer, returns slides in the shape
// the editor and Deck model expect. `report` (optional) receives notes
// on what was approximated.
export async function extractSlidesFromPdf(buffer, report = null) {
  const pdfDocument = await getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: STANDARD_FONTS,
    verbosity: 0
  }).promise;
  const mod = await loadCanvas();
  const slides = [];
  const notes = { scanned: [], textOnly: !mod, noBackground: [] };
  let backgroundBytes = 0;

  try {
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const base = page.getViewport({ scale: 1 });
      const fit = Math.min(TARGET_WIDTH / base.width, TARGET_HEIGHT / base.height);
      const pageBox = {
        x: (TARGET_WIDTH - base.width * fit) / 2,
        y: (TARGET_HEIGHT - base.height * fit) / 2,
        width: base.width * fit,
        height: base.height * fit
      };

      let full = null;
      let bare = null;
      let pixels = null;
      if (mod) {
        const viewport = page.getViewport({ scale: fit * RENDER_SCALE });
        full = await renderPage(mod, page, viewport, { withText: true });
        bare = await renderPage(mod, page, viewport, { withText: false });
        pixels = {
          width: full.width,
          full: full.getContext('2d').getImageData(0, 0, full.width, full.height).data,
          bare: bare.getContext('2d').getImageData(0, 0, bare.width, bare.height).data
        };
      }
      const textContent = await page.getTextContent();
      const ocrOnly = await onlyInvisibleText(page); // also loads fonts into commonObjs
      const items = ocrOnly ? [] : pieces(textContent, page, pageBox, fit, pixels);
      const blocks = groupBlocks(groupLines(items)).map((b, i) => blockFromLines(b, `p${pageNum}-b${i}`));
      markTitle(blocks);

      const slide = { id: `slide-${pageNum}`, order: pageNum - 1, blocks, notes: '', needsImageFallback: false };
      if (mod) {
        // Scanned pages (no visible text) keep everything in the picture.
        const source = blocks.length ? bare : full;
        if (!blocks.length) notes.scanned.push(pageNum);
        const remaining = pdfDocument.numPages - pageNum + 1;
        const budget = Math.min(MAX_PAGE_BACKGROUND_BYTES, (MAX_TOTAL_BACKGROUND_BYTES - backgroundBytes) / remaining);
        const jpeg = budget > 20 * 1024 ? encodeBackground(mod, source, pageBox, budget) : null;
        if (jpeg) {
          backgroundBytes += jpeg.length;
          slide.backgroundImageUrl = toDataUrl(jpeg, 'image/jpeg');
        } else {
          notes.noBackground.push(pageNum);
          slide.needsImageFallback = blocks.length === 0;
        }
      } else {
        slide.needsImageFallback = blocks.length === 0;
      }
      slides.push(slide);
      page.cleanup();
    }
  } finally {
    await pdfDocument.destroy();
  }

  if (report) {
    const warnings = [];
    if (notes.textOnly) warnings.push('PDF pages were imported as text only: page pictures could not be drawn on this server.');
    else {
      warnings.push('Pictures, shapes and backgrounds on each PDF page are kept as the slide background; the text on top is editable.');
      if (notes.scanned.length) {
        warnings.push(`${notes.scanned.length === 1 ? 'Page' : 'Pages'} ${notes.scanned.join(', ')} had no selectable text (likely scanned), so ${notes.scanned.length === 1 ? 'it is' : 'they are'} imported as a picture.`);
      }
      if (notes.noBackground.length) {
        warnings.push(`${notes.noBackground.length === 1 ? 'Page' : 'Pages'} ${notes.noBackground.join(', ')} lost their background picture to stay within the size limit.`);
      }
    }
    report.warnings = warnings;
  }
  return slides;
}
