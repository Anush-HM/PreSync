import JSZip from 'jszip';
import path from 'path';
import { attr, child, children, find, readRels, readXml } from './ooxml.js';
import { extractSlidesFromPptx, paragraphText, placeholderOf } from './pptxIngestService.js';
import { analyzeSlides } from './documentAnalysis.js';

const IMPORTABLE_PICTURE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);

function countDeep(node, test) {
  let n = 0;
  for (const c of children(node)) {
    if (test(c)) n += 1;
    n += countDeep(c, test);
  }
  return n;
}

// Per-slide facts the slide extractor doesn't report: the title
// placeholder's text and what kinds of unsupported content are present.
async function slideDetails(zip, slidePath) {
  const root = await readXml(zip, slidePath);
  if (!root) return {};
  const rels = await readRels(zip, slidePath);
  const tree = find(root, 'p:cSld', 'p:spTree');

  let title = null;
  (function findTitle(node) {
    for (const c of children(node)) {
      if (title) return;
      if (c.nodeName === 'p:grpSp') findTitle(c);
      if (c.nodeName !== 'p:sp') continue;
      const ph = placeholderOf(c);
      if (ph?.type !== 'title' && ph?.type !== 'ctrTitle') continue;
      const text = children(child(c, 'p:txBody'), 'a:p').map(paragraphText).join(' ').replace(/\s+/g, ' ').trim();
      if (text) title = text;
    }
  })(tree);

  const graphicUris = [];
  countDeep(tree, (c) => {
    if (c.nodeName === 'a:graphicData') graphicUris.push(attr(c, 'uri') || '');
    return false;
  });

  let skippedPictures = 0;
  let importablePictures = 0;
  countDeep(tree, (c) => {
    if (c.nodeName !== 'p:pic') return false;
    const rId = attr(find(c, 'p:blipFill', 'a:blip'), 'r:embed');
    const target = rId && rels.get(rId)?.target;
    const ext = target && path.posix.extname(target).slice(1).toLowerCase();
    if (target && !IMPORTABLE_PICTURE.has(ext)) skippedPictures += 1;
    else if (target) importablePictures += 1;
    return false;
  });

  return {
    title,
    tables: graphicUris.filter((u) => u.endsWith('/table')).length,
    charts: graphicUris.filter((u) => u.endsWith('/chart') || u.includes('chartex')).length,
    smartArt: graphicUris.some((u) => u.endsWith('/diagram')),
    media: countDeep(tree, (c) => c.nodeName === 'a:videoFile' || c.nodeName === 'a:audioFile' || c.nodeName === 'p14:media') > 0,
    animations: countDeep(child(root, 'p:timing'), (c) => c.nodeName === 'p:par') > 0,
    transition: !!child(root, 'p:transition'),
    skippedPictures,
    importablePictures
  };
}

// Extracts a .pptx and analyses its structure. Returns
// { slides, analysis, outline } where slides are ready for a Deck.
export async function analyzePptx(buffer, fileName) {
  const report = {};
  const { slides, canvasWidth, canvasHeight } = await extractSlidesFromPptx(buffer, report);

  const zip = await JSZip.loadAsync(buffer);
  const presentationPath = 'ppt/presentation.xml';
  const presentation = await readXml(zip, presentationPath);
  const rels = await readRels(zip, presentationPath);
  const slidePaths = children(child(presentation, 'p:sldIdLst'), 'p:sldId')
    .map((s) => rels.get(attr(s, 'r:id'))?.target)
    .filter(Boolean);
  const details = [];
  for (const p of slidePaths) details.push(await slideDetails(zip, p));

  const core = await readXml(zip, 'docProps/core.xml');
  const coreTitle = (core && child(core, 'dc:title')?.textContent?.trim()) || null;

  // Pictures the extractor dropped for size show up as fewer image
  // blocks than importable pictures on that slide.
  details.forEach((d, i) => {
    const kept = (slides[i]?.blocks || []).filter((b) => b.type === 'image').length;
    d.skippedPictures = (d.skippedPictures || 0) + Math.max(0, (d.importablePictures || 0) - kept);
  });

  const packageWarnings = [];
  if (details.some((d) => d.animations || d.transition)) {
    packageWarnings.push('Animations and slide transitions are not imported.');
  }
  if (Object.keys(zip.files).some((f) => f.startsWith('ppt/fonts/'))) {
    packageWarnings.push('Embedded fonts are not imported; text uses the closest available font.');
  }
  packageWarnings.push(...report.warnings.filter((w) => !/^Some (charts could not|SmartArt has no)/.test(w)));

  const { analysis, outline } = analyzeSlides(slides, {
    kind: 'pptx',
    fileName,
    coreTitle: coreTitle && !/^PowerPoint Presentation$/i.test(coreTitle) ? coreTitle : null,
    details,
    packageWarnings
  });
  return { slides, analysis, outline, canvasWidth, canvasHeight };
}
