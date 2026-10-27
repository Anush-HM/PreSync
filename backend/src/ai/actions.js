// The Copilot's reply format and the editor actions it may propose.
// The model fills RESPONSE_SCHEMA; validateResponse then checks every
// action against the editor context the request was made with and
// drops anything the editor could not apply as described. Actions are
// proposals: the browser previews them and the user applies them
// through the editor's own Yjs operations (frontend/src/data/copilotActions.js).

import { LIMITS } from './context.js';

// Keep in step with ACTION_TYPES in frontend/src/data/copilotActions.js.
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

export const GROUNDING = ['document', 'general', 'mixed', 'none'];

const CANVAS_W = 960;
const CANVAS_H = 540;
const MAX_ACTIONS = 6;

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const STRING = { type: 'string' };
const INT = { type: 'integer' };
const NUMBER = { type: 'number' };

const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false
});

// Every action shares one flat shape so the schema stays within what
// structured outputs accept; fields an action type doesn't use are null.
const ACTION_SCHEMA = obj({
  type: { type: 'string', enum: ACTION_TYPES },
  summary: STRING,
  slideIndex: nullable(INT),
  blockId: nullable(STRING),
  text: nullable(STRING),
  title: nullable(STRING),
  notes: nullable(STRING),
  notesMode: nullable({ type: 'string', enum: ['replace', 'append'] }),
  layoutId: nullable(STRING),
  assetIds: nullable({ type: 'array', items: STRING }),
  table: nullable(obj({ headerRow: { type: 'boolean' }, rows: { type: 'array', items: { type: 'array', items: STRING } } })),
  slides: nullable({
    type: 'array',
    items: obj({ title: STRING, bullets: { type: 'array', items: STRING }, notes: STRING, layoutId: nullable(STRING) })
  }),
  fixes: nullable({
    type: 'array',
    items: obj({ blockId: STRING, x: nullable(NUMBER), y: nullable(NUMBER), width: nullable(NUMBER), fontSize: nullable(NUMBER) })
  })
});

export const RESPONSE_SCHEMA = obj({
  reply: STRING,
  grounding: { type: 'string', enum: GROUNDING },
  slideRefs: { type: 'array', items: INT },
  actions: { type: 'array', items: ACTION_SCHEMA }
});

