import { attr, child, children, find, num } from './ooxml.js';
import { fontStack } from './drawingml.js';
import { buildRichText } from './richText.js';

// Word formatting: resolves what a run or paragraph looks like from
// document defaults, paragraph and character styles (following basedOn)
// and direct formatting, and reads tables with their grid, merges,
// shading and borders. Sizes come out in CSS px at 96 dpi, the unit the
// document preview and slide blocks use.

const TWIP_PX = 96 / 1440; // 1/20 pt
const HALF_POINT_PX = 96 / 72 / 2;
const EIGHTH_POINT_PX = 96 / 72 / 8;

const HIGHLIGHT = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff'
};
const ALIGN = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' };

export const twipsToPx = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * TWIP_PX * 10) / 10);

function on(node) {
  if (!node) return null;
  const v = attr(node, 'w:val');
  return v === null || !['0', 'false', 'off', 'none'].includes(v);
}

// --- styles ------------------------------------------------------------------

export function readWordStyles(root, themeFonts = {}) {
  const byId = new Map();
  let defaultParagraph = null;
  let defaultTable = null;
  for (const s of children(root, 'w:style')) {
    const id = attr(s, 'w:styleId');
    if (!id) continue;
    byId.set(id, s);
    if (attr(s, 'w:default') === '1' && attr(s, 'w:type') === 'paragraph') defaultParagraph = id;
    if (attr(s, 'w:default') === '1' && attr(s, 'w:type') === 'table') defaultTable = id;
  }
  const defaults = find(root, 'w:docDefaults');
  return {
    byId,
    defaultParagraph,
    defaultTable,
    rPrDefault: find(defaults, 'w:rPrDefault', 'w:rPr'),
    pPrDefault: find(defaults, 'w:pPrDefault', 'w:pPr'),
    themeFonts
  };
}

// A style and the styles it is based on, nearest first.
function styleChain(styles, id) {
  const out = [];
  let cur = id;
  for (let i = 0; cur && i < 12; i++) {
    const s = styles.byId.get(cur);
    if (!s) break;
    out.push(s);
    cur = attr(child(s, 'w:basedOn'), 'w:val');
  }
  return out;
}

function firstOf(nodes, tag) {
  for (const n of nodes) {
    const c = child(n, tag);
    if (c) return c;
  }
  return null;
}

// --- runs ----------------------------------------------------------------------

// The rPr nodes that apply to a run, nearest first: direct, character
// style, paragraph style chain, table style, document defaults.
function runPropertyChain(r, para, ctx) {
  const own = child(r, 'w:rPr');
  const charStyle = attr(child(own, 'w:rStyle'), 'w:val');
  return [
    own,
    ...styleChain(ctx.styles, charStyle).map((s) => child(s, 'w:rPr')),
    ...para.styleNodes.map((s) => child(s, 'w:rPr')),
    ...(ctx.tableStyleNodes || []).map((s) => child(s, 'w:rPr')),
    ctx.styles.rPrDefault
  ].filter(Boolean);
}

export function runStyle(rPrs, ctx) {
  const style = {};
  const sz = firstOf(rPrs, 'w:sz');
  style.fontSize = Math.round((num(sz, 'w:val') || 22) * HALF_POINT_PX * 10) / 10;
  style.fontWeight = on(firstOf(rPrs, 'w:b')) ? 'bold' : 'normal';
  style.fontStyle = on(firstOf(rPrs, 'w:i')) ? 'italic' : 'normal';
  const u = firstOf(rPrs, 'w:u');
  style.underline = !!u && (attr(u, 'w:val') || 'single') !== 'none';
  style.linethrough = !!on(firstOf(rPrs, 'w:strike')) || !!on(firstOf(rPrs, 'w:dstrike'));
  const color = attr(firstOf(rPrs, 'w:color'), 'w:val');
  style.fill = color && /^[0-9a-f]{6}$/i.test(color) ? `#${color.toLowerCase()}` : '#000000';
  const fonts = firstOf(rPrs, 'w:rFonts');
  let face = attr(fonts, 'w:ascii') || attr(fonts, 'w:hAnsi');
  const theme = attr(fonts, 'w:asciiTheme') || attr(fonts, 'w:hAnsiTheme');
  if (!face && theme) face = /^major/.test(theme) ? ctx.styles.themeFonts.major : ctx.styles.themeFonts.minor;
  style.fontFamily = fontStack(face || ctx.styles.themeFonts.minor || 'Calibri');
  const extra = {};
  const hl = attr(firstOf(rPrs, 'w:highlight'), 'w:val');
  if (HIGHLIGHT[hl]) extra.highlight = HIGHLIGHT[hl];
  const shd = attr(firstOf(rPrs, 'w:shd'), 'w:fill');
  if (!extra.highlight && shd && /^[0-9a-f]{6}$/i.test(shd)) extra.highlight = `#${shd.toLowerCase()}`;
  if (on(firstOf(rPrs, 'w:caps'))) extra.caps = true;
  const va = attr(firstOf(rPrs, 'w:vertAlign'), 'w:val');
  if (va === 'superscript' || va === 'subscript') extra.vertAlign = va;
  return { style, extra };
}

