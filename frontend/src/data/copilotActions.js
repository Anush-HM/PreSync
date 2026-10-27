import { getSlidesArray, slideMapToPlain } from './yjsClient.js';
import { addBlock, deleteSlide, insertSlide, newId, updateBlocks, updateSlide } from './deckOps.js';
import { CANVAS_HEIGHT, CANVAS_WIDTH, slideTitle } from './slideFormat.js';
import { assetToBlock, getAsset } from './assetLibrary.js';
import { applyPatchesToPlain, buildOutlineSlide, getLayout, layoutPatches } from './copilotLayouts.js';

// Turns a Copilot action (validated on the server, see backend
// src/ai/actions.js) into a preview and, once the user confirms, into
// edits made with the editor's own Y.Doc operations. Every edit runs in
// one transaction tagged COPILOT_ORIGIN, so it reaches collaborators
// atomically, autosaves like any edit, and is a single undo step.
// Before applying, each action is checked again against the document as
// it is now: if the text it rewrites changed, or a block it targets is
// gone, the action is refused instead of overwriting someone's edit.

export const COPILOT_ORIGIN = 'presync-copilot';

// Keep in step with ACTION_TYPES in backend/src/ai/actions.js.
export const ACTION_TYPES = [
  'suggest_text',
  'replace_selected_text',
  'suggest_title',
  'create_outline',
  'generate_speaker_notes',
  'suggest_layout',
  'suggest_asset',
  'create_table',
  'analyze_layout'
];

export const ACTION_LABELS = {
  suggest_text: 'Suggested text',
  replace_selected_text: 'Replace selection',
  suggest_title: 'Slide title',
  create_outline: 'Presentation outline',
  generate_speaker_notes: 'Speaker notes',
  suggest_layout: 'Layout',
  suggest_asset: 'Visuals',
  create_table: 'Table',
  analyze_layout: 'Design check'
};

export class ActionError extends Error {}

function plainSlides(doc) {
  return getSlidesArray(doc).toArray().map(slideMapToPlain);
}

// The slide an action means now: by the id recorded when it was asked
// (slides may have moved since), else by its index.
export function resolveSlideIndex(slides, action, snapshot, fallbackIdx) {
  const idx = Number.isInteger(action.slideIndex) ? action.slideIndex : fallbackIdx;
  const id = snapshot?.slideIds?.[idx];
  if (id) {
    const now = slides.findIndex((s) => s.id === id);
    if (now >= 0) return now;
    throw new ActionError('The slide this suggestion was for has been deleted.');
  }
  if (idx === null || idx === undefined || !slides[idx]) throw new ActionError('That slide no longer exists.');
  return idx;
}

// --- text helpers ------------------------------------------------------

const chars = (s) => Array.from(s || '');
const nonBreaks = (arr) => arr.filter((c) => c !== '\n').length;

// Keeps character formatting outside a replaced range. Style indices
// count characters but not line breaks (Fabric's format); start/end
// count every character.
export function spliceStyles(styles, text, start, end, insert) {
  if (!Array.isArray(styles) || !styles.length) return null;
  const all = chars(text);
  const s = nonBreaks(all.slice(0, start));
  const removed = nonBreaks(all.slice(start, end));
  const added = nonBreaks(chars(insert));
  const shift = added - removed;
  const out = [];
  for (const r of styles) {
    if (r.end <= s) out.push(r);
    else if (r.start >= s + removed) out.push({ ...r, start: r.start + shift, end: r.end + shift });
    else {
      if (r.start < s) out.push({ ...r, end: s });
      if (r.end > s + removed) out.push({ ...r, start: s + added, end: r.end + shift });
    }
  }
  return out.filter((r) => r.end > r.start).length ? out.filter((r) => r.end > r.start) : null;
}

// When a block's text is replaced whole, character formatting can only
// carry over if it was one style across the entire text.
function carryStyles(styles, oldText, newText) {
  if (!Array.isArray(styles) || !styles.length) return null;
  const len = nonBreaks(chars(oldText));
  const first = JSON.stringify(styles[0].style);
  const uniform = styles.every((r) => JSON.stringify(r.style) === first);
  const covered = styles.reduce((n, r) => n + (r.end - r.start), 0) >= len;
  if (!uniform || !covered) return null;
  const n = nonBreaks(chars(newText));
  return n ? [{ start: 0, end: n, style: styles[0].style }] : null;
}

