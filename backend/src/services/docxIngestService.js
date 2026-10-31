import JSZip from 'jszip';
import path from 'path';
import { attr, child, children, find, num, readRels, readXml } from './ooxml.js';
import { paragraphContext, paragraphLayout, readRuns, readTable, readWordStyles, runStyle, twipsToPx } from './docxFormatting.js';
import { processImage } from './imageProcessing.js';
import { readChart } from './pptxCharts.js';

// Reads a Word (.docx) document into an ordered list of content blocks:
// title, subtitle, headings (with level), paragraphs, lists (with
// nesting, bullet/number type and the marker Word shows), tables,
// pictures and charts (with their data), plus page breaks. Every text block also carries `runs` (its
// text with per-run formatting) and `layout` (alignment, spacing,
// indents); tables carry their full grid with merges, shading and
// borders; `meta.page` has the page size and margins, and `header` /
// `footer` the default header and footer. Pure parsing only; turning
// blocks into an outline lives in documentAnalysis.js.
//
// Not read: footnotes, comments, text boxes, equations and SmartArt. Their presence is reported so the user knows what was left
// out.

export class DocxParseError extends Error {}

const EMU_PER_PX = 9525;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
const DECODABLE = new Set(['bmp', 'webp']);

// --- styles ---------------------------------------------------------------

// Map styleId -> { kind: 'title'|'subtitle'|'heading'|null, level }.
// Follows basedOn chains so custom styles derived from "Heading 2" count.
function readStyles(root) {
  const raw = new Map();
  for (const style of children(root, 'w:style')) {
    if (attr(style, 'w:type') && attr(style, 'w:type') !== 'paragraph') continue;
    const id = attr(style, 'w:styleId');
    if (!id) continue;
    raw.set(id, {
      name: (attr(child(style, 'w:name'), 'w:val') || '').toLowerCase(),
      basedOn: attr(child(style, 'w:basedOn'), 'w:val'),
      outline: attr(find(style, 'w:pPr', 'w:outlineLvl'), 'w:val'),
      numId: attr(find(style, 'w:pPr', 'w:numPr', 'w:numId'), 'w:val'),
      ilvl: attr(find(style, 'w:pPr', 'w:numPr', 'w:ilvl'), 'w:val')
    });
  }

  const resolved = new Map();
  function resolve(id, depth = 0) {
    if (resolved.has(id)) return resolved.get(id);
    const s = raw.get(id);
    let out = { kind: null, level: null };
    if (s && depth < 10) {
      const heading = /^heading\s*(\d)$/.exec(s.name);
      const listStyle = /^list (bullet|number)(?: (\d))?$/.exec(s.name);
      if (s.name === 'title') out = { kind: 'title', level: 0 };
      else if (s.numId || listStyle) {
        // "List Bullet 2" etc. imply a nesting level when the style has none.
        const impliedLevel = listStyle ? Number(listStyle[2] || 1) - 1 : 0;
        out = { kind: 'list', numId: s.numId, ordered: listStyle ? listStyle[1] === 'number' : undefined, level: s.ilvl !== null ? Number(s.ilvl) : impliedLevel };
      }
      else if (s.name === 'subtitle') out = { kind: 'subtitle', level: null };
      else if (heading) out = { kind: 'heading', level: Number(heading[1]) };
      else if (s.outline !== null && Number(s.outline) < 9) out = { kind: 'heading', level: Number(s.outline) + 1 };
      else if (s.basedOn) out = resolve(s.basedOn, depth + 1);
    }
    resolved.set(id, out);
    return out;
  }
  for (const id of raw.keys()) resolve(id);
  return resolved;
}

const SYMBOL_BULLETS = { '\uf0b7': '•', '\uf0a7': '▪', '\uf0d8': '➢', '\uf0fc': '✓', '\uf076': '❖', '\uf06f': '○', 'o': '○', '§': '▪', 'Ø': '➢', 'ü': '✓' };