// --- paragraphs ----------------------------------------------------------------

export function paragraphContext(p, ctx) {
  const pPr = child(p, 'w:pPr');
  const styleId = attr(child(pPr, 'w:pStyle'), 'w:val') || ctx.styles.defaultParagraph;
  const styleNodes = styleChain(ctx.styles, styleId);
  const pPrs = [pPr, ...styleNodes.map((s) => child(s, 'w:pPr')), ...(ctx.tableStyleNodes || []).map((s) => child(s, 'w:pPr')), ctx.styles.pPrDefault].filter(Boolean);
  return { pPr, styleId, styleNodes, pPrs };
}

// Paragraph layout: alignment, spacing and indents (px), line spacing.
export function paragraphLayout(para) {
  const { pPrs } = para;
  const out = {};
  const jc = attr(firstOf(pPrs, 'w:jc'), 'w:val');
  if (ALIGN[jc] && ALIGN[jc] !== 'left') out.align = ALIGN[jc];
  const spacing = pPrs.map((n) => child(n, 'w:spacing')).filter(Boolean);
  const sp = (name) => {
    for (const s of spacing) if (attr(s, name) !== null) return Number(attr(s, name));
    return null;
  };
  const before = sp('w:before');
  const after = sp('w:after');
  if (before) out.spaceBefore = twipsToPx(before);
  if (after) out.spaceAfter = twipsToPx(after);
  const line = sp('w:line');
  const rule = spacing.map((s) => attr(s, 'w:lineRule')).find(Boolean) || 'auto';
  if (line) {
    if (rule === 'auto') out.lineHeight = Math.round((line / 240) * 1000) / 1000;
    else out.lineHeightPx = twipsToPx(line);
  }
  const ind = pPrs.map((n) => child(n, 'w:ind')).filter(Boolean);
  const ia = (name) => {
    for (const s of ind) if (attr(s, name) !== null) return Number(attr(s, name));
    return null;
  };
  const left = ia('w:left') ?? ia('w:start');
  const right = ia('w:right') ?? ia('w:end');
  const firstLine = ia('w:firstLine');
  const hanging = ia('w:hanging');
  if (left) out.indentLeft = twipsToPx(left);
  if (right) out.indentRight = twipsToPx(right);
  if (hanging) out.indentFirst = -twipsToPx(hanging);
  else if (firstLine) out.indentFirst = twipsToPx(firstLine);
  const tabs = pPrs.flatMap((n) => children(child(n, 'w:tabs'), 'w:tab'))
    .filter((t) => attr(t, 'w:val') !== 'clear')
    .map((t) => ({ pos: twipsToPx(attr(t, 'w:pos')), type: attr(t, 'w:val') || 'left' }))
    .sort((a, b) => a.pos - b.pos);
  if (tabs.length) out.tabs = tabs;
  if (on(firstOf(pPrs, 'w:pageBreakBefore'))) out.pageBreakBefore = true;
  const shd = attr(firstOf(pPrs, 'w:shd'), 'w:fill');
  if (shd && /^[0-9a-f]{6}$/i.test(shd)) out.background = `#${shd.toLowerCase()}`;
  return out;
}

