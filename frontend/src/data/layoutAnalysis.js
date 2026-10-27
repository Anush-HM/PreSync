import { CANVAS_HEIGHT, CANVAS_WIDTH, DEFAULT_SLIDE_BACKGROUND, DEFAULT_TEXT_COLOR, primaryFont } from './slideFormat.js';

// Deterministic design checks for one slide, from the geometry and
// formatting the editor actually has. Text heights come from the live
// canvas (`measured`, block id → { height }); when a block wasn't
// measured, checks that need its height are skipped rather than guessed.
// Each finding may carry fixes ({ blockId, x?, y?, width?, fontSize? })
// the editor can apply as-is.

const ALIGN_TOLERANCE = 8; // px: edges this close are probably meant to line up
const MIN_FONT = 12;
const MAX_WORDS = 90;
const MAX_FONTS = 3;
const MARGIN = 24;

const isText = (b) => (b.type || 'textbox') === 'textbox';

function heightOf(block, measured) {
  const m = measured?.get?.(block.id) ?? measured?.[block.id];
  if (m && Number.isFinite(m.height)) return m.height;
  if (!isText(block) && Number.isFinite(block.height)) return block.height;
  return null;
}

function rectOf(block, measured) {
  const h = heightOf(block, measured);
  if (h === null) return null;
  return { x: block.x || 0, y: block.y || 0, w: block.width || 0, h };
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const label = (b) => {
  const t = (b.text || '').replace(/\s+/g, ' ').trim();
  if (b.role === 'title') return 'the title';
  if (t) return `"${t.length > 28 ? `${t.slice(0, 28)}…` : t}"`;
  return `the ${b.type || 'text'} block`;
};

export function analyzeSlideLayout(slide, { measured } = {}) {
  const findings = [];
  const blocks = (slide?.blocks || []).filter((b) => b.role !== 'decor');
  const hasMeasurements = !!measured && (measured.size ?? Object.keys(measured).length) > 0;

  // Off the slide, or overflowing its bottom edge.
  for (const b of blocks) {
    const r = rectOf(b, measured);
    const right = (b.x || 0) + (b.width || 0);
    const offH = (b.x || 0) < -2 || right > CANVAS_WIDTH + 2;
    const offV = (b.y || 0) < -2 || (r && r.y + r.h > CANVAS_HEIGHT + 2);
    if (!offH && !offV) continue;
    const fix = { blockId: b.id };
    if (offH) {
      const width = Math.min(b.width || 0, CANVAS_WIDTH - 2 * MARGIN);
      fix.width = width;
      fix.x = Math.min(Math.max(MARGIN, b.x || 0), CANVAS_WIDTH - MARGIN - width);
    }
    if (offV && r) {
      if (r.h <= CANVAS_HEIGHT - 2 * MARGIN) fix.y = Math.min(Math.max(MARGIN, r.y), CANVAS_HEIGHT - MARGIN - r.h);
      else if (isText(b)) fix.fontSize = Math.max(MIN_FONT, Math.floor((b.fontSize || 16) * ((CANVAS_HEIGHT - 2 * MARGIN) / r.h)));
    }
    findings.push({
      kind: isText(b) && offV && r && r.y + r.h > CANVAS_HEIGHT ? 'text-overflow' : 'off-slide',
      severity: 'warning',
      blockIds: [b.id],
      message: isText(b) && offV && r && r.y + r.h > CANVAS_HEIGHT ? `${label(b)} runs past the bottom of the slide.` : `${label(b)} extends past the edge of the slide.`,
      fixes: Object.keys(fix).length > 1 ? [fix] : []
    });
  }

  // Text that no longer fits the fixed-height box it is anchored in.
  for (const b of blocks.filter(isText)) {
    const h = measured?.get?.(b.id)?.height ?? measured?.[b.id]?.height;
    if (b.verticalAlign && b.height && Number.isFinite(h) && h > b.height + 4) {
      findings.push({ kind: 'text-overflow', severity: 'warning', blockIds: [b.id], message: `${label(b)} is taller than its text box.`, fixes: [] });
    }
  }

  // Overlapping text, or text sitting on top of a picture.
  const rects = blocks.map((b) => ({ b, r: rectOf(b, measured) })).filter((x) => x.r);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const { b: a, r: ra } = rects[i];
      const { b: c, r: rc } = rects[j];
      if (!isText(a) && !isText(c)) continue;
      if (a.type === 'shape' || c.type === 'shape') continue; // text on a shape is usually intended
      const area = overlapArea(ra, rc);
      const smaller = Math.min(ra.w * ra.h, rc.w * rc.h) || 1;
      if (area / smaller < 0.15) continue;
      findings.push({ kind: 'overlap', severity: 'warning', blockIds: [a.id, c.id], message: `${label(a)} overlaps ${label(c)}.`, fixes: [] });
    }
  }

  // Left edges that almost, but don't quite, line up: group edges within
  // a few pixels of each other and snap each group to one edge (the
  // title's if it is in the group, else the most common one).
  const texts = blocks.filter(isText);
  const fixes = [];
  const sorted = [...texts].sort((a, b) => (a.x || 0) - (b.x || 0));
  const groups = [];
  for (const b of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.round(b.x || 0) - Math.round(g[0].x || 0) <= ALIGN_TOLERANCE) g.push(b);
    else groups.push([b]);
  }
  for (const g of groups) {
    const xs = g.map((b) => Math.round(b.x || 0));
    if (new Set(xs).size < 2) continue;
    const title = g.find((b) => b.role === 'title');
    const counts = new Map();
    xs.forEach((x) => counts.set(x, (counts.get(x) || 0) + 1));
    const anchor = title ? Math.round(title.x || 0) : [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    g.forEach((b, i) => {
      if (xs[i] !== anchor) fixes.push({ blockId: b.id, x: anchor });
    });
  }
  if (fixes.length) {
    findings.push({
      kind: 'alignment',
      severity: 'info',
      blockIds: fixes.map((f) => f.blockId),
      message: `${fixes.length === 1 ? 'A text block is' : `${fixes.length} text blocks are`} a few pixels off the left edge of the others.`,
      fixes
    });
  }

  // Readability: small type, too many fonts, too many words, contrast.
  const small = texts.filter((b) => (b.fontSize || 16) < MIN_FONT && (b.text || '').trim());
  if (small.length) {
    findings.push({
      kind: 'small-text',
      severity: 'info',
      blockIds: small.map((b) => b.id),
      message: `${small.length === 1 ? 'One text block uses' : `${small.length} text blocks use`} type smaller than ${MIN_FONT}px, which is hard to read when presented.`,
      fixes: small.map((b) => ({ blockId: b.id, fontSize: MIN_FONT + 2 }))
    });
  }
  const fonts = new Set(texts.map((b) => primaryFont(b.fontFamily || 'Public Sans')));
  if (fonts.size > MAX_FONTS) {
    findings.push({ kind: 'font-mix', severity: 'info', blockIds: [], message: `This slide mixes ${fonts.size} fonts (${[...fonts].join(', ')}). Two is usually enough.`, fixes: [] });
  }
  const words = texts.reduce((n, b) => n + (b.text || '').split(/\s+/).filter(Boolean).length, 0);
  if (words > MAX_WORDS) {
    findings.push({ kind: 'dense', severity: 'info', blockIds: [], message: `The slide has about ${words} words. Consider moving detail into speaker notes.`, fixes: [] });
  }
  if (!slide?.backgroundImageUrl && !slide?.backgroundGradient) {
    const bg = slide?.backgroundColor || DEFAULT_SLIDE_BACKGROUND;
    const low = texts.filter((b) => (b.text || '').trim() && contrastRatio(b.fill || DEFAULT_TEXT_COLOR, bg) < 3);
    if (low.length) {
      findings.push({ kind: 'contrast', severity: 'warning', blockIds: low.map((b) => b.id), message: `${low.length === 1 ? 'One text block has' : `${low.length} text blocks have`} low contrast against the slide background.`, fixes: [] });
    }
  }

  return { measured: hasMeasurements, findings };
}

// All the fixes a report suggests, merged per block.
export function collectFixes(report) {
  const byId = new Map();
  for (const f of report.findings) for (const fix of f.fixes || []) byId.set(fix.blockId, { ...(byId.get(fix.blockId) || {}), ...fix });
  return [...byId.values()];
}
