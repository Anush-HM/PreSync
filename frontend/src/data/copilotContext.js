import { slideTitle } from './slideFormat.js';
import { analyzeSlideLayout } from './layoutAnalysis.js';
import { searchAssets } from './assetLibrary.js';
import { LAYOUTS } from './copilotLayouts.js';

// Collects what the Copilot needs to know about the editor for one
// request, and no more: the active slide in detail, the selection, and
// for whole-deck questions the slides most related to the request
// (others only by title). The server trims this again (ai/context.js).

const DECK_BUDGET = 20000; // characters of slide text for deck-wide requests
const FULL_SLIDES = 8; // slides sent in full besides the active one
const ABRIDGED_CHARS = 160;
const MAX_ASSETS = 40;

const isText = (b) => (b.type || 'textbox') === 'textbox';

export function slideText(slide) {
  return (slide?.blocks || [])
    .filter((b) => b.role !== 'decor')
    .map((b) => (b.type === 'table' || isText(b) ? b.text : ''))
    .filter((t) => t && t.trim())
    .join('\n');
}

function terms(text) {
  return new Set((text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3));
}

// Slides ranked by word overlap with the request; ties keep deck order.
export function rankSlides(slides, query) {
  const q = terms(query);
  return slides
    .map((s, index) => {
      const words = terms(slideText(s));
      let score = 0;
      q.forEach((w) => {
        if (words.has(w)) score += 1;
      });
      return { index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

function blockSummary(b, measured) {
  const out = {
    id: b.id,
    type: b.type || 'textbox',
    role: b.role,
    text: b.type === 'image' ? undefined : b.text,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    fontSize: isText(b) ? b.fontSize : undefined,
    fontFamily: isText(b) ? b.fontFamily : undefined,
    fontWeight: b.fontWeight,
    fill: b.fill
  };
  const m = measured?.get?.(b.id);
  if (m && Number.isFinite(m.height)) out.measuredHeight = Math.round(m.height);
  if (b.type === 'table' && b.table) out.tableSize = { rows: b.table.rows?.length || 0, columns: b.table.columns?.length || 0 };
  return out;
}

// What a request about `message` is aimed at, given what is selected.
export function defaultScope({ textSelection, selectedIds }) {
  return textSelection || selectedIds?.length ? 'selection' : 'slide';
}

export function buildCopilotContext({
  deckTitle,
  slides,
  activeIdx,
  selectedIds = [],
  textSelection = null,
  scope,
  message = '',
  measured = null,
  includeAssets = true
}) {
  const active = slides[activeIdx];
  const effectiveScope = scope === 'selection' && !textSelection && !selectedIds.length ? 'slide' : scope;
  const ctx = {
    deckTitle,
    scope: effectiveScope,
    slideCount: slides.length,
    activeSlide: null,
    selection: null,
    slides: [],
    truncated: false,
    layoutReport: null,
    assets: [],
    layouts: LAYOUTS.map(({ id, name, description }) => ({ id, name, description }))
  };
  if (!active) return ctx;

  ctx.activeSlide = {
    index: activeIdx,
    title: slideTitle(active, activeIdx),
    notes: active.notes || '',
    background: active.backgroundColor,
    hasBackgroundImage: !!active.backgroundImageUrl,
    blocks: active.blocks.map((b) => blockSummary(b, measured))
  };

  if (effectiveScope === 'selection') {
    if (textSelection && active.blocks.some((b) => b.id === textSelection.blockId)) {
      ctx.selection = { blockIds: [textSelection.blockId], blockId: textSelection.blockId, text: textSelection.text, start: textSelection.start, end: textSelection.end };
    } else {
      const chosen = active.blocks.filter((b) => selectedIds.includes(b.id));
      const textual = chosen.filter((b) => isText(b) || b.type === 'table');
      ctx.selection = {
        blockIds: chosen.map((b) => b.id),
        blockId: textual[0]?.id || chosen[0]?.id || null,
        text: textual.map((b) => b.text || '').join('\n\n')
      };
    }
  }

  // Deck outline: every slide by title; full text for the slides that
  // matter to this request (and the active slide's neighbours).
  if (effectiveScope === 'deck') {
    const wanted = new Set([activeIdx - 1, activeIdx + 1]);
    rankSlides(slides, message)
      .filter((r) => r.score > 0)
      .slice(0, FULL_SLIDES)
      .forEach((r) => wanted.add(r.index));
    // Short decks go in whole.
    const total = slides.reduce((n, s) => n + slideText(s).length, 0);
    let budget = DECK_BUDGET;
    slides.forEach((s, index) => {
      if (index === activeIdx) {
        ctx.slides.push({ index, title: slideTitle(s, index) });
        return;
      }
      const text = slideText(s);
      const full = total <= DECK_BUDGET || wanted.has(index);
      const piece = full ? text : text.slice(0, ABRIDGED_CHARS);
      const fits = piece.length <= budget;
      budget -= fits ? piece.length : 0;
      const abridged = !fits || piece.length < text.length;
      if (abridged) ctx.truncated = true;
      ctx.slides.push({ index, title: slideTitle(s, index), text: fits ? piece : '', ...(abridged && { abridged: true }) });
    });
  } else {
    // Titles only, so "slide 4" in a request means something.
    ctx.slides = slides.map((s, index) => ({ index, title: slideTitle(s, index) }));
  }

  ctx.layoutReport = analyzeSlideLayout(active, { measured });
  ctx.layoutReport.findings = ctx.layoutReport.findings.map(({ kind, severity, blockIds, message: m }) => ({ kind, severity, blockIds, message: m }));

  if (includeAssets) {
    // Assets relevant to the request or the slide; the model may only
    // recommend from this list.
    const query = `${message} ${ctx.activeSlide.title}`;
    let assets = searchAssets(query, { limit: MAX_ASSETS });
    if (assets.length < 12) assets = [...assets, ...searchAssets(ctx.deckTitle || '', { limit: MAX_ASSETS })].filter((a, i, all) => all.indexOf(a) === i);
    ctx.assets = assets.slice(0, MAX_ASSETS).map(({ id, name, kind, category, tags }) => ({ id, name, kind, category, tags }));
  }
  return ctx;
}

// The ids of every slide at request time, so actions that name a slide
// by index still find it if slides are moved before the user applies.
export function snapshotFor(slides, activeIdx, ctx, textSelection) {
  const active = slides[activeIdx];
  const blockId = ctx.selection?.blockId;
  const block = active?.blocks.find((b) => b.id === blockId);
  return {
    slideIds: slides.map((s) => s.id),
    activeSlideId: active?.id,
    selection: block
      ? {
          slideId: active.id,
          blockId,
          fullText: block.text || '',
          start: textSelection?.blockId === blockId ? textSelection.start : null,
          end: textSelection?.blockId === blockId ? textSelection.end : null
        }
      : null
  };
}