// Runs of a paragraph: [{ text, style, extra?, field? }], plus whether
// it contains a page break: `breakBefore` when the break comes ahead of
// its text, so the text starts the new page, else `pageBreak`. Word's
// note of where it last broke the page only counts at a paragraph's
// start; inside one, the paragraph simply runs across the two pages. `onNode` sees every other element (pictures,
// tracked changes…) so the caller can keep its own bookkeeping.
export function readRuns(p, para, ctx, onNode = () => {}) {
  const runs = [];
  let pageBreak = false;
  let breakBefore = false;
  const noTextYet = () => !runs.some((r) => r.text.trim());
  const markBreak = () => {
    if (noTextYet()) breakBefore = true;
    else pageBreak = true;
  };
  let field = null; // complex field being read: { instr, result }
  const push = (text, r) => {
    const { style, extra } = runStyle(runPropertyChain(r, para, ctx), ctx);
    const run = { text: extra.caps ? text.toUpperCase() : text, style };
    if (extra.highlight || extra.vertAlign) run.extra = { highlight: extra.highlight, vertAlign: extra.vertAlign };
    if (field?.result && /\bPAGE\b/.test(field.instr)) run.field = 'PAGE';
    if (field && /\bNUMPAGES\b/.test(field.instr) && field.result) run.field = 'NUMPAGES';
    runs.push(run);
  };

  function walkRun(r) {
    for (const c of children(r)) {
      switch (c.nodeName) {
        case 'w:t':
          push(c.textContent, r);
          break;
        case 'w:tab':
          push('\t', r);
          break;
        case 'w:br':
        case 'w:cr':
          if (attr(c, 'w:type') === 'page') markBreak();
          else push('\n', r);
          break;
        case 'w:lastRenderedPageBreak':
          if (noTextYet()) breakBefore = true;
          break;
        case 'w:noBreakHyphen':
          push('‑', r);
          break;
        case 'w:sym':
          push(String.fromCharCode(parseInt(attr(c, 'w:char') || '2022', 16) & 0xff || 0x2022), r);
          break;
        case 'w:fldChar': {
          const type = attr(c, 'w:fldCharType');
          if (type === 'begin') field = { instr: '', result: false };
          else if (type === 'separate' && field) field.result = true;
          else if (type === 'end') field = null;
          break;
        }
        case 'w:instrText':
          if (field) field.instr += c.textContent;
          break;
        case 'w:rPr':
        case 'w:delText':
          break;
        default:
          onNode(c);
      }
    }
  }

  function walk(node) {
    for (const c of children(node)) {
      if (c.nodeName === 'w:r') walkRun(c);
      else if (c.nodeName === 'w:fldSimple') {
        const prev = field;
        field = { instr: attr(c, 'w:instr') || '', result: true };
        walk(c);
        field = prev;
      } else if (c.nodeName === 'w:hyperlink' || c.nodeName === 'w:ins' || c.nodeName === 'w:smartTag' || c.nodeName === 'w:customXml' || c.nodeName === 'w:sdt' || c.nodeName === 'w:sdtContent') {
        if (c.nodeName === 'w:ins') onNode(c, true);
        walk(c);
      } else if (c.nodeName === 'w:pPr') continue;
      else onNode(c);
    }
  }
  walk(p);
  // Trailing whitespace adds nothing visible.
  while (runs.length && !runs[runs.length - 1].text.trim() && runs[runs.length - 1].text !== '\n') runs.pop();
  return { runs, pageBreak, breakBefore };
}

// --- tables -------------------------------------------------------------------

function borderOf(node) {
  if (!node) return undefined;
  const v = attr(node, 'w:val');
  if (!v || v === 'nil' || v === 'none') return null;
  const color = attr(node, 'w:color');
  return {
    color: color && /^[0-9a-f]{6}$/i.test(color) ? `#${color.toLowerCase()}` : '#000000',
    width: Math.max(0.75, Math.round((num(node, 'w:sz') || 4) * EIGHTH_POINT_PX * 10) / 10)
  };
}

function readBorders(node) {
  const out = {};
  if (!node) return out;
  const map = { top: 'w:top', bottom: 'w:bottom', left: ['w:left', 'w:start'], right: ['w:right', 'w:end'], insideH: 'w:insideH', insideV: 'w:insideV' };
  for (const [k, tags] of Object.entries(map)) {
    for (const tag of [].concat(tags)) {
      const b = borderOf(child(node, tag));
      if (b !== undefined) {
        out[k] = b;
        break;
      }
    }
  }
  return out;
}

const VALIGN = { top: 'top', center: 'middle', bottom: 'bottom' };

