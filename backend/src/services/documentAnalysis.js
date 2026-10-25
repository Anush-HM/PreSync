// Deterministic structure analysis for imported files, and conversion of
// a reviewed outline into PreSync slides. No AI is involved: every
// title, key point and slide boundary here comes from the document's own
// headings, lists, paragraphs and slide text.

export const MAX_BULLETS_PER_SLIDE = 6;
const MAX_BULLET_CHARS = 160;
const MAX_NOTES_CHARS = 4000;
const MAX_KEY_POINTS = 8;
const PARAGRAPHS_PER_UNHEADED_SLIDE = 4;

const CANVAS_W = 960;
const CANVAS_H = 540;
const BODY_TEXT_COLOR = '#2b302d';
const MUTED_TEXT_COLOR = '#5b635e';

// --- text helpers -----------------------------------------------------------

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:]+$/, '')}…`;
}

// A long paragraph becomes its first sentence; a short one stays whole.
export function condense(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_BULLET_CHARS) return clean;
  const first = clean.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)[0];
  return truncate(first, MAX_BULLET_CHARS);
}

function firstWords(text, max = 60) {
  return truncate(text.replace(/\s+/g, ' ').trim().replace(/[.:;]$/, ''), max);
}

function wordCount(text) {
  return (text.match(/\S+/g) || []).length;
}

// --- DOCX -------------------------------------------------------------------

// The heading level that marks a slide boundary: the shallowest level
// used more than once. A lone top heading at the very start is treated
// as the document title instead.
function pickSplitLevel(blocks) {
  const headings = blocks.filter((b) => b.type === 'heading');
  if (headings.length === 0) return { splitLevel: null, titleHeading: null };
  const counts = new Map();
  headings.forEach((h) => counts.set(h.level, (counts.get(h.level) || 0) + 1));
  const levels = [...counts.keys()].sort((a, b) => a - b);
  const top = levels[0];
  const firstContent = blocks.find((b) => b.type !== 'title' && b.type !== 'subtitle');
  if (counts.get(top) === 1 && levels.length > 1 && firstContent === headings[0]) {
    return { splitLevel: levels[1], titleHeading: headings[0] };
  }
  return { splitLevel: top, titleHeading: null };
}

function tableBullets(rows) {
  const [head, ...rest] = rows;
  const out = [];
  if (rest.length === 0) {
    out.push({ text: condense(head.filter(Boolean).join(' · ')), level: 0 });
    return out;
  }
  out.push({ text: condense(head.filter(Boolean).join(' · ')), level: 0 });
  rest.slice(0, 4).forEach((r) => out.push({ text: condense(r.filter(Boolean).join(' · ')), level: 1 }));
  if (rest.length > 4) out.push({ text: `…and ${rest.length - 4} more rows`, level: 1 });
  return out;
}

function blockPlainText(b) {
  if (b.type === 'list') return b.items.map((i) => `${'  '.repeat(i.level)}- ${i.text}`).join('\n');
  if (b.type === 'table') return b.rows.map((r) => r.join(' | ')).join('\n');
  if (b.type === 'image') return '';
  return b.text;
}

// Splits a section's points across as many slides as it needs.
function sectionToOutline(section, nextId) {
  const items = [];
  const points = section.points.length ? section.points : [];
  const chunks = [];
  for (let i = 0; i < points.length; i += MAX_BULLETS_PER_SLIDE) chunks.push(points.slice(i, i + MAX_BULLETS_PER_SLIDE));
  if (chunks.length === 0) chunks.push([]);
  const notes = truncate(section.notes.filter(Boolean).join('\n\n'), MAX_NOTES_CHARS);
  chunks.forEach((bullets, i) => {
    items.push({
      id: nextId(),
      layout: 'content',
      title: i === 0 ? section.title : `${section.title} (continued)`,
      bullets,
      notes: i === 0 ? notes : '',
      imageId: i === 0 ? section.images[0] || null : null,
      source: section.source
    });
  });
  return items;
}

export function analyzeDocx(parsed, fileName) {
  const { blocks, images, meta, found } = parsed;
  if (!blocks.some((b) => b.type !== 'image')) {
    const err = new Error('The document has no readable text');
    err.status = 422;
    throw err;
  }

  const fallbackTitle = fileName.replace(/\.docx$/i, '');
  const titleBlock = blocks.find((b) => b.type === 'title');
  const subtitleBlock = blocks.find((b) => b.type === 'subtitle');
  const { splitLevel, titleHeading } = pickSplitLevel(blocks);
  const title = titleBlock?.text || meta.title || titleHeading?.text || fallbackTitle;

  // Group blocks into sections at the split level.
  const sections = [];
  let current = null;
  let underSubheading = false;
  let unheadedCount = 0;
  const startSection = (sectionTitle, source) => {
    current = { title: sectionTitle, points: [], notes: [], images: [], subtopics: [], tables: 0, source };
    sections.push(current);
    underSubheading = false;
    unheadedCount = 0;
  };

  blocks.forEach((b, index) => {
    if (b.type === 'title' || b.type === 'subtitle' || b === titleHeading) return;
    if (b.type === 'heading' && splitLevel !== null && b.level <= splitLevel) {
      startSection(b.text, { heading: b.text, level: b.level, blockIndex: index });
      return;
    }
    if (!current) {
      startSection(splitLevel === null ? firstWords(blockPlainText(b) || title) : 'Introduction', { heading: null, level: null, blockIndex: index });
    }
    // Documents without headings: start a new slide every few paragraphs.
    if (splitLevel === null && b.type === 'paragraph') {
      if (unheadedCount >= PARAGRAPHS_PER_UNHEADED_SLIDE) startSection(firstWords(b.text), { heading: null, level: null, blockIndex: index });
      unheadedCount += 1;
    }

    const base = underSubheading ? 1 : 0;
    switch (b.type) {
      case 'heading':
        current.points.push({ text: condense(b.text), level: 0 });
        current.subtopics.push(b.text);
        underSubheading = true;
        break;
      case 'paragraph':
        current.points.push({ text: condense(b.text), level: base });
        current.notes.push(b.text);
        break;
      case 'list':
        b.items.forEach((item) => current.points.push({ text: condense(item.text), level: Math.min(base + item.level, 2) }));
        current.notes.push(blockPlainText(b));
        break;
      case 'table':
        tableBullets(b.rows).forEach((p) => current.points.push({ ...p, level: Math.min(p.level + base, 2) }));
        current.notes.push(blockPlainText(b));
        current.tables += 1;
        break;
      case 'image':
        current.images.push(b.imageId);
        break;
      default:
        break;
    }
  });

  let n = 0;
  const nextId = () => `o${++n}`;
  const outline = [
    {
      id: nextId(),
      layout: 'title',
      title,
      subtitle: subtitleBlock?.text || '',
      bullets: [],
      notes: '',
      imageId: null,
      source: { heading: null, level: null, blockIndex: 0 }
    },
    ...sections.flatMap((s) => sectionToOutline(s, nextId))
  ];

  const headings = blocks
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.type === 'heading')
    .map(({ b, index }) => ({ level: b.level, text: b.text, blockIndex: index, startsSlide: splitLevel !== null && b.level <= splitLevel && b !== titleHeading }));

  const keyPoints = sections
    .map((s) => s.points.find((p) => p.level === 0 && !s.subtopics.includes(p.text))?.text || s.points[0]?.text)
    .filter(Boolean)
    .slice(0, MAX_KEY_POINTS);

  const listItems = blocks.filter((b) => b.type === 'list').reduce((sum, b) => sum + b.items.length, 0);
  const paragraphs = blocks.filter((b) => b.type === 'paragraph');
  const tables = blocks.filter((b) => b.type === 'table').length;
  const words = meta.words || blocks.reduce((sum, b) => sum + wordCount(blockPlainText(b)), 0);

  const warnings = [];
  if (splitLevel === null) warnings.push('No headings were found, so slides were split every few paragraphs. Review the outline before generating.');
  if (tables) warnings.push(`${tables} table${tables === 1 ? ' was' : 's were'} converted to text bullets; PreSync slides do not support tables yet.`);
  if (found.unsupportedImages) warnings.push(`${found.unsupportedImages} picture${found.unsupportedImages === 1 ? ' is' : 's are'} in a format PreSync cannot show (only PNG, JPEG and GIF are imported).`);
  if (found.skippedImages) warnings.push(`${found.skippedImages} picture${found.skippedImages === 1 ? ' was' : 's were'} skipped for size (1.5 MB each, 8 MB per document).`);
  if (found.charts) warnings.push('Charts are not imported.');
  if (found.smartArt) warnings.push('SmartArt diagrams are not imported.');
  if (found.equations) warnings.push('Equations are not imported.');
  if (found.textBoxes) warnings.push('Text inside text boxes is not imported.');
  if (found.footnotes) warnings.push('Footnotes and endnotes are not imported.');
  if (found.comments) warnings.push('Comments are not imported.');
  if (found.trackedChanges) warnings.push('The document has tracked changes; they were read as if accepted.');
  if (found.headersFooters) warnings.push('Headers and footers are not imported.');

  return {
    analysis: {
      kind: 'docx',
      title,
      pageCount: meta.pages,
      slideCount: null,
      stats: {
        headings: headings.length,
        paragraphs: paragraphs.length,
        listItems,
        tables,
        images: images.length,
        words
      },
      headings,
      majorTopics: sections.map((s) => s.title),
      keyPoints,
      sections: sections.map((s) => ({
        title: s.title,
        subtopics: s.subtopics,
        points: s.points.length,
        tables: s.tables,
        images: s.images.length,
        blockIndex: s.source.blockIndex
      })),
      suggestedSlides: outline.length,
      warnings
    },
    outline
  };
}

// --- PPTX / PDF -------------------------------------------------------------

function slideTitleFromBlocks(slide) {
  const text = (slide.blocks || []).filter((b) => b.type !== 'image' && b.text?.trim());
  if (text.length === 0) return null;
  // Largest text, then the highest on the slide.
  const best = [...text].sort((a, b) => (b.fontSize || 0) - (a.fontSize || 0) || (a.y || 0) - (b.y || 0))[0];
  return { block: best, text: firstWords(best.text.split('\n')[0], 120) };
}

// details: optional per-slide { title, tables, charts, smartArt, media, ... }
// collected from the .pptx package by pptxAnalysisService.
export function analyzeSlides(slides, { kind, fileName, coreTitle = null, details = [], packageWarnings = [] }) {
  const ext = kind === 'pdf' ? /\.pdf$/i : /\.pptx$/i;
  const slideInfo = slides.map((slide, i) => {
    const d = details[i] || {};
    const guess = slideTitleFromBlocks(slide);
    const title = d.title || guess?.text || null;
    const titleBlockId = d.title ? null : guess?.block.id;
    const bodyLines = (slide.blocks || [])
      .filter((b) => b.type !== 'image' && b.text?.trim() && b.id !== titleBlockId && b.text.trim() !== d.title)
      .flatMap((b) => b.text.split('\n'))
      .map((t) => t.replace(/^[\s•\-–*]+/, '').trim())
      .filter(Boolean);
    const images = (slide.blocks || []).filter((b) => b.type === 'image').length;
    const notSupported = [];
    if (d.tables) notSupported.push(`${d.tables} table${d.tables === 1 ? '' : 's'}`);
    if (d.charts) notSupported.push(`${d.charts} chart${d.charts === 1 ? '' : 's'}`);
    if (d.smartArt) notSupported.push('SmartArt');
    if (d.media) notSupported.push('audio/video');
    if (d.skippedPictures) notSupported.push(`${d.skippedPictures} picture${d.skippedPictures === 1 ? '' : 's'}`);
    return {
      index: i,
      title,
      bodyLines,
      textBlocks: (slide.blocks || []).filter((b) => b.type !== 'image').length,
      images,
      hasNotes: !!slide.notes?.trim(),
      empty: (slide.blocks || []).length === 0,
      notSupported
    };
  });

  let n = 0;
  const nextId = () => `o${++n}`;
  const outline = slideInfo.map((s, i) => {
    const bullets = s.bodyLines.slice(0, MAX_BULLETS_PER_SLIDE).map((t) => ({ text: condense(t), level: 0 }));
    return {
      id: nextId(),
      layout: i === 0 && bullets.length <= 1 ? 'title' : 'content',
      title: s.title || `Slide ${i + 1}`,
      subtitle: i === 0 && bullets.length === 1 ? bullets[0].text : '',
      bullets: i === 0 && bullets.length <= 1 ? [] : bullets,
      notes: truncate([slides[i].notes, s.bodyLines.length > MAX_BULLETS_PER_SLIDE ? s.bodyLines.join('\n') : ''].filter(Boolean).join('\n\n'), MAX_NOTES_CHARS),
      imageId: null,
      source: { slideIndex: i }
    };
  });

  const warnings = [...packageWarnings];
  const emptySlides = slideInfo.filter((s) => s.empty).map((s) => s.index + 1);
  if (emptySlides.length) {
    warnings.push(`${emptySlides.length === 1 ? 'Slide' : 'Slides'} ${emptySlides.join(', ')} had nothing PreSync could extract and will be blank.`);
  }
  const withGaps = slideInfo.filter((s) => s.notSupported.length);
  if (withGaps.length) {
    warnings.push(`Some content is not imported: ${withGaps.map((s) => `slide ${s.index + 1} (${s.notSupported.join(', ')})`).join('; ')}.`);
  }
  if (kind === 'pdf') warnings.push('PDF import keeps text only. Pictures, drawings and page backgrounds are not extracted.');

  const titled = slideInfo.filter((s) => s.title);
  return {
    analysis: {
      kind,
      title: coreTitle || titled[0]?.title || fileName.replace(ext, ''),
      pageCount: kind === 'pdf' ? slides.length : null,
      slideCount: slides.length,
      stats: {
        slides: slides.length,
        textBoxes: slideInfo.reduce((sum, s) => sum + s.textBlocks, 0),
        images: slideInfo.reduce((sum, s) => sum + s.images, 0),
        notes: slideInfo.filter((s) => s.hasNotes).length,
        tables: details.reduce((sum, d) => sum + (d?.tables || 0), 0),
        charts: details.reduce((sum, d) => sum + (d?.charts || 0), 0)
      },
      headings: titled.map((s) => ({ level: 1, text: s.title, slideIndex: s.index, startsSlide: true })),
      majorTopics: titled.map((s) => s.title),
      keyPoints: slideInfo.map((s) => s.bodyLines[0]).filter(Boolean).map(condense).slice(0, MAX_KEY_POINTS),
      slides: slideInfo.map(({ bodyLines, ...rest }) => ({ ...rest, bulletCount: bodyLines.length })),
      suggestedSlides: slides.length,
      warnings
    },
    outline
  };
}

// --- outline -> slides --------------------------------------------------------

const MAX_OUTLINE_ITEMS = 200;
const MAX_BULLETS = 30;
const MAX_TITLE = 300;
const MAX_TEXT = 1000;

// Checks an outline sent back by the client after the user edited it.
// Returns a cleaned copy, or throws with a message for a 400.
export function sanitizeOutline(outline, imageIds = new Set()) {
  if (!Array.isArray(outline) || outline.length === 0) throw new Error('outline must be a non-empty array');
  if (outline.length > MAX_OUTLINE_ITEMS) throw new Error(`outline can have at most ${MAX_OUTLINE_ITEMS} slides`);
  return outline.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`outline[${i}] must be an object`);
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, MAX_TITLE) : '';
    const bullets = Array.isArray(item.bullets) ? item.bullets : [];
    if (bullets.length > MAX_BULLETS) throw new Error(`outline[${i}] has more than ${MAX_BULLETS} bullets`);
    return {
      id: typeof item.id === 'string' && item.id ? item.id.slice(0, 40) : `o${i + 1}`,
      layout: item.layout === 'title' ? 'title' : 'content',
      title,
      subtitle: typeof item.subtitle === 'string' ? item.subtitle.trim().slice(0, MAX_TEXT) : '',
      bullets: bullets
        .map((b) => ({
          text: typeof b?.text === 'string' ? b.text.trim().slice(0, MAX_TEXT) : '',
          level: Math.max(0, Math.min(2, Number.isInteger(b?.level) ? b.level : 0))
        }))
        .filter((b) => b.text),
      notes: typeof item.notes === 'string' ? item.notes.slice(0, MAX_NOTES_CHARS * 2) : '',
      imageId: typeof item.imageId === 'string' && imageIds.has(item.imageId) ? item.imageId : null
    };
  });
}

function fitImage(image, box) {
  const w = image.widthPx || box.width;
  const h = image.heightPx || box.height;
  const scale = Math.min(box.width / w, box.height / h);
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);
  return { x: box.x + Math.round((box.width - width) / 2), y: box.y + Math.round((box.height - height) / 2), width, height };
}

// Builds Deck slides from a (sanitized) outline. Images are looked up by
// id in `images` ([{ id, dataUrl, widthPx, heightPx }]).
export function outlineToSlides(outline, images = []) {
  const imageById = new Map(images.map((img) => [img.id, img]));
  return outline.map((item, i) => {
    const slideId = `slide-${i + 1}`;
    let b = 0;
    const id = () => `${slideId}-b${b++}`;
    const blocks = [];

    if (item.layout === 'title') {
      blocks.push({ id: id(), type: 'textbox', x: 80, y: 180, width: 800, fontSize: 44, fontWeight: 'bold', textAlign: 'center', fill: '#171a19', text: item.title || 'Untitled' });
      if (item.subtitle) {
        blocks.push({ id: id(), type: 'textbox', x: 120, y: 300, width: 720, fontSize: 22, textAlign: 'center', fill: MUTED_TEXT_COLOR, text: item.subtitle });
      }
    } else {
      const image = item.imageId && imageById.get(item.imageId);
      blocks.push({ id: id(), type: 'textbox', x: 60, y: 44, width: 840, fontSize: 32, fontWeight: 'bold', fill: '#171a19', text: item.title || `Slide ${i + 1}` });
      if (item.bullets.length) {
        const dense = item.bullets.length > 5 || item.bullets.some((p) => p.text.length > 110);
        blocks.push({
          id: id(),
          type: 'textbox',
          x: 60,
          y: 124,
          width: image ? 500 : 840,
          fontSize: dense ? 18 : 22,
          lineHeight: 1.35,
          fill: BODY_TEXT_COLOR,
          text: item.bullets.map((p) => `${'    '.repeat(p.level)}${p.level === 0 ? '•' : '–'} ${p.text}`).join('\n')
        });
      }
      if (image) {
        const box = item.bullets.length
          ? { x: 590, y: 124, width: 320, height: 360 }
          : { x: 180, y: 124, width: 600, height: CANVAS_H - 164 };
        blocks.push({ id: id(), type: 'image', fontSize: 16, text: '', imageUrl: image.dataUrl, ...fitImage(image, box) });
      }
    }

    return {
      id: slideId,
      order: i,
      notes: item.notes || '',
      needsImageFallback: false,
      blocks: blocks.map((blk) => ({ ...blk, x: Math.min(blk.x, CANVAS_W - 40) }))
    };
  });
}
