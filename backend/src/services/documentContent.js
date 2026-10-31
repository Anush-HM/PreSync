import PDFDocument from 'pdfkit';
import { textLines } from './deckExportService.js';

// The stored form of a Word document: the editor's JSON tree.
//   doc > paragraph | heading | bulletList | orderedList | blockquote |
//         horizontalRule | table | image | shape | callout | pageBreak
// Text carries marks: bold, italic, underline, strike, badge and
// textStyle ({ color, backgroundColor, fontFamily, fontSize }).
// Paragraphs have blockStyle (title, subtitle, caption), and paragraphs
// and headings have textAlign and lineHeight. Everything arriving from a
// client passes through cleanContent; everything arriving from a .docx
// through blocksToContent.

export const PAGE_SIZES = {
  letter: { width: 816, height: 1056 },
  a4: { width: 794, height: 1123 }
};
export const DEFAULT_MARGIN = 96;
const MAX_DEPTH = 32;
const MAX_NODES = 200000;
const PX_TO_PT = 0.75;

export class DocumentContentError extends Error {}

const IMAGE_SRC = /^data:image\/(png|jpe?g|gif);base64,[a-z0-9+/=]+$/i;
const COLOR = /^#[0-9a-f]{3,8}$|^rgba?\([\d\s.,%]+\)$/i;
const FONT_FAMILY = /^[\w\s"',-]{1,120}$/;
const FONT_SIZE = /^\d{1,3}(\.\d+)?(pt|px)$/;

const oneOf = (...values) => (v) => values.includes(v);
const number = (min, max) => (v) => Number.isFinite(v) && v >= min && v <= max;
const nullable = (check) => (v) => v === null || check(v);
const matches = (re) => (v) => typeof v === 'string' && re.test(v);
const anything = () => true;

export const TONES = ['info', 'success', 'warning', 'danger'];
export const SHAPES = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star5', 'rightArrow'];

const BLOCK_ATTRS = {
  textAlign: nullable(oneOf('left', 'center', 'right', 'justify')),
  lineHeight: nullable(number(0.5, 5))
};
const CELL_ATTRS = {
  colspan: number(1, 200),
  rowspan: number(1, 1000),
  colwidth: nullable((v) => Array.isArray(v) && v.every((w) => w === null || number(1, 4000)(w))),
  background: nullable(matches(COLOR))
};
const FIGURE_ATTRS = { width: nullable(number(1, 4000)), height: nullable(number(1, 6000)), align: nullable(oneOf('left', 'center', 'right')) };

// Allowed attributes of each node type, with a check for each.
const NODES = {
  doc: {},
  text: {},
  paragraph: { ...BLOCK_ATTRS, blockStyle: nullable(oneOf('title', 'subtitle', 'caption')) },
  heading: { ...BLOCK_ATTRS, level: number(1, 6) },
  bulletList: {},
  orderedList: { start: number(0, 100000), type: anything },
  listItem: {},
  blockquote: {},
  horizontalRule: {},
  hardBreak: {},
  pageBreak: {},
  table: {},
  tableRow: {},
  tableCell: CELL_ATTRS,
  tableHeader: CELL_ATTRS,
  image: { ...FIGURE_ATTRS, src: matches(IMAGE_SRC), alt: nullable((v) => typeof v === 'string' && v.length <= 500), title: anything },
  shape: { ...FIGURE_ATTRS, shape: oneOf(...SHAPES), color: matches(COLOR) },
  callout: { tone: oneOf(...TONES) }
};

const MARKS = {
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  badge: { tone: oneOf(...TONES) },
  textStyle: {
    color: nullable(matches(COLOR)),
    backgroundColor: nullable(matches(COLOR)),
    fontFamily: nullable(matches(FONT_FAMILY)),
    fontSize: nullable(matches(FONT_SIZE))
  }
};

function cleanAttrs(attrs, allowed, label) {
  const out = {};
  for (const [key, value] of Object.entries(attrs || {})) {
    const check = allowed[key];
    if (check === undefined || value === undefined) continue;
    if (!check(value)) throw new DocumentContentError(`Invalid ${key} on ${label}`);
    out[key] = value;
  }
  return out;
}

// Rebuilds the tree keeping only known nodes, marks and attributes.
export function cleanContent(input) {
  if (input?.type !== 'doc' || !Array.isArray(input.content)) throw new DocumentContentError('Content must be a document');
  let nodes = 0;
  function clean(node, depth) {
    if (depth > MAX_DEPTH) throw new DocumentContentError('Content is nested too deeply');
    nodes += 1;
    if (nodes > MAX_NODES) throw new DocumentContentError('This document is too large');
    const allowed = NODES[node?.type];
    if (!allowed) throw new DocumentContentError(`Unknown content: ${String(node?.type).slice(0, 40)}`);
    const out = { type: node.type };
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || !node.text) throw new DocumentContentError('Text must not be empty');
      out.text = node.text;
    }
    const attrs = cleanAttrs(node.attrs, allowed, node.type);
    if (Object.keys(attrs).length) out.attrs = attrs;
    if (Array.isArray(node.marks) && node.marks.length) {
      out.marks = node.marks.map((m) => {
        if (!MARKS[m?.type]) throw new DocumentContentError(`Unknown formatting: ${String(m?.type).slice(0, 40)}`);
        const markAttrs = cleanAttrs(m.attrs, MARKS[m.type], m.type);
        return Object.keys(markAttrs).length ? { type: m.type, attrs: markAttrs } : { type: m.type };
      });
    }
    if (Array.isArray(node.content)) out.content = node.content.map((c) => clean(c, depth + 1));
    return out;
  }
  const cleaned = clean(input, 0);
  if (!cleaned.content?.length) cleaned.content = [{ type: 'paragraph' }];
  return cleaned;
}