function text(value, max) {
  if (typeof value !== 'string') return '';
  const t = value.trim();
  return t.length > max ? t.slice(0, max) : t;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// Slide indices are 0-based everywhere the model sees them.
function slideIndexOf(value, ctx, fallback) {
  const count = Math.max(1, ctx.slideCount);
  if (Number.isInteger(value) && value >= 0 && value < count) return value;
  return fallback;
}

function validateAction(a, ctx, reject) {
  if (!a || typeof a !== 'object' || !ACTION_TYPES.includes(a.type)) return reject('unknown action type');
  const summary = text(a.summary, 500);
  const active = ctx.activeSlide;
  const activeIdx = active ? active.index : null;
  const blockIds = new Set((active?.blocks || []).map((b) => b.id));
  const layoutIds = new Set(ctx.layouts.map((l) => l.id));
  const assetIds = new Set(ctx.assets.map((x) => x.id));
  const base = { type: a.type, summary };

  switch (a.type) {
    case 'suggest_text': {
      const t = text(a.text, 4000);
      if (!t) return reject('suggest_text without text');
      return { ...base, text: t, slideIndex: slideIndexOf(a.slideIndex, ctx, activeIdx) };
    }
    case 'replace_selected_text': {
      const sel = ctx.selection;
      if (!sel) return reject('replace_selected_text without a selection');
      const target = sel.blockId || sel.blockIds[0];
      if (a.blockId && a.blockId !== target && !sel.blockIds.includes(a.blockId)) return reject('replace_selected_text for a block that is not selected');
      const t = text(a.text, 4000);
      if (!t) return reject('replace_selected_text without text');
      return { ...base, slideIndex: activeIdx, blockId: a.blockId && sel.blockIds.includes(a.blockId) ? a.blockId : target, text: t };
    }
    case 'suggest_title': {
      const t = text(a.title ?? a.text, LIMITS.title);
      if (!t) return reject('suggest_title without a title');
      const idx = slideIndexOf(a.slideIndex, ctx, activeIdx);
      if (idx === null) return reject('suggest_title without a slide');
      return { ...base, title: t.replace(/\s*\n\s*/g, ' '), slideIndex: idx };
    }
    case 'create_outline': {
      const slides = (Array.isArray(a.slides) ? a.slides : []).slice(0, 30).map((s) => ({
        title: text(s?.title, LIMITS.title).replace(/\s*\n\s*/g, ' '),
        bullets: (Array.isArray(s?.bullets) ? s.bullets : []).slice(0, 8).map((b) => text(b, 300)).filter(Boolean),
        notes: text(s?.notes, 2000),
        layoutId: s?.layoutId && layoutIds.has(s.layoutId) ? s.layoutId : null
      })).filter((s) => s.title);
      if (!slides.length) return reject('create_outline without slides');
      return { ...base, title: text(a.title, LIMITS.title) || null, slides };
    }
    case 'generate_speaker_notes': {
      const notes = text(a.notes ?? a.text, 5000);
      if (!notes) return reject('generate_speaker_notes without notes');
      const idx = slideIndexOf(a.slideIndex, ctx, activeIdx);
      if (idx === null) return reject('generate_speaker_notes without a slide');
      return { ...base, slideIndex: idx, notes, notesMode: a.notesMode === 'append' ? 'append' : 'replace' };
    }
    case 'suggest_layout': {
      if (!layoutIds.has(a.layoutId)) return reject('suggest_layout with a layout the editor does not have');
      const idx = slideIndexOf(a.slideIndex, ctx, activeIdx);
      if (idx === null) return reject('suggest_layout without a slide');
      return { ...base, slideIndex: idx, layoutId: a.layoutId };
    }
    case 'suggest_asset': {
      const ids = [...new Set((Array.isArray(a.assetIds) ? a.assetIds : []).filter((id) => assetIds.has(id)))].slice(0, 8);
      if (!ids.length) return reject('suggest_asset without any available asset');
      return { ...base, slideIndex: slideIndexOf(a.slideIndex, ctx, activeIdx), assetIds: ids };
    }
    case 'create_table': {
      const rows = (Array.isArray(a.table?.rows) ? a.table.rows : [])
        .slice(0, 20)
        .map((r) => (Array.isArray(r) ? r.slice(0, 8).map((c) => text(c, 300)) : []))
        .filter((r) => r.length);
      if (!rows.length) return reject('create_table without rows');
      const cols = Math.max(...rows.map((r) => r.length));
      const padded = rows.map((r) => [...r, ...Array(cols - r.length).fill('')]);
      return { ...base, slideIndex: slideIndexOf(a.slideIndex, ctx, activeIdx), table: { headerRow: a.table.headerRow !== false, rows: padded } };
    }
    case 'analyze_layout': {
      const fixes = (Array.isArray(a.fixes) ? a.fixes : [])
        .filter((f) => f && blockIds.has(f.blockId))
        .slice(0, 20)
        .map((f) => {
          const fix = { blockId: f.blockId };
          if (Number.isFinite(f.x)) fix.x = Math.round(clamp(f.x, 0, CANVAS_W - 20));
          if (Number.isFinite(f.y)) fix.y = Math.round(clamp(f.y, 0, CANVAS_H - 10));
          if (Number.isFinite(f.width)) fix.width = Math.round(clamp(f.width, 20, CANVAS_W));
          if (Number.isFinite(f.fontSize)) fix.fontSize = Math.round(clamp(f.fontSize, 8, 120));
          return fix;
        })
        .filter((f) => Object.keys(f).length > 1);
      if (!summary && !fixes.length) return reject('analyze_layout with nothing to report');
      return { ...base, slideIndex: activeIdx, fixes };
    }
    default:
      return reject('unsupported action');
  }
}

// Checks a model reply against the schema and the request's context.
// Returns the reply with only the actions that passed, and how many were
// dropped (so the panel can say so instead of hiding it).
export function validateResponse(raw, ctx) {
  const reply = text(raw?.reply, 8000);
  const grounding = GROUNDING.includes(raw?.grounding) ? raw.grounding : 'none';
  const slideRefs = [...new Set((Array.isArray(raw?.slideRefs) ? raw.slideRefs : []).filter((n) => Number.isInteger(n) && n >= 0 && n < ctx.slideCount))].slice(0, 20);
  const rejected = [];
  const actions = [];
  for (const a of (Array.isArray(raw?.actions) ? raw.actions : []).slice(0, MAX_ACTIONS)) {
    let reason = null;
    const valid = validateAction(a, ctx, (r) => {
      reason = r;
      return null;
    });
    if (valid) actions.push(valid);
    else rejected.push(reason);
  }
  if (!reply && !actions.length) {
    return { reply: 'I could not produce a usable answer for that. Try rephrasing the request.', grounding: 'none', slideRefs: [], actions: [], rejected };
  }
  return { reply, grounding, slideRefs, actions, rejected };
}