function findTitle(slide) {
  return slide.blocks.find((b) => b.role === 'title') || null;
}

// A free spot for a new block: below the lowest text, else near the top.
function freeY(slide, height) {
  const bottom = slide.blocks
    .filter((b) => b.role !== 'decor')
    .reduce((m, b) => Math.max(m, (b.y || 0) + (b.height || (b.fontSize || 16) * 1.4 * Math.max(1, (b.text || '').split('\n').length))), 0);
  const y = Math.round(bottom + 24);
  return y + height <= CANVAS_HEIGHT - 20 ? y : Math.max(20, CANVAS_HEIGHT - 20 - height);
}

export function buildTableBlock(table, slide) {
  const rows = table.rows;
  const cols = Math.max(...rows.map((r) => r.length));
  const width = Math.min(CANVAS_WIDTH - 160, Math.max(320, cols * 160));
  const colW = Math.round((width / cols) * 10) / 10;
  const rowH = 34;
  const border = { color: '#c9cfca', width: 1 };
  const height = rows.length * rowH;
  const title = findTitle(slide);
  const top = title ? Math.round((title.y || 0) + (title.fontSize || 32) * 1.6 + 20) : 120;
  const y = top + height <= CANVAS_HEIGHT - 20 ? top : Math.max(20, CANVAS_HEIGHT - 20 - height);
  const tableRows = rows.map((r, ri) => {
    const header = table.headerRow && ri === 0;
    return {
      height: rowH,
      cells: Array.from({ length: cols }, (_, ci) => ({
        text: r[ci] || '',
        fontSize: 14,
        ...(header && { fontWeight: 'bold' }),
        fill: header ? '#ffffff' : '#1a1a2e',
        background: header ? '#285C43' : ri % 2 ? '#f3f7f2' : '#ffffff',
        verticalAlign: 'middle',
        padding: [4, 8, 4, 8],
        borders: { top: border, bottom: border, left: border, right: border }
      }))
    };
  });
  return {
    id: newId('b'),
    type: 'table',
    x: Math.round((CANVAS_WIDTH - width) / 2),
    y,
    width,
    height,
    fontSize: 14,
    text: tableRows.map((r) => r.cells.map((c) => c.text).join('\t')).join('\n'),
    table: { columns: Array(cols).fill(colW), rows: tableRows }
  };
}

// --- preview -------------------------------------------------------------

