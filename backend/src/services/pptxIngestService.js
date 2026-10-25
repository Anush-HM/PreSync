import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import path from 'path';

// Extracts editable content from a .pptx (Office Open XML) deck: every
// text shape becomes a textbox block with its position, size, font,
// weight, style, colour and alignment; pictures become image blocks;
// slide background colours and speaker notes carry over. Output matches
// extractSlidesFromPdf so both formats feed the same Deck model.
//
// Not extracted: tables, charts, SmartArt, video, and per-run formatting
// inside one shape (a block takes its first run's formatting). Slides
// with nothing extractable are flagged needsImageFallback.

const TARGET_WIDTH = 960;
const TARGET_HEIGHT = 540;
const EMU_PER_POINT = 12700;
// Imported images are stored inline as data URLs, so keep them bounded
// to stay well inside Mongo's 16MB document limit.
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

// Default font sizes (points) when neither the shape nor its layout says.
const PLACEHOLDER_FONT_PT = { title: 40, ctrTitle: 44, subTitle: 24, body: 20 };
const DEFAULT_FONT_PT = 18;
const ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };

export class PptxParseError extends Error {}

// --- tiny DOM helpers (namespace-agnostic, by qualified tag name) ------

function children(node, tag) {
  const out = [];
  if (!node) return out;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && (!tag || c.nodeName === tag)) out.push(c);
  }
  return out;
}

function child(node, tag) {
  return children(node, tag)[0] || null;
}

// Follows a path of tag names, e.g. find(sp, 'p:spPr', 'a:xfrm', 'a:off').
function find(node, ...tags) {
  let cur = node;
  for (const tag of tags) {
    cur = child(cur, tag);
    if (!cur) return null;
  }
  return cur;
}

function attr(node, name) {
  return node?.getAttribute(name) || null;
}

function num(node, name) {
  const v = attr(node, name);
  return v === null ? null : Number(v);
}

function parseXml(text) {
  return new DOMParser({ onError: () => {} }).parseFromString(text, 'text/xml').documentElement;
}

// --- package helpers ----------------------------------------------------

async function readXml(zip, partPath) {
  const file = zip.file(partPath);
  if (!file) return null;
  return parseXml(await file.async('string'));
}

// Relationships for a part, as Map(rId -> absolute part path).
async function readRels(zip, partPath) {
  const relsPath = path.posix.join(path.posix.dirname(partPath), '_rels', `${path.posix.basename(partPath)}.rels`);
  const root = await readXml(zip, relsPath);
  const rels = new Map();
  if (!root) return rels;
  for (const rel of children(root, 'Relationship')) {
    if (attr(rel, 'TargetMode') === 'External') continue;
    const target = attr(rel, 'Target');
    const resolved = target.startsWith('/')
      ? target.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(partPath), target));
    rels.set(attr(rel, 'Id'), { target: resolved, type: attr(rel, 'Type') || '' });
  }
  return rels;
}

function relOfType(rels, suffix) {
  for (const rel of rels.values()) if (rel.type.endsWith(suffix)) return rel.target;
  return null;
}

// --- colours --------------------------------------------------------------

async function readThemeColors(zip, masterPath) {
  const colors = {};
  if (!masterPath) return colors;
  const themePath = relOfType(await readRels(zip, masterPath), '/theme');
  const theme = themePath && (await readXml(zip, themePath));
  const scheme = theme && find(theme, 'a:themeElements', 'a:clrScheme');
  for (const c of children(scheme)) {
    const name = c.nodeName.replace(/^a:/, '');
    const srgb = child(c, 'a:srgbClr');
    const sys = child(c, 'a:sysClr');
    const val = attr(srgb, 'val') || attr(sys, 'lastClr');
    if (val) colors[name] = `#${val.toLowerCase()}`;
  }
  // Standard aliases used by shapes and backgrounds.
  colors.tx1 = colors.dk1;
  colors.bg1 = colors.lt1;
  colors.tx2 = colors.dk2;
  colors.bg2 = colors.lt2;
  return colors;
}