export function cleanPage(input, fallback = defaultPage()) {
  const m = input?.margins || {};
  const px = (v, min, max, other) => (Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : other);
  const width = px(input?.width, 300, 2400, fallback.width);
  const height = px(input?.height, 300, 3400, fallback.height);
  const side = (k) => px(m[k], 0, 300, fallback.margins[k]);
  return { width, height, margins: { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') } };
}

export function defaultPage(size = 'letter') {
  return { ...PAGE_SIZES[size], margins: { top: DEFAULT_MARGIN, right: DEFAULT_MARGIN, bottom: DEFAULT_MARGIN, left: DEFAULT_MARGIN } };
}

export const blankContent = () => ({ type: 'doc', content: [{ type: 'paragraph' }] });

// --- page layout -----------------------------------------------------------------

// Headers and footers are three short texts (left, centre, right) that
// may hold {title}, {date}, {page} and {pages}. Keep the rules below in
// step with frontend components/documents/pageLayout.js.
const MAX_SLOT = 200;
const SIDES = ['left', 'center', 'right'];
export const BORDER_STYLES = ['solid', 'double', 'dashed', 'dotted', 'groove'];
export const BORDER_WIDTHS = [0.5, 1, 1.5, 2.25, 3, 4.5, 6];
export const MAX_BORDER_INSET = 31; // Word's limit, in points from the page edge
const NUMBER_POSITIONS = ['top-right', 'top-center', 'bottom-center', 'bottom-right'];
const SCOPES = ['all', 'first', 'exceptFirst', 'pages'];
const HEX = /^#[0-9a-f]{6}$/i;

export const defaultLayout = () => ({
  header: { left: '', center: '', right: '' },
  footer: { left: '', center: '', right: '' },
  differentFirstPage: false,
  pageNumbers: null,
  pageBorder: null
});

function cleanSlots(input) {
  return Object.fromEntries(SIDES.map((s) => [s, typeof input?.[s] === 'string' ? input[s].slice(0, MAX_SLOT) : '']));
}

export function cleanBorder(input) {
  if (!input?.sides) return null;
  const sides = Object.fromEntries(['top', 'right', 'bottom', 'left'].map((s) => [s, !!input.sides[s]]));
  if (!Object.values(sides).some(Boolean)) return null;
  const inset = Number(input.inset);
  return {
    sides,
    style: BORDER_STYLES.includes(input.style) ? input.style : 'solid',
    width: BORDER_WIDTHS.includes(input.width) ? input.width : 1,
    color: HEX.test(input.color || '') ? input.color : '#000000',
    inset: Number.isFinite(inset) ? Math.max(0, Math.min(MAX_BORDER_INSET, inset)) : 24,
    scope: SCOPES.includes(input.scope) ? input.scope : 'all',
    pages: typeof input.pages === 'string' ? input.pages.slice(0, 80) : ''
  };
}

// Always returns a complete layout; anything unusable falls back to off.
export function cleanLayout(input) {
  const numbers = input?.pageNumbers;
  return {
    header: cleanSlots(input?.header),
    footer: cleanSlots(input?.footer),
    differentFirstPage: !!input?.differentFirstPage,
    pageNumbers: numbers && NUMBER_POSITIONS.includes(numbers.position)
      ? { position: numbers.position, format: numbers.format === 'pageOf' ? 'pageOf' : 'plain', hideOnFirst: !!numbers.hideOnFirst }
      : null,
    pageBorder: cleanBorder(input?.pageBorder)
  };
}

// Page ranges typed as "1, 3-5", as a set of page numbers from 1.
export function parsePageRanges(text) {
  const pages = new Set();
  for (const part of String(text || '').split(',')) {
    const m = /^\s*(\d{1,4})\s*(?:-\s*(\d{1,4})\s*)?$/.exec(part);
    if (!m) continue;
    const from = Number(m[1]);
    const to = Math.min(Number(m[2] || m[1]), from + 2000);
    for (let n = from; n <= to; n++) pages.add(n);
  }
  return pages;
}

export function borderOnPage(border, pageIndex) {
  if (!border) return false;
  if (border.scope === 'first') return pageIndex === 0;
  if (border.scope === 'exceptFirst') return pageIndex > 0;
  if (border.scope === 'pages') return parsePageRanges(border.pages).has(pageIndex + 1);
  return true;
}

// The texts of a header or footer on one page, tokens not yet filled in.
export function zoneTexts(layout, zone, pageIndex) {
  const first = pageIndex === 0;
  const out = first && layout.differentFirstPage ? { left: '', center: '', right: '' } : { ...layout[zone] };
  const n = layout.pageNumbers;
  if (n && !(first && (n.hideOnFirst || layout.differentFirstPage))) {
    const [at, side] = n.position.split('-');
    if ((at === 'top') === (zone === 'header')) {
      const number = n.format === 'pageOf' ? 'Page {page} of {pages}' : '{page}';
      out[side] = out[side] ? `${out[side]} ${number}` : number;
    }
  }
  return out;
}

export const dateText = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function fillTokens(text, { page, pages, title }) {
  return text.replace(/\{(page|pages|title|date)\}/g, (_, t) => ({ page, pages, title, date: dateText() })[t]);
}

// A Word header or footer as the three slots: tabs separate them, and a
// paragraph without tabs goes by its alignment.
export function slotsFromWord(paragraphs = []) {
  const slots = { left: '', center: '', right: '' };
  const add = (side, text) => {
    const clean = text.trim();
    if (clean) slots[side] = (slots[side] ? `${slots[side]} ${clean}` : clean).slice(0, MAX_SLOT);
  };
  for (const paragraph of paragraphs) {
    let text = '';
    for (const run of paragraph.runs || []) {
      if (!run.field) text += run.text;
      else if (!text.endsWith(`{${run.field.toLowerCase()}}`)) text += run.field === 'PAGE' ? '{page}' : '{pages}';
    }
    const parts = text.replace(/\n/g, ' ').split('\t');
    if (parts.length === 1) add(paragraph.layout?.align === 'center' ? 'center' : paragraph.layout?.align === 'right' ? 'right' : 'left', parts[0]);
    else {
      add('left', parts[0]);
      add('center', parts[1]);
      add('right', parts.slice(2).join(' '));
    }
  }
  return slots;
}

export function countWords(node) {
  if (node.type === 'text') return node.text.trim() ? node.text.trim().split(/\s+/).length : 0;
  return (node.content || []).reduce((sum, c) => sum + countWords(c), 0);
}

// --- from parsed .docx blocks --------------------------------------------------

const roundPt = (px) => Math.round(px * PX_TO_PT * 2) / 2;

function runMarks(style = {}, extra) {
  const marks = [];
  if (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) marks.push({ type: 'bold' });
  if (style.fontStyle === 'italic') marks.push({ type: 'italic' });
  if (style.underline) marks.push({ type: 'underline' });
  if (style.linethrough) marks.push({ type: 'strike' });
  const attrs = {};
  if (style.fill && style.fill !== '#000000' && COLOR.test(style.fill)) attrs.color = style.fill;
  if (FONT_FAMILY.test(style.fontFamily || '')) attrs.fontFamily = style.fontFamily;
  if (Number.isFinite(style.fontSize)) attrs.fontSize = `${roundPt(style.fontSize)}pt`;
  if (extra?.highlight) attrs.backgroundColor = extra.highlight;
  if (Object.keys(attrs).length) marks.push({ type: 'textStyle', attrs });
  return marks;
}

// Runs as inline nodes; line breaks inside a run become hard breaks.
function inlineNodes(runs) {
  const out = [];
  for (const run of runs) {
    const marks = runMarks(run.style, run.extra);
    String(run.text).split('\n').forEach((part, i) => {
      if (i > 0) out.push({ type: 'hardBreak' });
      if (part) out.push({ type: 'text', text: part, ...(marks.length ? { marks } : {}) });
    });
  }
  return out;
}

// The editor has one tab grid, every half inch. Word's custom tab stops
// are met by choosing how many grid tabs reach them, from an estimate of
// the text's width, so columns land on the same stop line after line.
const GRID_PX = 48;
const FONT_SCALE = [[/calibri|carlito/i, 0.9], [/times|tinos|cambria|caladea/i, 0.92]];
let metrics = null;

// Helvetica's metrics, scaled towards the run's font.
function textWidth(text, style = {}) {
  metrics ||= new PDFDocument({ autoFirstPage: false }).font('Helvetica').fontSize(1);
  const scale = FONT_SCALE.find(([re]) => re.test(style.fontFamily || ''))?.[1] || 1;
  return metrics.widthOfString(text) * (style.fontSize || 14.7) * scale;
}

export function expandTabs(runs, stops) {
  if (!stops?.length) return runs;
  let x = 0;
  return runs.map((run, index) => {
    if (run.text !== '\t') {
      x += textWidth(run.text, run.style);
      return run;
    }
    const stop = stops.find((t) => t.pos > x + 1);
    if (!stop) {
      x = (Math.floor(x / GRID_PX) + 1) * GRID_PX;
      return run;
    }
    let after = 0;
    for (let i = index + 1; i < runs.length && runs[i].text !== '\t'; i++) after += textWidth(runs[i].text, runs[i].style);
    const start = stop.type === 'right' ? stop.pos - after : stop.type === 'center' ? stop.pos - after / 2 : stop.pos;
    const count = Math.max(1, Math.round(start / GRID_PX) - Math.floor(x / GRID_PX));
    x = (Math.floor(x / GRID_PX) + count) * GRID_PX;
    return { ...run, text: '\t'.repeat(count) };
  });
}

function blockAttrs(layout = {}, extra = {}) {
  const attrs = { ...extra };
  if (layout.align) attrs.textAlign = layout.align;
  if (Number.isFinite(layout.lineHeight)) attrs.lineHeight = Math.max(0.5, Math.min(5, layout.lineHeight));
  return attrs;
}

function textBlock(type, block, extra) {
  const attrs = blockAttrs(block.layout, extra);
  const content = block.runs?.length ? inlineNodes(expandTabs(block.runs, block.layout?.tabs)) : block.text ? [{ type: 'text', text: block.text }] : [];
  return { type, ...(Object.keys(attrs).length ? { attrs } : {}), ...(content.length ? { content } : {}) };
}

// Flat items with levels into nested lists. A level jump of more than
// one still nests a single step, since the tree has no empty levels.
function nestList(items) {
  const root = [];
  const open = []; // [{ level, ordered, list, siblings }]
  const newList = (item, siblings) => {
    const list = { type: item.ordered ? 'orderedList' : 'bulletList', content: [] };
    siblings.push(list);
    open.push({ level: item.level, ordered: !!item.ordered, list, siblings });
  };
  for (const item of items) {
    while (open.length && open[open.length - 1].level > item.level) open.pop();
    const top = open[open.length - 1];
    if (!top) newList(item, root);
    else if (top.level < item.level) newList(item, top.list.content[top.list.content.length - 1].content);
    else if (top.ordered !== !!item.ordered) {
      open.pop();
      newList(item, top.siblings);
    }
    open[open.length - 1].list.content.push({ type: 'listItem', content: [textBlock('paragraph', item)] });
  }
  return root;
}

function cellContent(cell) {
  const attrs = blockAttrs({ align: cell.textAlign });
  return textLines(cell).map((runs) => {
    const content = inlineNodes(runs);
    return { type: 'paragraph', ...(Object.keys(attrs).length ? { attrs } : {}), ...(content.length ? { content } : {}) };
  });
}

function tableNode(table) {
  const rows = table.rows
    .map((row) => {
      const content = [];
      row.cells.forEach((cell, col) => {
        if (cell.covered) return;
        const span = cell.colspan || 1;
        const widths = table.columns.slice(col, col + span).map((w) => Math.round(w) || null);
        content.push({
          type: 'tableCell',
          attrs: { colspan: span, rowspan: cell.rowspan || 1, colwidth: widths.some(Boolean) ? widths : null, background: cell.background || null },
          content: cellContent(cell)
        });
      });
      return { type: 'tableRow', content };
    })
    .filter((row) => row.content.length);
  return rows.length ? { type: 'table', content: rows } : null;
}

function chartNodes(chart) {
  const cats = chart.categories || [];
  const series = chart.series || [];
  const cell = (text, bold) => ({
    type: 'tableCell',
    attrs: { colspan: 1, rowspan: 1, colwidth: null, background: null },
    content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text, ...(bold ? { marks: [{ type: 'bold' }] } : {}) }] } : {}) }]
  });
  const header = { type: 'tableRow', content: [cell('', true), ...series.map((s) => cell(s.name || 'Series', true))] };
  const rows = cats.map((cat, i) => ({
    type: 'tableRow',
    content: [cell(String(cat ?? '')), ...series.map((s) => cell(Number.isFinite(s.values?.[i]) ? String(s.values[i]) : ''))]
  }));
  const caption = { type: 'paragraph', attrs: { blockStyle: 'caption' }, content: [{ type: 'text', text: `Chart${chart.title ? `: ${chart.title}` : ''}, its data` }] };
  return [caption, { type: 'table', content: [header, ...rows] }];
}