// Reads a w:tbl into the slide/preview table shape:
// { columns: [px], rows: [{ height, cells: [cell] }] } where cells are
// indexed by grid column (spanned columns hold { covered: true }), and a
// cell carries text, per-character styles, alignment, fill and borders.
// `readCellParagraphs(tc, tableCtx)` returns [{ runs, layout }] for a cell.
export function readTable(tbl, ctx, readCellParagraphs) {
  const tblPr = child(tbl, 'w:tblPr');
  const styleId = attr(child(tblPr, 'w:tblStyle'), 'w:val') || ctx.styles.defaultTable;
  const tableStyleNodes = styleChain(ctx.styles, styleId);
  const tableCtx = { ...ctx, tableStyleNodes };
  const tblBorders = {
    ...Object.assign({}, ...tableStyleNodes.slice().reverse().map((s) => readBorders(find(s, 'w:tblPr', 'w:tblBorders')))),
    ...readBorders(child(tblPr, 'w:tblBorders'))
  };
  const marNodes = [child(tblPr, 'w:tblCellMar'), ...tableStyleNodes.map((s) => find(s, 'w:tblPr', 'w:tblCellMar'))].filter(Boolean);
  const mar = (side, fallback) => {
    for (const m of marNodes) {
      const tags = side === 'left' ? ['w:left', 'w:start'] : side === 'right' ? ['w:right', 'w:end'] : [`w:${side}`];
      for (const t of tags) if (child(m, t)) return twipsToPx(num(child(m, t), 'w:w') || 0);
    }
    return fallback;
  };
  const padding = [mar('top', 0), mar('right', 7.2), mar('bottom', 0), mar('left', 7.2)];

  let columns = children(find(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => twipsToPx(num(g, 'w:w') || 0));
  const trs = children(tbl, 'w:tr');
  const rows = [];
  const vmergeOpen = new Map(); // grid column -> { row, col } of the cell that started the merge

  trs.forEach((tr, r) => {
    const trPr = child(tr, 'w:trPr');
    const height = twipsToPx(num(child(trPr, 'w:trHeight'), 'w:val') || 0) || 0;
    const cells = [];
    let col = num(child(trPr, 'w:gridBefore'), 'w:val') || 0;
    for (let i = 0; i < col; i++) cells.push({ text: '', covered: true });
    for (const tc of children(tr, 'w:tc')) {
      const tcPr = child(tc, 'w:tcPr');
      const span = num(child(tcPr, 'w:gridSpan'), 'w:val') || 1;
      const vMerge = child(tcPr, 'w:vMerge');
      const vState = vMerge ? attr(vMerge, 'w:val') || 'continue' : null;
      if (vState === 'continue' && vmergeOpen.has(col)) {
        const start = vmergeOpen.get(col);
        const startCell = rows[start.row]?.cells[start.col];
        if (startCell) startCell.rowspan = (startCell.rowspan || 1) + 1;
        for (let i = 0; i < span; i++) cells.push({ text: '', covered: true });
        col += span;
        continue;
      }
      if (vState === 'restart') vmergeOpen.set(col, { row: r, col });
      else vmergeOpen.delete(col);

      const paragraphs = readCellParagraphs(tc, tableCtx);
      const rich = buildRichText(paragraphs.map((p) => ({ runs: p.runs })));
      const own = readBorders(child(tcPr, 'w:tcBorders'));
      const lastCol = col + span >= columns.length;
      const edge = (side, outer, inside) => {
        if (own[side] !== undefined) return own[side];
        return outer ? tblBorders[side] ?? null : tblBorders[inside] ?? null;
      };
      const borders = {
        top: edge('top', r === 0, 'insideH'),
        bottom: edge('bottom', r === trs.length - 1, 'insideH'),
        left: edge('left', col === 0, 'insideV'),
        right: edge('right', lastCol, 'insideV')
      };
      const shd = attr(child(tcPr, 'w:shd'), 'w:fill');
      const cell = {
        text: rich.text,
        ...rich.base,
        fontSize: rich.base.fontSize || 14.7,
        verticalAlign: VALIGN[attr(child(tcPr, 'w:vAlign'), 'w:val')] || 'top',
        padding,
        background: shd && /^[0-9a-f]{6}$/i.test(shd) ? `#${shd.toLowerCase()}` : null,
        borders
      };
      if (rich.styles) cell.styles = rich.styles;
      const align = paragraphs.find((p) => p.layout.align)?.layout.align;
      if (align) cell.textAlign = align;
      const lh = paragraphs[0]?.layout.lineHeight;
      if (lh) cell.lineHeight = Math.round(((lh * 1.15) / 1.13) * 1000) / 1000;
      if (span > 1) cell.colspan = span;
      cells.push(cell);
      for (let i = 1; i < span; i++) cells.push({ text: '', covered: true });
      col += span;
    }
    rows.push({ height, cells });
  });

  const width = Math.max(0, ...rows.map((row) => row.cells.length));
  if (columns.length < width) columns = [...columns, ...Array(width - columns.length).fill(columns[columns.length - 1] || 96)];
  for (const row of rows) while (row.cells.length < columns.length) row.cells.push({ text: '', covered: true });
  const jc = attr(child(tblPr, 'w:jc'), 'w:val');
  return { columns, rows, ...(ALIGN[jc] && ALIGN[jc] !== 'left' ? { align: ALIGN[jc] } : {}) };
}
