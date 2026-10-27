import JSZip from 'jszip';
import path from 'path';
import { attr, child, children, find, readRels, readXml } from './ooxml.js';

// Reads a Word (.docx) document into an ordered list of content blocks:
// title, subtitle, headings (with level), paragraphs, lists (with
// nesting and bullet/number type), tables (cell text) and pictures.
// Pure parsing only; turning blocks into an outline lives in
// documentAnalysis.js.
//
// Not read: headers, footers, footnotes, comments, text boxes,
// equations, charts and SmartArt. Their presence is reported in
// `warnings` so the user knows what was left out.

export class DocxParseError extends Error {}

const EMU_PER_PX = 9525;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

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
  return { text: text.replace(/[ \t]+$/gm, '').trim(), pictures };
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

// --- main entry -------------------------------------------------------------

// Returns { blocks, images, meta, found } where
//   blocks: [{ type: 'title'|'subtitle'|'heading'|'paragraph'|'list'|'table'|'image', ... }]
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

  const styles = readStyles(await readXml(zip, 'word/styles.xml'));
  const numbering = readNumbering(await readXml(zip, 'word/numbering.xml'));
  const rels = await readRels(zip, docPath);

  const core = await readXml(zip, 'docProps/core.xml');
  const app = await readXml(zip, 'docProps/app.xml');
  const meta = {
    title: (core && child(core, 'dc:title')?.textContent?.trim()) || null,
    pages: Number(app && child(app, 'Pages')?.textContent) || null,
    words: Number(app && child(app, 'Words')?.textContent) || null
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
    if (!IMAGE_MIME[ext]) {
      found.unsupportedImages += 1;
      return null;
    }
    const file = zip.file(target);
    if (!file) return null;
    const data = await file.async('nodebuffer');
    if (data.length > MAX_IMAGE_BYTES || imageBytes + data.length > MAX_TOTAL_IMAGE_BYTES) {
      found.skippedImages += 1;
      return null;
    }
    imageBytes += data.length;
    const image = {
      id: `img-${images.length + 1}`,
      mime: IMAGE_MIME[ext],
      dataUrl: `data:${IMAGE_MIME[ext]};base64,${data.toString('base64')}`,
      widthPx: pic.widthPx,
      heightPx: pic.heightPx
    };
    images.push(image);
    imageByTarget.set(target, image.id);
    return image.id;
  }

  async function readParagraph(p) {
    const styleId = attr(find(p, 'w:pPr', 'w:pStyle'), 'w:val');
    const style = (styleId && styles.get(styleId)) || { kind: null, level: null };
    const outline = attr(find(p, 'w:pPr', 'w:outlineLvl'), 'w:val');
    const numPr = find(p, 'w:pPr', 'w:numPr');
    const { text, pictures } = readParagraphContent(p, found);

    if (text) {
      if (style.kind === 'title') blocks.push({ type: 'title', text });
      else if (style.kind === 'subtitle') blocks.push({ type: 'subtitle', text });
      else if (style.kind === 'heading') blocks.push({ type: 'heading', level: Math.min(style.level, 6), text });
      else if (outline !== null && Number(outline) < 9) blocks.push({ type: 'heading', level: Number(outline) + 1, text });
      else if (numPr || style.kind === 'list') {
        // Numbering set on the paragraph wins over numbering from its style.
        const numId = attr(child(numPr, 'w:numId'), 'w:val') ?? style.numId;
        const ilvl = attr(child(numPr, 'w:ilvl'), 'w:val');
        const level = Math.min(ilvl !== null ? Number(ilvl) : style.level || 0, 4);
        if (numId !== '0') {
          const ordered = numbering.get(numId)?.get(level) ?? style.ordered ?? false;
          const prev = blocks[blocks.length - 1];
          const item = { text, level, ordered };
          // Consecutive items of the same list stay together; a deeper
          // item right after a list is nested in it.
          if (prev && prev === lastList && (lastListNumId === numId || level > 0)) prev.items.push(item);
          else {
            lastList = { type: 'list', items: [item] };
            lastListNumId = numId;
            blocks.push(lastList);
          }
        } else {
          blocks.push({ type: 'paragraph', text });
        }
      } else {
        blocks.push({ type: 'paragraph', text });
      }
    }

    for (const pic of pictures) {
      const imageId = await loadPicture(pic);
      if (imageId) blocks.push({ type: 'image', imageId });
    }
  }

  function readTable(tbl) {
    const rows = [];
    for (const tr of children(tbl, 'w:tr')) {
      const cells = children(tr, 'w:tc').map((tc) => cellText(tc, found));
      if (cells.some(Boolean)) rows.push(cells);
    }
    if (rows.length) blocks.push({ type: 'table', rows });
  }

  async function readContainer(node) {
    for (const c of children(node)) {
      if (c.nodeName === 'w:p') await readParagraph(c);
      else if (c.nodeName === 'w:tbl') readTable(c);
      else if (c.nodeName === 'w:sdt') await readContainer(child(c, 'w:sdtContent'));
      else if (c.nodeName === 'w:customXml') await readContainer(c);
    }
  }

  await readContainer(body);

  if (zip.file('word/header1.xml') || zip.file('word/footer1.xml')) found.headersFooters = true;

  return { blocks, images, meta, found };
}