function colorOf(fillParent, theme) {
  const solid = child(fillParent, 'a:solidFill');
  if (!solid) return null;
  const srgb = child(solid, 'a:srgbClr');
  if (srgb) return `#${attr(srgb, 'val').toLowerCase()}`;
  const scheme = child(solid, 'a:schemeClr');
  if (scheme) return theme[attr(scheme, 'val')] || null;
  const sys = child(solid, 'a:sysClr');
  if (sys && attr(sys, 'lastClr')) return `#${attr(sys, 'lastClr').toLowerCase()}`;
  return null;
}

function isHexColor(v) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v);
}

// --- placeholders (layout/master inheritance) ----------------------------

function placeholderOf(sp) {
  const ph = find(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph') || find(sp, 'p:nvPicPr', 'p:nvPr', 'p:ph');
  if (!ph) return null;
  return { type: attr(ph, 'type') || 'body', idx: attr(ph, 'idx') };
}

// Index a layout/master's placeholder shapes so slide shapes that omit
// their own position or font size can inherit them.
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

// The master's default text style for a kind of shape (lvl1 only).
function masterTextStyle(master, ph) {
  const styles = master && find(master, 'p:txStyles');
  if (!styles) return null;
  const name = !ph ? 'p:otherStyle' : ['title', 'ctrTitle'].includes(ph.type) ? 'p:titleStyle' : 'p:bodyStyle';
  return find(styles, name, 'a:lvl1pPr');
}

function xfrmOf(sp) {
  const xfrm = find(sp, 'p:spPr', 'a:xfrm') || find(sp, 'p:grpSpPr', 'a:xfrm');
  const off = child(xfrm, 'a:off');
  const ext = child(xfrm, 'a:ext');
  if (!off || !ext) return null;
  return { x: num(off, 'x'), y: num(off, 'y'), cx: num(ext, 'cx'), cy: num(ext, 'cy') };
}

// First explicit font size (hundredths of a point) on a shape's text,
// looking at runs, then paragraph end marks, then the list style.
function fontSizeOf(sp) {
  const body = child(sp, 'p:txBody');
  if (!body) return null;
  for (const p of children(body, 'a:p')) {
    for (const r of children(p, 'a:r')) {
      const sz = num(child(r, 'a:rPr'), 'sz');
      if (sz) return sz / 100;
    }
    const end = num(child(p, 'a:endParaRPr'), 'sz');
    if (end) return end / 100;
  }
  const lvl1 = find(body, 'a:lstStyle', 'a:lvl1pPr', 'a:defRPr');
  const sz = num(lvl1, 'sz');
  return sz ? sz / 100 : null;
}

// --- text ---------------------------------------------------------------

function paragraphText(p) {
  let text = '';
  for (const c of children(p)) {
    if (c.nodeName === 'a:r' || c.nodeName === 'a:fld') text += child(c, 'a:t')?.textContent || '';
    else if (c.nodeName === 'a:br') text += '\n';
  }
  return text;
}

// Paragraph-level defaults a shape inherits: its own list style, then
// each inherited placeholder's, then the master text style.
function inheritedParagraphStyles(sp, chain, masterStyle) {
  return [sp, ...chain]
    .map((shape) => find(shape, 'p:txBody', 'a:lstStyle', 'a:lvl1pPr'))
    .concat(masterStyle)
    .filter(Boolean);
}

function textFormatting(sp, pStyles, theme) {
  const body = child(sp, 'p:txBody');
  const paragraphs = children(body, 'a:p');
  const firstRun = paragraphs.flatMap((p) => children(p, 'a:r'))[0];
  const rPrs = [child(firstRun, 'a:rPr'), ...pStyles.map((ps) => child(ps, 'a:defRPr'))].filter(Boolean);
  const pPrs = [paragraphs.map((p) => child(p, 'a:pPr')).find((x) => attr(x, 'algn')), ...pStyles].filter(Boolean);
  const firstAttr = (nodes, name) => nodes.map((n) => attr(n, name)).find((v) => v !== null) ?? null;

  const fmt = {};
  const b = firstAttr(rPrs, 'b');
  if (b === '1' || b === 'true') fmt.fontWeight = 'bold';
  const i = firstAttr(rPrs, 'i');
  if (i === '1' || i === 'true') fmt.fontStyle = 'italic';
  const u = firstAttr(rPrs, 'u');
  if (u && u !== 'none') fmt.underline = true;
  const fill = rPrs.map((r) => colorOf(r, theme)).find(Boolean);
  if (isHexColor(fill)) fmt.fill = fill;
  const typeface = rPrs.map((r) => attr(child(r, 'a:latin'), 'typeface')).find(Boolean);
  if (typeface && !typeface.startsWith('+')) fmt.fontFamily = typeface;
  const algn = ALIGN[firstAttr(pPrs, 'algn')];
  if (algn && algn !== 'left') fmt.textAlign = algn;
  return fmt;
}

// --- shapes -------------------------------------------------------------

// Maps EMU coordinates (after any group transforms) onto the editor canvas.
function makeMapper(slideCx, slideCy) {
  const scale = Math.min(TARGET_WIDTH / slideCx, TARGET_HEIGHT / slideCy);
  const offsetX = (TARGET_WIDTH - slideCx * scale) / 2;
  const offsetY = (TARGET_HEIGHT - slideCy * scale) / 2;
  return {
    box: ({ x, y, cx, cy }) => ({
      x: Math.round(x * scale + offsetX),
      y: Math.round(y * scale + offsetY),
      width: Math.round(cx * scale),
      height: Math.round(cy * scale)
    }),
    // Points -> canvas px: 1pt is 12700 EMU on the slide.
    fontPx: (pt) => Math.max(6, Math.round(pt * EMU_PER_POINT * scale))
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
    x: num(off, 'x') + (b.x - num(chOff, 'x')) * sx,
    y: num(off, 'y') + (b.y - num(chOff, 'y')) * sy,
    cx: b.cx * sx,
    cy: b.cy * sy
  });
  return (b) => parentTransform(local(b));
}

