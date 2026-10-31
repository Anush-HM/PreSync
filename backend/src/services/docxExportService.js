import JSZip from 'jszip';
import { textLines } from './deckExportService.js';

// Exports a deck as a Word document: one section per slide, read top to
// bottom. Titles become headings, text keeps its run formatting, tables
// stay tables, charts become a table of their data, pictures are
// embedded and speaker notes follow each slide. Content that only exists
// as a picture of the slide (pages imported without editable text) is
// included as that picture and labelled as such.
//
// The package is written by hand with JSZip, so no extra dependency is
// needed; only standard WordprocessingML parts are used.

const PX_TO_EMU = 9525; // 96 dpi
const MAX_IMAGE_PX = 600; // fits a 6.5" text column at 96 dpi
const LIST_PREFIX = /^( *)((?:[•▪▫➢➤➔➜➝✓■□●○◦◆◇❖❑♦◻–\-*]|\(?(?:\d{1,3}|[a-zA-Z]|[ivxlcdmIVXLCDM]{1,6})[.)]) +)/u;
const IMAGE = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i;

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

// XML 1.0 can't carry most control characters at all.
function esc(text) {
  return String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const hex = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.slice(1).toUpperCase() : null);
const firstFont = (f) => (typeof f === 'string' ? f.split(',')[0].replace(/["']/g, '').trim() : '');

function runProps(style = {}, { heading = false } = {}) {
  const p = [];
  const font = firstFont(style.fontFamily);
  if (font) p.push(`<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}"/>`);
  const bold = style.fontWeight === 'bold' || Number(style.fontWeight) >= 600;
  if (bold && !heading) p.push('<w:b/>');
  if (style.fontStyle === 'italic') p.push('<w:i/>');
  if (style.linethrough) p.push('<w:strike/>');
  const color = hex(style.fill);
  if (color) p.push(`<w:color w:val="${color}"/>`);
  // Slide sizes are px on a 960px slide; keep them readable on a page.
  if (!heading && Number.isFinite(style.fontSize)) {
    const pt = Math.max(8, Math.min(28, style.fontSize * 0.6));
    p.push(`<w:sz w:val="${Math.round(pt * 2)}"/>`);
  }
  if (style.underline) p.push('<w:u w:val="single"/>');
  const shade = hex(style.textBackgroundColor);
  if (shade) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`);
  if (Number(style.deltaY) < 0) p.push('<w:vertAlign w:val="superscript"/>');
  else if (Number(style.deltaY) > 0) p.push('<w:vertAlign w:val="subscript"/>');
  return p.length ? `<w:rPr>${p.join('')}</w:rPr>` : '';
}

const run = (text, style, opts) => `<w:r>${runProps(style, opts)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

const JC = { center: 'center', right: 'right', justify: 'both' };

function paragraph(runsXml, { style, align, indent, keepNext, pageBreakBefore } = {}) {
  const pp = [];
  if (style) pp.push(`<w:pStyle w:val="${style}"/>`);
  if (keepNext) pp.push('<w:keepNext/>');
  if (pageBreakBefore) pp.push('<w:pageBreakBefore/>');
  if (indent) pp.push(`<w:ind w:left="${indent}" w:hanging="260"/>`);
  if (JC[align]) pp.push(`<w:jc w:val="${JC[align]}"/>`);
  return `<w:p>${pp.length ? `<w:pPr>${pp.join('')}</w:pPr>` : ''}${runsXml}</w:p>`;
}

// A text block's lines as paragraphs. List items (the editor writes their
// markers as text) get a hanging indent from their nesting.
function textParagraphs(block, { heading } = {}) {
  return textLines(block)
    .filter((runs) => !heading || runs.some((r) => r.text.trim()))
    .map((runs) => {
      const text = runs.map((r) => r.text).join('');
      const list = LIST_PREFIX.exec(text);
      const indent = list ? 360 + Math.floor(list[1].length / 2) * 360 : 0;
      const xml = runs.map((r) => run(r.text.replace(/ /g, ' '), r.style, { heading: !!heading })).join('');
      return paragraph(xml, { style: heading, align: block.textAlign, indent, keepNext: !!heading });
    });
}

function cellXml(cell, width) {
  const props = [`<w:tcW w:w="${width}" w:type="dxa"/>`];
  if (cell.colspan > 1) props.push(`<w:gridSpan w:val="${cell.colspan}"/>`);
  if (cell.vMerge) props.push(cell.vMerge === 'restart' ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>');
  const fill = hex(cell.background);
  if (fill) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`);
  const v = { middle: 'center', bottom: 'bottom' }[cell.verticalAlign];
  if (v) props.push(`<w:vAlign w:val="${v}"/>`);
  const paras = cell.text === undefined ? [paragraph('')] : textParagraphs(cell);
  return `<w:tc><w:tcPr>${props.join('')}</w:tcPr>${paras.join('') || paragraph('')}</w:tc>`;
}

function tableXml(columnsPx, rows) {
  const total = columnsPx.reduce((a, w) => a + w, 0) || 1;
  const twips = columnsPx.map((w) => Math.max(400, Math.round((w / total) * 9360)));
  const grid = twips.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="B1BAB3"/>`;
  const borders = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>`;
  const body = rows.map((cells) => {
    let col = 0;
    const tcs = cells.map((c) => {
      const span = Math.max(1, c.colspan || 1);
      const width = twips.slice(col, col + span).reduce((a, w) => a + w, 0);
      col += span;
      return cellXml(c, width);
    });
    return `<w:tr>${tcs.join('')}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>${paragraph('')}`;
}

// The editor's table model is a full grid: a merged cell carries
// colspan/rowspan and the cells under it are `covered`. Word wants
// horizontal spans as gridSpan and vertical ones as vMerge.
function deckTableXml(table) {
  const cols = table.columns.length;
  const below = new Map(); // column where a tall cell starts → { left, colspan }
  const rows = table.rows.map((row) => {
    const out = [];
    let c = 0;
    while (c < cols) {
      const cell = row.cells[c] || { text: '' };
      const tall = below.get(c);
      if (cell.covered && tall?.left > 0) {
        out.push({ vMerge: 'continue', colspan: tall.colspan });
        tall.left -= 1;
        c += tall.colspan;
      } else if (cell.covered) {
        c += 1; // under a wide cell to the left
      } else {
        const colspan = Math.max(1, Math.min(cols - c, cell.colspan || 1));
        const out1 = { ...cell, text: cell.text || '', colspan };
        if (cell.rowspan > 1) {
          out1.vMerge = 'restart';
          below.set(c, { left: cell.rowspan - 1, colspan });
        }
        out.push(out1);
        c += colspan;
      }
    }
    return out;
  });
  return tableXml(table.columns, rows);
}

function chartXml(chart) {
  const cats = chart.categories || [];
  const series = chart.series || [];
  const header = [{ text: '', fontWeight: 'bold' }, ...series.map((s) => ({ text: s.name || 'Series', fontWeight: 'bold' }))];
  const rows = cats.map((cat, i) => [{ text: String(cat ?? '') }, ...series.map((s) => ({ text: Number.isFinite(s.values?.[i]) ? String(s.values[i]) : '' }))]);
  const caption = paragraph(run(`Chart${chart.title ? `: ${chart.title}` : ''} (${chart.kind || 'column'}), its data`, { fontStyle: 'italic', fill: '#5d6b63' }), { keepNext: true });
  return caption + tableXml(header.map(() => 120), [header, ...rows]);
}

class Media {
  constructor() {
    this.files = [];
  }

  // Embeds a data: URL picture. Returns the relationship id, or null for
  // anything that isn't an inline PNG, JPEG or GIF.
  add(url) {
    const m = IMAGE.exec(url || '');
    if (!m) return null;
    const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
    const n = this.files.length + 1;
    this.files.push({ id: `rIdImg${n}`, name: `image${n}.${ext}`, ext, data: Buffer.from(m[2], 'base64') });
    return { id: `rIdImg${n}`, n };
  }
}

function pictureXml(media, url, widthPx, heightPx, alt, { align, maxWidth = MAX_IMAGE_PX } = {}) {
  const ref = media.add(url);
  if (!ref) return null;
  const ratio = widthPx > 0 && heightPx > 0 ? heightPx / widthPx : 0.5625;
  const w = Math.min(maxWidth, Math.max(24, widthPx || maxWidth));
  const cx = Math.round(w * PX_TO_EMU);
  const cy = Math.round(w * ratio * PX_TO_EMU);
  const descr = esc(alt || '');
  return paragraph(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${ref.n}" name="Picture ${ref.n}" descr="${descr}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${ref.n}" name="Picture ${ref.n}" descr="${descr}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${ref.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, { align });
}

const note = (text) => paragraph(run(text, { fontStyle: 'italic', fill: '#5d6b63' }));
const hasText = (b) => String(b.text || '').trim().length > 0;

function slideTitle(slide, blocks) {
  return blocks.find((b) => b.role === 'title' && hasText(b)) || null;
}

// Reading order: top to bottom, then left to right.
function readingOrder(blocks) {
  return [...blocks].sort((a, b) => (Math.round((a.y || 0) / 24) - Math.round((b.y || 0) / 24)) || (a.x || 0) - (b.x || 0));
}

function slideXml(slide, index, media, { notes }) {
  const out = [];
  const blocks = (slide.blocks || []).filter((b) => b.role !== 'placeholder' && b.layoutSlot !== 'image');
  const title = slideTitle(slide, blocks);
  const heading = title
    ? textParagraphs({ ...title, fill: undefined }, { heading: 'Heading1' })
    : [paragraph(run(slide.name || `Slide ${index + 1}`), { style: 'Heading1', keepNext: true })];
  out.push(heading.join(''));
  if (slide.name && title) out.push(note(`Slide ${index + 1}: ${slide.name}`));

  // A slide whose content is only a picture of the page.
  const textless = !blocks.some((b) => hasText(b) || b.type === 'table' || b.type === 'chart' || b.type === 'image');
  if (slide.backgroundImageUrl && (textless || slide.needsImageFallback)) {
    const pic = pictureXml(media, slide.backgroundImageUrl, 960, 540, `Slide ${index + 1}`);
    if (pic) out.push(pic, note('Picture of the original slide. Its contents are not editable text.'));
  }

  for (const b of readingOrder(blocks)) {
    if (b === title) continue;
    const type = b.type || 'textbox';
    if (type === 'table' && b.table?.rows?.length && b.table.columns?.length) out.push(deckTableXml(b.table));
    else if (type === 'chart' && b.chart?.series?.length) out.push(chartXml(b.chart));
    else if (type === 'image') {
      const pic = pictureXml(media, b.imageUrl, b.width, b.height, b.alt);
      out.push(pic || note(`[Picture${b.alt ? `: ${b.alt}` : ''} not included: only pictures stored in the presentation can be exported]`));
    } else if (hasText(b)) {
      out.push(textParagraphs(b, { heading: b.role === 'subtitle' ? 'Subtitle' : undefined }).join(''));
    }
  }

  if (notes && String(slide.notes || '').trim()) {
    out.push(paragraph(run('Speaker notes', {}), { style: 'NotesHeading', keepNext: true }));
    for (const line of String(slide.notes).split('\n')) out.push(paragraph(run(line, {}), { style: 'Notes' }));
  }
  return out.join('');
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="171A19"/><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="285C43"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="5D6B63"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="NotesHeading"><w:name w:val="Notes heading"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="5D6B63"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Notes"><w:name w:val="Notes"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="A3D4B2"/></w:pBdr><w:ind w:left="200"/><w:spacing w:after="40"/></w:pPr><w:rPr><w:color w:val="3A4540"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;

// Options: { includeHidden: false, notes: true }.
export async function exportDeckToDocx(deck, { includeHidden = false, notes = true } = {}) {
  const media = new Media();
  const body = [paragraph(run(deck.title || 'Presentation', {}), { style: 'Title' })];
  // Slides keep the numbers they have in the editor, hidden ones included.
  [...(deck.slides || [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((s, i) => {
      if (includeHidden || !s.hidden) body.push(slideXml(s, i, media, { notes }));
    });
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const zip = new JSZip();
  const exts = [...new Set(media.files.map((f) => f.ext))];
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(deck.title || 'Presentation')}</dc:title><dc:creator>PreSync</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${media.files.map((f) => `<Relationship Id="${f.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${f.name}"/>`).join('')}</Relationships>`);
  for (const f of media.files) zip.file(`word/media/${f.name}`, f.data);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// --- Word documents from the document editor ------------------------------------

const DOC_NS = `${NS} xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"`;
const PX_TWIPS = 15; // 1440 twips per inch at 96 px
const TONE_FILL = { info: 'E3EEF8', success: 'E3F2E8', warning: 'FBF0DA', danger: 'F9E3E6' };
const TONE_EDGE = { info: '2F6F9F', success: '347653', warning: 'C89B3C', danger: 'AC3045' };
const TONE_TEXT = { info: '16324F', success: '1D4532', warning: '6B4E12', danger: '5E1823' };
const HEADING_STYLES = ['Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6'];
const BLOCK_STYLES = { title: 'Title', subtitle: 'Subtitle', caption: 'Caption' };

const colorHex = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.slice(1).toUpperCase() : null);

function docRunProps(marks = []) {
  const has = (t) => marks.find((m) => m.type === t);
  const style = has('textStyle')?.attrs || {};
  const badge = has('badge');
  const p = [];
  const font = firstFont(style.fontFamily);
  if (font) p.push(`<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}"/>`);
  if (has('bold') || badge) p.push('<w:b/>');
  if (has('italic')) p.push('<w:i/>');
  if (has('strike')) p.push('<w:strike/>');
  const color = badge ? TONE_TEXT[badge.attrs?.tone] : colorHex(style.color);
  if (color) p.push(`<w:color w:val="${color}"/>`);
  const size = parseFloat(style.fontSize);
  if (Number.isFinite(size)) {
    const pt = /px$/.test(style.fontSize) ? size * 0.75 : size;
    p.push(`<w:sz w:val="${Math.round(pt * 2)}"/>`);
  }
  if (has('underline')) p.push('<w:u w:val="single"/>');
  const fill = badge ? TONE_FILL[badge.attrs?.tone] : colorHex(style.backgroundColor);
  if (fill) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`);
  return p.length ? `<w:rPr>${p.join('')}</w:rPr>` : '';
}

function inlineXml(nodes = []) {
  return nodes.map((n) => {
    if (n.type === 'hardBreak') return '<w:r><w:br/></w:r>';
    if (n.type !== 'text') return '';
    const props = docRunProps(n.marks);
    return n.text.split('\t').map((part, i) => {
      const tab = i > 0 ? '<w:tab/>' : '';
      return `<w:r>${props}${tab}<w:t xml:space="preserve">${esc(part)}</w:t></w:r>`;
    }).join('');
  }).join('');
}

function docParagraph(node, { style, numbering } = {}) {
  const attrs = node.attrs || {};
  const pp = [];
  const named = style || BLOCK_STYLES[attrs.blockStyle] || (node.type === 'heading' ? HEADING_STYLES[(attrs.level || 1) - 1] : null);
  if (named) pp.push(`<w:pStyle w:val="${named}"/>`);
  if (numbering) pp.push(`<w:numPr><w:ilvl w:val="${numbering.level}"/><w:numId w:val="${numbering.numId}"/></w:numPr>`);
  if (attrs.lineHeight) pp.push(`<w:spacing w:line="${Math.round(attrs.lineHeight * 240)}" w:lineRule="auto"/>`);
  if (JC[attrs.textAlign]) pp.push(`<w:jc w:val="${JC[attrs.textAlign]}"/>`);
  return `<w:p>${pp.length ? `<w:pPr>${pp.join('')}</w:pPr>` : ''}${inlineXml(node.content)}</w:p>`;
}

// A shape as DrawingML, the way Word writes one, drawn inline.
function shapeXml(attrs, ctx) {
  const id = (ctx.shapeId += 1) + 10000;
  const cx = Math.round(Math.min(attrs.width || 160, ctx.contentPx) * PX_TO_EMU);
  const cy = Math.round((attrs.height || 100) * PX_TO_EMU);
  const fill = colorHex(attrs.color) || '285C43';
  const shape = `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${esc(attrs.shape)}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>`;
  const drawing = `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Shape ${ctx.shapeId}"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">${shape}</a:graphicData></a:graphic></wp:inline></w:drawing>`;
  return paragraph(`<w:r><mc:AlternateContent><mc:Choice Requires="wps">${drawing}</mc:Choice></mc:AlternateContent></w:r>`, { align: attrs.align });
}

// Column widths in twips for a table of the given grid width. Widths the
// editor recorded are kept in proportion; unset columns share the rest.
function tableGrid(rows, contentPx) {
  const widths = [];
  rows.forEach((row, r) => {
    let col = 0;
    for (const cell of row) {
      const span = cell.attrs?.colspan || 1;
      if (r === 0 || col + span > widths.length) {
        for (let i = 0; i < span; i++) widths[col + i] = widths[col + i] || cell.attrs?.colwidth?.[i] || null;
      }
      col += span;
    }
  });
  const known = widths.reduce((sum, w) => sum + (w || 0), 0);
  const unset = widths.filter((w) => !w).length;
  const filler = unset ? Math.max(40, (contentPx - known) / unset) : 0;
  const px = widths.map((w) => w || filler);
  const total = px.reduce((a, b) => a + b, 0) || 1;
  const scale = Math.min(1, contentPx / total);
  return px.map((w) => Math.max(200, Math.round(w * scale * PX_TWIPS)));
}

function docTableXml(node, ctx) {
  const rows = (node.content || []).map((r) => r.content || []);
  // Grid positions: vMerge needs a stand-in cell under every tall cell.
  const tall = new Map(); // column -> { left, colspan }
  const placed = rows.map((row) => {
    const out = [];
    const queue = [...row];
    let col = 0;
    while (queue.length || [...tall.keys()].some((k) => k >= col)) {
      const over = tall.get(col);
      if (over) {
        out.push({ merged: true, colspan: over.colspan, col });
        col += over.colspan;
        over.left -= 1;
        if (over.left <= 0) tall.delete(col - over.colspan);
        continue;
      }
      const cell = queue.shift();
      if (!cell) {
        col += 1;
        continue;
      }
      const colspan = cell.attrs?.colspan || 1;
      const rowspan = cell.attrs?.rowspan || 1;
      out.push({ cell, colspan, col, restart: rowspan > 1 });
      col += colspan;
      if (rowspan > 1) tall.set(col - colspan, { left: rowspan - 1, colspan });
    }
    return out;
  });
  const grid = tableGrid(rows, ctx.contentPx);
  const columns = Math.max(...placed.map((row) => row.reduce((n, c) => n + c.colspan, 0)), grid.length);
  while (grid.length < columns) grid.push(grid[grid.length - 1] || 1200);
  const body = placed.map((row) => {
    const tcs = row.map(({ cell, colspan, col, merged, restart }) => {
      const width = grid.slice(col, col + colspan).reduce((a, w) => a + w, 0);
      const props = [`<w:tcW w:w="${width}" w:type="dxa"/>`];
      if (colspan > 1) props.push(`<w:gridSpan w:val="${colspan}"/>`);
      if (merged) props.push('<w:vMerge/>');
      if (restart) props.push('<w:vMerge w:val="restart"/>');
      const fill = colorHex(cell?.attrs?.background);
      if (fill) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`);
      const inner = merged ? paragraph('') : blocksXml(cell.content, { ...ctx, contentPx: (width / PX_TWIPS) - 16 }) || paragraph('');
      // A cell must end in a paragraph.
      const closed = /<\/w:p>$/.test(inner) ? inner : `${inner}${paragraph('')}`;
      return `<w:tc><w:tcPr>${props.join('')}</w:tcPr>${closed}</w:tc>`;
    });
    return `<w:tr>${tcs.join('')}</w:tr>`;
  }).join('');
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="B1BAB3"/>`;
  const borders = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${grid.reduce((a, w) => a + w, 0)}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${body}</w:tbl>${paragraph('')}`;
}