// The document tree for blocks from parseDocx.
export function blocksToContent(blocks = [], images = []) {
  const byId = new Map(images.map((i) => [i.id, i]));
  const out = [];
  let quote = null;
  for (const block of blocks) {
    const isQuote = block.type === 'paragraph' && /quote/i.test(block.styleId || '');
    if (!isQuote) quote = null;
    switch (block.type) {
      case 'title':
        out.push(textBlock('paragraph', block, { blockStyle: 'title' }));
        break;
      case 'subtitle':
        out.push(textBlock('paragraph', block, { blockStyle: 'subtitle' }));
        break;
      case 'heading':
        out.push(textBlock('heading', block, { level: Math.max(1, Math.min(6, block.level || 1)) }));
        break;
      case 'paragraph':
        if (isQuote) {
          if (!quote) {
            quote = { type: 'blockquote', content: [] };
            out.push(quote);
          }
          quote.content.push(textBlock('paragraph', block));
        } else {
          out.push(textBlock('paragraph', block, /caption/i.test(block.styleId || '') ? { blockStyle: 'caption' } : undefined));
        }
        break;
      case 'list':
        out.push(...nestList(block.items || []));
        break;
      case 'table': {
        const table = block.table && tableNode(block.table);
        if (table) out.push(table);
        break;
      }
      case 'image': {
        const image = byId.get(block.imageId);
        if (image && IMAGE_SRC.test(image.dataUrl)) {
          out.push({
            type: 'image',
            attrs: { src: image.dataUrl, width: image.widthPx || null, height: image.heightPx || null, align: block.layout?.align === 'justify' ? null : block.layout?.align || null }
          });
        }
        break;
      }
      case 'chart':
        out.push(...chartNodes(block.chart));
        break;
      case 'pageBreak':
        out.push({ type: 'pageBreak' });
        break;
      default:
    }
  }
  return { type: 'doc', content: out.length ? out : [{ type: 'paragraph' }] };
}

// Plain-language notes on what a .docx held that the editor does not.
export function importNotes(found = {}) {
  const notes = [];
  const say = (flag, text) => { if (found[flag]) notes.push(text); };
  say('textBoxes', 'Text boxes were not imported.');
  say('equations', 'Equations were not imported.');
  say('footnotes', 'Footnotes were not imported.');
  say('comments', 'Comments were not imported.');
  say('smartArt', 'SmartArt diagrams were not imported.');
  say('trackedChanges', 'Tracked changes were accepted: insertions were kept and deletions removed.');
  if (found.simplifiedCharts || found.charts) notes.push('Charts became tables of their data where they could be read.');
  const pictures = (found.skippedImages || 0) + (found.unsupportedImages || 0);
  if (pictures) notes.push(`${pictures} picture${pictures === 1 ? ' was' : 's were'} left out because of size or format.`);
  return notes;
}