async function extractSlide(zip, slidePath, slideIndex, ctx) {
  const root = await readXml(zip, slidePath);
  if (!root) throw new PptxParseError(`Missing slide part ${slidePath}`);
  const rels = await readRels(zip, slidePath);

  const layoutPath = relOfType(rels, '/slideLayout');
  const layout = layoutPath && (await readXml(zip, layoutPath));
  const masterPath = layoutPath && relOfType(await readRels(zip, layoutPath), '/slideMaster');
  const master = masterPath && (ctx.masters.get(masterPath) || (await readXml(zip, masterPath)));
  if (masterPath) ctx.masters.set(masterPath, master);
  if (masterPath && !ctx.themes.has(masterPath)) ctx.themes.set(masterPath, await readThemeColors(zip, masterPath));
  const theme = (masterPath && ctx.themes.get(masterPath)) || {};
  const phIndexes = [indexPlaceholders(layout), indexPlaceholders(master)];

  const blocks = [];
  let blockN = 0;
  const nextId = () => `s${slideIndex}-b${blockN++}`;

  async function walk(tree, transform) {
    for (const node of children(tree)) {
      if (node.nodeName === 'p:grpSp') {
        await walk(node, groupTransform(node, transform));
      } else if (node.nodeName === 'p:sp') {
        const block = textBlock(node, transform);
        if (block) blocks.push(block);
      } else if (node.nodeName === 'p:pic') {
        const block = await imageBlock(node, transform);
        if (block) blocks.push(block);
      }
    }
  }

  function textBlock(sp, transform) {
    const body = child(sp, 'p:txBody');
    if (!body) return null;
    const text = children(body, 'a:p').map(paragraphText).join('\n').replace(/\s+$/, '');
    if (!text.trim()) return null;

    const ph = placeholderOf(sp);
    const chain = ph ? inheritedPlaceholders(phIndexes, ph) : [];
    const xfrm = [sp, ...chain].map(xfrmOf).find(Boolean);
    if (!xfrm) return null;
    const box = ctx.map.box(transform(xfrm));
    const pStyles = inheritedParagraphStyles(sp, chain, masterTextStyle(master, ph));
    const styleSize = pStyles.map((ps) => num(child(ps, 'a:defRPr'), 'sz')).find(Boolean);
    const pt =
      fontSizeOf(sp) || (styleSize && styleSize / 100) || PLACEHOLDER_FONT_PT[ph?.type] || DEFAULT_FONT_PT;

    return {
      id: nextId(),
      type: 'textbox',
      x: box.x,
      y: box.y,
      width: Math.max(40, box.width),
      fontSize: ctx.map.fontPx(pt),
      text,
      ...textFormatting(sp, pStyles, theme)
    };
  }

  async function imageBlock(pic, transform) {
    const rId = attr(find(pic, 'p:blipFill', 'a:blip'), 'r:embed');
    const target = rId && rels.get(rId)?.target;
    const ext = target && path.posix.extname(target).slice(1).toLowerCase();
    const xfrm = xfrmOf(pic);
    if (!target || !IMAGE_MIME[ext] || !xfrm) return null;
    const file = zip.file(target);
    if (!file) return null;
    const data = await file.async('nodebuffer');
    if (data.length > MAX_IMAGE_BYTES || ctx.imageBytes + data.length > MAX_TOTAL_IMAGE_BYTES) {
      ctx.skippedImages += 1;
      return null;
    }
    ctx.imageBytes += data.length;
    const box = ctx.map.box(transform(xfrm));
    return {
      id: nextId(),
      type: 'image',
      x: box.x,
      y: box.y,
      width: Math.max(1, box.width),
      height: Math.max(1, box.height),
      fontSize: 16,
      text: '',
      imageUrl: `data:${IMAGE_MIME[ext]};base64,${data.toString('base64')}`
    };
  }

  await walk(find(root, 'p:cSld', 'p:spTree'), (b) => b);

  // Background: the slide's own, else its layout's, else its master's.
  let backgroundColor = null;
  for (const part of [root, layout, master]) {
    const bgPr = part && find(part, 'p:cSld', 'p:bg', 'p:bgPr');
    const bgRef = part && find(part, 'p:cSld', 'p:bg', 'p:bgRef');
    backgroundColor = colorOf(bgPr, theme) || (bgRef && theme[attr(child(bgRef, 'a:schemeClr'), 'val')]) || null;
    if (backgroundColor) break;
  }

  // Speaker notes live in the notes slide's body placeholder.
  let notes = '';
  const notesPath = relOfType(rels, '/notesSlide');
  const notesRoot = notesPath && (await readXml(zip, notesPath));
  if (notesRoot) {
    for (const sp of children(find(notesRoot, 'p:cSld', 'p:spTree'), 'p:sp')) {
      if (placeholderOf(sp)?.type !== 'body') continue;
      notes = children(child(sp, 'p:txBody'), 'a:p').map(paragraphText).join('\n').trim();
      break;
    }
  }

  const slide = {
    id: `slide-${slideIndex + 1}`,
    order: slideIndex,
    blocks,
    notes,
    needsImageFallback: blocks.length === 0
  };
  if (isHexColor(backgroundColor) && backgroundColor !== '#ffffff') slide.backgroundColor = backgroundColor;
  return slide;
}

// Main entry point: given a .pptx as a Buffer, returns slides in the
// same shape as extractSlidesFromPdf.
export async function extractSlidesFromPptx(buffer) {
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
    masters: new Map(),
    themes: new Map(),
    imageBytes: 0,
    skippedImages: 0
  };

  const slides = [];
  for (let i = 0; i < slidePaths.length; i++) {
    slides.push(await extractSlide(zip, slidePaths[i], i, ctx));
  }
  return slides;
}