function calloutXml(node, ctx) {
  const tone = node.attrs?.tone || 'info';
  const width = Math.round(ctx.contentPx * PX_TWIPS);
  const inner = blocksXml(node.content, { ...ctx, contentPx: ctx.contentPx - 32 }) || paragraph('');
  const closed = /<\/w:p>$/.test(inner) ? inner : `${inner}${paragraph('')}`;
  const edge = TONE_EDGE[tone];
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblBorders><w:left w:val="single" w:sz="24" w:space="0" w:color="${edge}"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${TONE_FILL[tone]}"/></w:tcPr>${closed}</w:tc></w:tr></w:tbl>${paragraph('')}`;
}

function listXml(node, ctx, level) {
  const ordered = node.type === 'orderedList';
  const numId = ordered ? ctx.numbering.orderedList(node.attrs?.start) : 1;
  return (node.content || []).map((item) => (item.content || []).map((child) => {
    if (child.type === 'bulletList' || child.type === 'orderedList') return listXml(child, ctx, Math.min(level + 1, 8));
    if (child.type === 'paragraph' || child.type === 'heading') return docParagraph(child, { numbering: { numId, level } });
    return blockXml(child, ctx);
  }).join('')).join('');
}

function blockXml(node, ctx) {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return docParagraph(node, { style: ctx.quote ? 'Quote' : undefined });
    case 'bulletList':
    case 'orderedList':
      return listXml(node, ctx, 0);
    case 'blockquote':
      return blocksXml(node.content, { ...ctx, quote: true });
    case 'horizontalRule':
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="B1BAB3"/></w:pBdr></w:pPr></w:p>';
    case 'pageBreak':
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    case 'table':
      return docTableXml(node, ctx);
    case 'callout':
      return calloutXml(node, ctx);
    case 'shape':
      return shapeXml(node.attrs || {}, ctx);
    case 'image': {
      const a = node.attrs || {};
      return pictureXml(ctx.media, a.src, a.width, a.height, a.alt, { align: a.align, maxWidth: ctx.contentPx }) || '';
    }
    default:
      return '';
  }
}