// What the change will look like, computed from the document as it is
// now. Returns { error } when the action can no longer apply.
export function previewAction(action, { slides, activeIdx, snapshot }) {
  try {
    switch (action.type) {
      case 'replace_selected_text': {
        const sel = snapshot?.selection;
        if (!sel) throw new ActionError('Select the text again and ask once more; this suggestion is from an earlier session.');
        const idx = slides.findIndex((s) => s.id === sel.slideId);
        const block = slides[idx]?.blocks.find((b) => b.id === sel.blockId);
        if (!block) throw new ActionError('The text box this was for has been deleted.');
        if ((block.text || '') !== sel.fullText) throw new ActionError('This text was edited after you asked. Ask again for a fresh suggestion.');
        const partial = Number.isInteger(sel.start) && Number.isInteger(sel.end) && sel.end > sel.start;
        const before = partial ? chars(sel.fullText).slice(sel.start, sel.end).join('') : sel.fullText;
        return { kind: 'text', slideIndex: idx, before, after: action.text };
      }
      case 'suggest_text': {
        const idx = resolveSlideIndex(slides, action, snapshot, activeIdx);
        return { kind: 'text', slideIndex: idx, after: action.text };
      }
      case 'suggest_title': {
        const idx = resolveSlideIndex(slides, action, snapshot, activeIdx);
        const title = findTitle(slides[idx]);
        return { kind: 'text', slideIndex: idx, before: title?.text || '', after: action.title };
      }
      case 'generate_speaker_notes': {
        const idx = resolveSlideIndex(slides, action, snapshot, activeIdx);
        const before = slides[idx].notes || '';
        const after = action.notesMode === 'append' && before.trim() ? `${before.trimEnd()}\n\n${action.notes}` : action.notes;
        return { kind: 'text', slideIndex: idx, before, after };
      }
      case 'suggest_layout': {
        const idx = resolveSlideIndex(slides, action, snapshot, activeIdx);
        if (!getLayout(action.layoutId)) throw new ActionError('That layout is not available in this editor.');
        const patches = layoutPatches(slides[idx], action.layoutId);
        return { kind: 'slide', slideIndex: idx, before: slides[idx], after: applyPatchesToPlain(slides[idx], patches), layout: getLayout(action.layoutId) };
      }
      case 'analyze_layout': {
        const idx = snapshot?.activeSlideId ? slides.findIndex((s) => s.id === snapshot.activeSlideId) : action.slideIndex ?? activeIdx;
        if (idx < 0 || !slides[idx]) throw new ActionError('The slide this check was for has been deleted.');
        const ids = new Set(slides[idx].blocks.map((b) => b.id));
        const fixes = (action.fixes || []).filter((f) => ids.has(f.blockId));
        const patches = fixes.map(({ blockId, ...patch }) => ({ blockId, patch }));
        return { kind: 'slide', slideIndex: idx, before: slides[idx], after: patches.length ? applyPatchesToPlain(slides[idx], patches) : null, fixes };
      }
      case 'create_table': {
        const idx = resolveSlideIndex(slides, action, snapshot, activeIdx);
        return { kind: 'table', slideIndex: idx, rows: action.table.rows, headerRow: action.table.headerRow };
      }
      case 'suggest_asset': {
        const idx = resolveSlideIndex(slides, action, snapshot, activeIdx);
        const assets = (action.assetIds || []).map(getAsset).filter(Boolean);
        if (!assets.length) throw new ActionError('None of these assets are in the PreSync library.');
        return { kind: 'assets', slideIndex: idx, assets };
      }
      case 'create_outline':
        return { kind: 'outline', slides: action.slides, title: action.title };
      default:
        throw new ActionError('PreSync does not support this kind of change.');
    }
  } catch (err) {
    if (err instanceof ActionError) return { error: err.message };
    throw err;
  }
}

// --- apply -----------------------------------------------------------------

function transact(doc, fn) {
  let result;
  doc.transact(() => {
    result = fn();
  }, COPILOT_ORIGIN);
  return result;
}