function formatNumber(fmt, n) {
  const roman = (v) => {
    const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let out = '';
    for (const [k, s2] of t) while (v >= k) { out += s2; v -= k; }
    return out;
  };
  const letter = (v) => {
    let out = '';
    while (v > 0) { v -= 1; out = String.fromCharCode(97 + (v % 26)) + out; v = Math.floor(v / 26); }
    return out;
  };
  switch (fmt) {
    case 'lowerLetter': return letter(n);
    case 'upperLetter': return letter(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'decimalZero': return String(n).padStart(2, '0');
    default: return String(n);
  }
}

// Map numId -> Map(ilvl -> { fmt, text, start, indentLeft, indentFirst })
// for drawing list markers the way Word does.
function readNumberingInfo(root) {
  const abstract = new Map();
  for (const an of children(root, 'w:abstractNum')) {
    const levels = new Map();
    for (const lvl of children(an, 'w:lvl')) {
      const ind = find(lvl, 'w:pPr', 'w:ind');
      levels.set(Number(attr(lvl, 'w:ilvl') || 0), {
        fmt: attr(child(lvl, 'w:numFmt'), 'w:val') || 'bullet',
        text: attr(child(lvl, 'w:lvlText'), 'w:val') ?? '•',
        start: num(child(lvl, 'w:start'), 'w:val') ?? 1,
        indentLeft: twipsToPx(attr(ind, 'w:left') ?? attr(ind, 'w:start')),
        indentFirst: attr(ind, 'w:hanging') !== null ? -twipsToPx(attr(ind, 'w:hanging')) : null
      });
    }
    abstract.set(attr(an, 'w:abstractNumId'), levels);
  }
  const nums = new Map();
  for (const n of children(root, 'w:num')) {
    nums.set(attr(n, 'w:numId'), { abstractId: attr(child(n, 'w:abstractNumId'), 'w:val'), levels: abstract.get(attr(child(n, 'w:abstractNumId'), 'w:val')) || new Map() });
  }
  return nums;
}

// Map numId -> Map(ilvl -> ordered?) from numbering.xml.
function readNumbering(root) {
  const abstract = new Map();
  for (const an of children(root, 'w:abstractNum')) {
    const levels = new Map();
    for (const lvl of children(an, 'w:lvl')) {
      const fmt = attr(child(lvl, 'w:numFmt'), 'w:val') || 'bullet';
      levels.set(Number(attr(lvl, 'w:ilvl') || 0), fmt !== 'bullet' && fmt !== 'none');
    }
    abstract.set(attr(an, 'w:abstractNumId'), levels);
  }
  const nums = new Map();
  for (const n of children(root, 'w:num')) {
    nums.set(attr(n, 'w:numId'), abstract.get(attr(child(n, 'w:abstractNumId'), 'w:val')) || new Map());
  }
  return nums;
}

// --- paragraph content ----------------------------------------------------

// Walks a paragraph collecting visible text and picture references.
// Deleted text (tracked changes) is skipped; inserted text is kept.
function readParagraphContent(p, found) {
  let text = '';
  const pictures = [];
  const charts = [];

  function walk(node) {
    for (const c of children(node)) {
      switch (c.nodeName) {
        case 'w:t':
          text += c.textContent;
          break;
        case 'w:tab':
          text += '\t';
          break;
        case 'w:br':
        case 'w:cr':
          if (attr(c, 'w:type') !== 'page') text += '\n';
          break;
        case 'w:del':
          found.trackedChanges = true;
          break;
        case 'w:ins':
          found.trackedChanges = true;
          walk(c);
          break;
        case 'w:txbxContent':
          found.textBoxes = true;
          break;
        case 'm:oMath':
        case 'm:oMathPara':
          found.equations = true;
          break;
        case 'w:footnoteReference':
        case 'w:endnoteReference':
          found.footnotes = true;
          break;
        case 'w:commentReference':
          found.comments = true;
          break;
        case 'a:graphicData': {
          const uri = attr(c, 'uri') || '';
          if (uri.endsWith('/chart')) found.charts = true;
          else if (uri.endsWith('/diagram')) found.smartArt = true;
          walk(c);
          break;
        }
        case 'wp:inline':
        case 'wp:anchor': {
          const extent = child(c, 'wp:extent');
          const chartRef = findDeep(c, 'c:chart');
          if (chartRef && attr(chartRef, 'r:id')) {
            charts.push({
              rId: attr(chartRef, 'r:id'),
              widthPx: Math.round(Number(attr(extent, 'cx') || 0) / EMU_PER_PX) || null,
              heightPx: Math.round(Number(attr(extent, 'cy') || 0) / EMU_PER_PX) || null
            });
            break;
          }
          const blip = findDeep(c, 'a:blip');
          const rId = attr(blip, 'r:embed');
          if (rId) {
            pictures.push({
              rId,
              widthPx: Math.round(Number(attr(extent, 'cx') || 0) / EMU_PER_PX) || null,
              heightPx: Math.round(Number(attr(extent, 'cy') || 0) / EMU_PER_PX) || null
            });
          }
          walk(c);
          break;
        }
        case 'v:imagedata': {
          const rId = attr(c, 'r:id');
          if (rId) pictures.push({ rId, widthPx: null, heightPx: null });
          break;
        }
        case 'w:pPr':
        case 'w:rPr':
        case 'w:instrText':
        case 'w:delText':
          break;
        default:
          walk(c);
      }
    }
  }
  walk(p);
  return { text: text.replace(/[ \t]+$/gm, '').trim(), pictures, charts };
}

function findDeep(node, tag) {
  for (const c of children(node)) {
    if (c.nodeName === tag) return c;
    const hit = findDeep(c, tag);
    if (hit) return hit;
  }
  return null;
}

function cellText(tc, found) {
  return children(tc, 'w:p')
    .map((p) => readParagraphContent(p, found).text)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COLUMN_LINE = /\t|\S[ \u00a0]{2,}\S/;

function trimLeadingSpaces(runs) {
  while (runs.length) {
    runs[0].text = runs[0].text.replace(/^[ \u00a0]+/, '');
    if (runs[0].text) break;
    runs.shift();
  }
}

const isBlank = (block) => block?.type === 'paragraph' && !block.text;

const BORDER_STYLES = { single: 'solid', thick: 'solid', double: 'double', dashed: 'dashed', dashSmallGap: 'dashed', dotted: 'dotted', threeDEngrave: 'groove', threeDEmboss: 'groove' };
const BORDER_SCOPES = { allPages: 'all', firstPage: 'first', notFirstPage: 'exceptFirst' };
const BORDER_WIDTHS = [0.5, 1, 1.5, 2.25, 3, 4.5, 6];
const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];

// The section's page border, in the shape of the document layout. Word
// measures `w:space` from the page or from the text; the layout always
// measures from the page.
function readPageBorder(node, margins) {
  if (!node) return null;
  const present = SIDE_NAMES.map((side) => [side, child(node, `w:${side}`)]).filter(([, n]) => n && !['nil', 'none'].includes(attr(n, 'w:val')));
  if (!present.length) return null;
  const [firstSide, first] = present[0];
  const points = Number(attr(first, 'w:sz') || 8) / 8;
  const width = BORDER_WIDTHS.reduce((best, w) => (Math.abs(w - points) < Math.abs(best - points) ? w : best));
  const space = Number(attr(first, 'w:space') || 0);
  const inset = attr(node, 'w:offsetFrom') === 'page' ? space : margins[firstSide] * 0.75 - space;
  const color = attr(first, 'w:color');
  return {
    sides: Object.fromEntries(SIDE_NAMES.map((side) => [side, present.some(([name]) => name === side)])),
    style: BORDER_STYLES[attr(first, 'w:val')] || 'solid',
    width,
    color: /^[0-9a-f]{6}$/i.test(color || '') ? `#${color.toLowerCase()}` : '#000000',
    inset: Math.max(0, Math.min(31, Math.round(inset))),
    scope: BORDER_SCOPES[attr(node, 'w:display')] || 'all'
  };
}

// --- main entry -------------------------------------------------------------

// Returns { blocks, images, meta, found } where
//   blocks: [{ type: 'title'|'subtitle'|'heading'|'paragraph'|'list'|'table'|'image'|'chart', ... }]
//   images: [{ id, mime, dataUrl, widthPx, heightPx }]
//   meta:   { title, pages, words }
//   found:  flags for content that was detected but not imported
export async function parseDocx(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new DocxParseError('File is not a valid .docx (zip) archive');
  }

  const docPath = 'word/document.xml';
  const doc = await readXml(zip, docPath);
  const body = doc && child(doc, 'w:body');
  if (!body) throw new DocxParseError('Missing word/document.xml');

  const stylesRoot = await readXml(zip, 'word/styles.xml');
  const styles = readStyles(stylesRoot);
  const numberingRoot = await readXml(zip, 'word/numbering.xml');
  const numbering = readNumbering(numberingRoot);
  const numberingInfo = readNumberingInfo(numberingRoot);
  const rels = await readRels(zip, docPath);
  const theme = await readXml(zip, 'word/theme/theme1.xml');
  const fontScheme = theme && find(theme, 'a:themeElements', 'a:fontScheme');
  const ctx = {
    styles: readWordStyles(stylesRoot, {
      major: attr(find(fontScheme, 'a:majorFont', 'a:latin'), 'typeface'),
      minor: attr(find(fontScheme, 'a:minorFont', 'a:latin'), 'typeface')
    })
  };
  const counters = new Map(); // abstract numbering id -> level counters
  // Chart colours that name theme slots (accent1…) resolve against the
  // document theme.
  const chartTheme = { colors: {}, clrMap: { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' } };
  for (const c of children(find(theme, 'a:themeElements', 'a:clrScheme'))) {
    const val = attr(child(c, 'a:srgbClr'), 'val') || attr(child(c, 'a:sysClr'), 'lastClr');
    if (val) chartTheme.colors[c.nodeName.replace(/^a:/, '')] = `#${val.toLowerCase()}`;
  }
  let chartCount = 0;

  const core = await readXml(zip, 'docProps/core.xml');
  const app = await readXml(zip, 'docProps/app.xml');
  const meta = {
    title: (core && child(core, 'dc:title')?.textContent?.trim()) || null,
    pages: Number(app && child(app, 'Pages')?.textContent) || null,
    words: Number(app && child(app, 'Words')?.textContent) || null
  };

  // Page size and margins of the (last) section, in px.
  const sectPr = child(body, 'w:sectPr');
  const pgSz = child(sectPr, 'w:pgSz');
  const pgMar = child(sectPr, 'w:pgMar');
  const m = (name, fallback) => twipsToPx(attr(pgMar, name) ?? fallback);
  meta.page = {
    width: twipsToPx(attr(pgSz, 'w:w') ?? 12240),
    height: twipsToPx(attr(pgSz, 'w:h') ?? 15840),
    margins: { top: m('w:top', 1440), right: m('w:right', 1440), bottom: m('w:bottom', 1440), left: m('w:left', 1440), header: m('w:header', 720), footer: m('w:footer', 720) }
  };

  const found = { skippedImages: 0, unsupportedImages: 0 };
  const blocks = [];
  const images = [];
  const imageByTarget = new Map();
  let imageBytes = 0;
  let lastList = null;
  let lastListNumId = null;

  async function loadPicture(pic) {
    const target = rels.get(pic.rId)?.target;
    if (!target) return null;
    if (imageByTarget.has(target)) return imageByTarget.get(target);
    const ext = path.posix.extname(target).slice(1).toLowerCase();
    if (!IMAGE_MIME[ext] && !DECODABLE.has(ext)) {
      found.unsupportedImages += 1;
      return null;
    }
    const file = zip.file(target);
    if (!file) return null;
    let data = await file.async('nodebuffer');
    let mime = IMAGE_MIME[ext];
    // Large or non-web pictures are re-encoded at a sensible size.
    const processed = await processImage(data, ext, { maxSide: 1600, maxBytes: MAX_IMAGE_BYTES });
    if (processed) {
      data = processed.buffer;
      mime = processed.mime;
    } else if (!mime) {
      found.unsupportedImages += 1;
      return null;
    }
    if (data.length > MAX_IMAGE_BYTES || imageBytes + data.length > MAX_TOTAL_IMAGE_BYTES) {
      found.skippedImages += 1;
      return null;
    }
    imageBytes += data.length;
    const image = {
      id: `img-${images.length + 1}`,
      mime,
      dataUrl: `data:${mime};base64,${data.toString('base64')}`,
      widthPx: pic.widthPx,
      heightPx: pic.heightPx
    };
    images.push(image);
    imageByTarget.set(target, image.id);
    return image.id;
  }

  // The marker Word draws for a list item ("1.", "a)", "•"), counting
  // per list and level the way Word does.
  function listMarker(numId, level) {
    const info = numberingInfo.get(numId);
    const lvl = info?.levels.get(level);
    if (!lvl) return { marker: '•' };
    const key = info.abstractId;
    const c = counters.get(key) || [];
    c[level] = (c[level] ?? lvl.start - 1) + 1;
    c.length = level + 1; // deeper levels restart
    counters.set(key, c);
    let marker;
    if (lvl.fmt === 'bullet') marker = SYMBOL_BULLETS[lvl.text] || (lvl.text && lvl.text.length <= 2 ? lvl.text : '•');
    else if (lvl.fmt === 'none') marker = '';
    else {
      marker = lvl.text.replace(/%(\d)/g, (_, d) => {
        const li = Number(d) - 1;
        const l = info.levels.get(li);
        return formatNumber(l?.fmt || 'decimal', c[li] ?? l?.start ?? 1);
      });
    }
    return { marker, indentLeft: lvl.indentLeft, indentFirst: lvl.indentFirst };
  }

  // One break per page turn. Blank lines just before a break only filled
  // out the page, and here could spill over into a page of their own.
  function pushPageBreak() {
    while (isBlank(blocks[blocks.length - 1])) blocks.pop();
    if (blocks.length && blocks[blocks.length - 1].type !== 'pageBreak') blocks.push({ type: 'pageBreak' });
  }

  async function readParagraph(p) {
    const styleId = attr(find(p, 'w:pPr', 'w:pStyle'), 'w:val');
    const style = (styleId && styles.get(styleId)) || { kind: null, level: null };
    const outline = attr(find(p, 'w:pPr', 'w:outlineLvl'), 'w:val');
    const numPr = find(p, 'w:pPr', 'w:numPr');
    const { text, pictures, charts } = readParagraphContent(p, found);
    const para = paragraphContext(p, ctx);
    const layout = paragraphLayout(para);
    const { runs, pageBreak, breakBefore } = readRuns(p, para, ctx);
    // A stray space would push a list item or column line out of line.
    if (numPr || style.kind === 'list' || COLUMN_LINE.test(text)) trimLeadingSpaces(runs);
    const formatted = { runs, ...(Object.keys(layout).length ? { layout } : {}) };
    // Quote and caption paragraphs keep their style for the document editor.
    if (/^(quote|intensequote|caption)$/i.test(para.styleId || '')) formatted.styleId = para.styleId;
    if (layout.pageBreakBefore || breakBefore) pushPageBreak();

    if (text) {
      if (style.kind === 'title') blocks.push({ type: 'title', text, ...formatted });
      else if (style.kind === 'subtitle') blocks.push({ type: 'subtitle', text, ...formatted });
      else if (style.kind === 'heading') blocks.push({ type: 'heading', level: Math.min(style.level, 6), text, ...formatted });
      else if (outline !== null && Number(outline) < 9) blocks.push({ type: 'heading', level: Number(outline) + 1, text, ...formatted });
      else if (numPr || style.kind === 'list') {
        // Numbering set on the paragraph wins over numbering from its style.
        const numId = attr(child(numPr, 'w:numId'), 'w:val') ?? style.numId;
        const ilvl = attr(child(numPr, 'w:ilvl'), 'w:val');
        const level = Math.min(ilvl !== null ? Number(ilvl) : style.level || 0, 4);
        if (numId !== '0') {
          const ordered = numbering.get(numId)?.get(level) ?? style.ordered ?? false;
          const prev = blocks[blocks.length - 1];
          const mark = numberingInfo.has(numId) ? listMarker(numId, level) : { marker: ordered ? null : '•' };
          const item = { text, level, ordered, ...formatted, ...mark };
          // Consecutive items of the same list stay together; a deeper
          // item right after a list is nested in it.
          if (prev && prev === lastList && (lastListNumId === numId || level > 0)) prev.items.push(item);
          else {
            lastList = { type: 'list', items: [item] };
            lastListNumId = numId;
            blocks.push(lastList);
          }
        } else {
          blocks.push({ type: 'paragraph', text, ...formatted });
        }
      } else {
        blocks.push({ type: 'paragraph', text, ...formatted });
      }
    }

    // Blank lines are how many documents space a page out.
    if (!text && !pictures.length && !charts.length && !pageBreak && !breakBefore) {
      // Its height comes from the formatting of its paragraph mark.
      const mark = [child(child(p, 'w:pPr'), 'w:rPr'), ...para.styleNodes.map((n) => child(n, 'w:rPr')), ctx.styles.rPrDefault].filter(Boolean);
      blocks.push({ type: 'paragraph', text: '', ...formatted, markStyle: runStyle(mark, ctx).style });
    }

    for (const pic of pictures) {
      const imageId = await loadPicture(pic);
      if (imageId) blocks.push({ type: 'image', imageId, ...(layout.align ? { layout: { align: layout.align } } : {}) });
    }
    for (const ref of charts) {
      const target = rels.get(ref.rId)?.target;
      const parsed = target && (await readChart(zip, target, { theme: chartTheme, fontPx: (pt) => pt * (96 / 72) }).catch(() => null));
      if (!parsed?.chart) {
        found.charts = true;
        continue;
      }
      if (parsed.notes.size) found.simplifiedCharts = true;
      chartCount += 1;
      blocks.push({ type: 'chart', id: `chart-${chartCount}`, chart: parsed.chart, widthPx: ref.widthPx || 480, heightPx: ref.heightPx || 288 });
    }
    // An explicit page break, or the end of a section that starts a new page.
    const sectionType = attr(find(p, 'w:pPr', 'w:sectPr', 'w:type'), 'w:val');
    if (pageBreak || (find(p, 'w:pPr', 'w:sectPr') && sectionType !== 'continuous')) pushPageBreak();
  }

  const cellParagraphs = (tc, tableCtx) =>
    children(tc, 'w:p').map((p) => {
      const para = paragraphContext(p, tableCtx);
      return { runs: readRuns(p, para, tableCtx).runs, layout: paragraphLayout(para) };
    });

  let tableCount = 0;
  function readTableBlock(tbl) {
    const rows = [];
    for (const tr of children(tbl, 'w:tr')) {
      const cells = children(tr, 'w:tc').map((tc) => cellText(tc, found));
      if (cells.some(Boolean)) rows.push(cells);
    }
    if (rows.length) {
      tableCount += 1;
      blocks.push({ type: 'table', id: `tbl-${tableCount}`, rows, table: readTable(tbl, ctx, cellParagraphs) });
    }
  }

  async function readContainer(node) {
    for (const c of children(node)) {
      if (c.nodeName === 'w:p') await readParagraph(c);
      else if (c.nodeName === 'w:tbl') readTableBlock(c);
      else if (c.nodeName === 'w:sdt') await readContainer(child(c, 'w:sdtContent'));
      else if (c.nodeName === 'w:customXml') await readContainer(c);
    }
  }

  await readContainer(body);
  // A break or blank line with nothing after it doesn't start a page.
  while (blocks.length && (blocks[blocks.length - 1].type === 'pageBreak' || isBlank(blocks[blocks.length - 1]))) blocks.pop();

  // Default header and footer of the last section, for the preview.
  async function headerFooter(tag) {
    const ref = children(sectPr, tag).find((r) => (attr(r, 'w:type') || 'default') === 'default');
    const target = ref && rels.get(attr(ref, 'r:id'))?.target;
    const root = target && (await readXml(zip, target));
    if (!root) return null;
    const paragraphs = children(root, 'w:p')
      .map((p) => {
        const para = paragraphContext(p, ctx);
        return { runs: readRuns(p, para, ctx).runs, layout: paragraphLayout(para) };
      })
      .filter((p) => p.runs.some((r) => r.text.trim() || r.field));
    return paragraphs.length ? paragraphs : null;
  }
  const header = await headerFooter('w:headerReference');
  const footer = await headerFooter('w:footerReference');
  if (header || footer) found.headersFooters = true;

  const pageBorder = readPageBorder(child(sectPr, 'w:pgBorders') || findDeep(body, 'w:pgBorders'), meta.page.margins);

  return { blocks, images, meta, found, header, footer, pageBorder };
}