function blocksXml(nodes = [], ctx) {
  return nodes.map((n) => blockXml(n, ctx)).join('');
}

const DOC_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Public Sans" w:hAnsi="Public Sans" w:cs="Public Sans"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="171A19"/><w:sz w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:color w:val="5B625D"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1D4532"/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="285C43"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="347653"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="5"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="A3D4B2"/></w:pBdr><w:ind w:left="240"/></w:pPr><w:rPr><w:i/><w:color w:val="3A4540"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="5B625D"/><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>`;

const BULLETS = ['•', '○', '▪'];

// Bullets are one list; every numbered list gets its own w:num so it
// counts from its own start.
function numberingXml(starts) {
  const level = (i, fmt, text) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${(i + 1) * 360}" w:hanging="260"/></w:pPr></w:lvl>`;
  const levels = Array.from({ length: 9 }, (_, i) => i);
  const FORMATS = ['decimal', 'lowerLetter', 'lowerRoman'];
  const bullets = levels.map((i) => level(i, 'bullet', BULLETS[i % 3])).join('');
  const numbers = levels.map((i) => level(i, FORMATS[i % 3], `%${i + 1}.`)).join('');
  const nums = starts.map((start, i) => `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bullets}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${numbers}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${nums}</w:numbering>`;
}

// A document from the document editor as a .docx: real headings, lists
// and tables, at its own page size. Callouts become one-cell tables.
export async function exportDocumentToDocx(document) {
  const media = new Media();
  const page = document.page;
  const contentPx = page.width - page.margins.left - page.margins.right;
  const starts = [];
  const ctx = {
    media,
    contentPx,
    shapeId: 0,
    numbering: {
      orderedList(start) {
        starts.push(start || 1);
        return starts.length + 1;
      }
    }
  };
  const body = blocksXml(document.content?.content, ctx);
  const m = page.margins;
  const sect = `<w:sectPr><w:pgSz w:w="${Math.round(page.width * PX_TWIPS)}" w:h="${Math.round(page.height * PX_TWIPS)}"/><w:pgMar w:top="${m.top * PX_TWIPS}" w:right="${m.right * PX_TWIPS}" w:bottom="${m.bottom * PX_TWIPS}" w:left="${m.left * PX_TWIPS}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${DOC_NS} mc:Ignorable="wps"><w:body>${body}${sect}</w:body></w:document>`;

  const title = esc(document.title || 'Document');
  const zip = new JSZip();
  const exts = [...new Set(media.files.map((f) => f.ext))];
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:creator>PreSync</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', DOC_STYLES);
  zip.file('word/numbering.xml', numberingXml(starts));
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${media.files.map((f) => `<Relationship Id="${f.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${f.name}"/>`).join('')}</Relationships>`);
  for (const f of media.files) zip.file(`word/media/${f.name}`, f.data);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