// Applies an action to the shared document. `options`:
//   snapshot   – from snapshotFor() at request time
//   activeIdx  – the slide the user is on now
//   assetId    – for suggest_asset, which asset to insert
//   outline    – for create_outline, the (possibly edited) slides
//   insertAt   – for create_outline, where the new slides go
//   themeId    – for create_outline, colours
//   replaceBlank – for create_outline, replace an untouched blank deck
// Returns { slideIndex } – the slide to show afterwards.
export async function applyAction(doc, action, options = {}) {
  if (!doc) throw new ActionError('The editor is not connected yet.');
  if (!ACTION_TYPES.includes(action.type)) throw new ActionError('PreSync does not support this kind of change.');
  const slides = plainSlides(doc);
  const { snapshot, activeIdx = 0 } = options;
  const preview = action.type === 'create_outline' ? null : previewAction(action, { slides, activeIdx, snapshot });
  if (preview?.error) throw new ActionError(preview.error);

  switch (action.type) {
    case 'replace_selected_text': {
      const sel = snapshot.selection;
      const idx = preview.slideIndex;
      const block = slides[idx].blocks.find((b) => b.id === sel.blockId);
      const partial = Number.isInteger(sel.start) && Number.isInteger(sel.end) && sel.end > sel.start;
      const all = chars(block.text);
      const text = partial ? [...all.slice(0, sel.start), ...chars(action.text), ...all.slice(sel.end)].join('') : action.text;
      const styles = partial ? spliceStyles(block.styles, block.text, sel.start, sel.end, action.text) : carryStyles(block.styles, block.text, action.text);
      transact(doc, () => updateBlocks(doc, idx, [block.id], { text, styles }));
      return { slideIndex: idx };
    }
    case 'suggest_text': {
      const idx = preview.slideIndex;
      const lines = action.text.split('\n').length;
      const block = { id: newId('b'), type: 'textbox', x: 80, width: 640, fontSize: 18, text: action.text };
      block.y = freeY(slides[idx], lines * 24);
      transact(doc, () => addBlock(doc, idx, block));
      return { slideIndex: idx, blockId: block.id };
    }
    case 'suggest_title': {
      const idx = preview.slideIndex;
      const title = findTitle(slides[idx]);
      transact(doc, () => {
        if (title) updateBlocks(doc, idx, [title.id], { text: action.title, styles: carryStyles(title.styles, title.text, action.title) });
        else addBlock(doc, idx, { id: newId('b'), type: 'textbox', role: 'title', x: 80, y: 50, width: 800, fontSize: 36, fontWeight: 'bold', text: action.title });
      });
      return { slideIndex: idx };
    }
    case 'generate_speaker_notes': {
      transact(doc, () => updateSlide(doc, preview.slideIndex, { notes: preview.after }));
      return { slideIndex: preview.slideIndex };
    }
    case 'suggest_layout':
    case 'analyze_layout': {
      const patches = action.type === 'suggest_layout'
        ? layoutPatches(slides[preview.slideIndex], action.layoutId)
        : preview.fixes.map(({ blockId, ...patch }) => ({ blockId, patch }));
      if (!patches.length) throw new ActionError('There is nothing on this slide to change.');
      transact(doc, () => patches.forEach((p) => updateBlocks(doc, preview.slideIndex, [p.blockId], p.patch)));
      return { slideIndex: preview.slideIndex };
    }
    case 'create_table': {
      const block = buildTableBlock(action.table, slides[preview.slideIndex]);
      transact(doc, () => addBlock(doc, preview.slideIndex, block));
      return { slideIndex: preview.slideIndex, blockId: block.id };
    }
    case 'suggest_asset': {
      const asset = getAsset(options.assetId || action.assetIds?.[0]);
      if (!asset || !(action.assetIds || []).includes(asset.id)) throw new ActionError('That asset is not in the PreSync library.');
      const block = await assetToBlock(asset, { id: newId('b'), x: CANVAS_WIDTH - 220, y: CANVAS_HEIGHT - 220, size: 160 });
      // The document may have changed while the picture was prepared.
      const idx = resolveSlideIndex(plainSlides(doc), action, snapshot, activeIdx);
      transact(doc, () => addBlock(doc, idx, block));
      return { slideIndex: idx, blockId: block.id };
    }
    case 'create_outline': {
      const entries = (options.outline || action.slides || []).filter((s) => s.title?.trim());
      if (!entries.length) throw new ActionError('The outline has no slides to create.');
      // Existing slides are never overwritten; the only exception is the
      // untouched blank starter slide, and only when the user asked.
      const replaceBlank = !!options.replaceBlank && isBlankStarterDeck(slides);
      const at = replaceBlank ? 0 : Math.min(Math.max(0, options.insertAt ?? slides.length), slides.length);
      const built = entries.map((entry, i) => buildOutlineSlide(entry, { order: at + i, themeId: options.themeId, isFirst: at === 0 && i === 0 }));
      transact(doc, () => {
        built.forEach((slide, i) => insertSlide(doc, at + i, slide));
        if (replaceBlank) deleteSlide(doc, built.length);
      });
      return { slideIndex: at, created: built.length };
    }
    default:
      throw new ActionError('PreSync does not support this kind of change.');
  }
}

// True when the deck is still just the blank starter slide, which the
// outline workflow may replace (only when the user ticks the option).
export function isBlankStarterDeck(slides) {
  if (slides.length !== 1) return false;
  const [s] = slides;
  const texts = s.blocks.map((b) => (b.text || '').trim()).filter(Boolean);
  return !s.notes && s.blocks.every((b) => (b.type || 'textbox') === 'textbox') && texts.every((t) => t === 'New slide' || t === 'Click to add text');
}

export function describeSlide(slides, idx) {
  return idx >= 0 && slides[idx] ? `Slide ${idx + 1}: ${slideTitle(slides[idx], idx)}` : 'Unknown slide';
}
