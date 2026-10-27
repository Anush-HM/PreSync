// Editor context sent with each Copilot request, cut down to known
// fields and size limits before it goes anywhere near a prompt. The
// browser builds it (see frontend/src/data/copilotContext.js) and only
// includes what the request needs; this is the server's own guard.

export const LIMITS = {
  message: 4000,
  title: 200,
  blockText: 3000,
  notes: 3000,
  selection: 6000,
  blocksPerSlide: 60,
  slides: 120,
  slideText: 1500,
  deckChars: 24000,
  findings: 40,
  assets: 60,
  layouts: 20,
  history: 12
};

const SCOPES = ['selection', 'slide', 'deck'];
const BLOCK_TYPES = ['textbox', 'image', 'shape', 'table', 'chart'];

function str(value, max) {
  if (typeof value !== 'string') return '';
  // Control characters other than tab/newline have no business in a prompt.
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : undefined;
}

function idOf(value) {
  return typeof value === 'string' && /^[\w.:-]{1,80}$/.test(value) ? value : null;
}

function hex(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined;
}

function sanitizeBlock(b) {
  if (!b || typeof b !== 'object') return null;
  const id = idOf(b.id);
  if (!id) return null;
  const type = BLOCK_TYPES.includes(b.type) ? b.type : 'textbox';
  const out = { id, type };
  if (['title', 'subtitle', 'decor', 'placeholder', 'object'].includes(b.role)) out.role = b.role;
  const text = str(b.text, LIMITS.blockText);
  if (text) out.text = text;
  for (const k of ['x', 'y', 'width', 'height', 'measuredHeight', 'fontSize']) {
    const v = num(b[k]);
    if (v !== undefined) out[k] = v;
  }
  if (typeof b.fontFamily === 'string') out.fontFamily = str(b.fontFamily, 80);
  if (b.fontWeight === 'bold') out.fontWeight = 'bold';
  const fill = hex(b.fill);
  if (fill) out.fill = fill;
  if (type === 'table' && b.tableSize && typeof b.tableSize === 'object') {
    out.tableSize = { rows: num(b.tableSize.rows) || 0, columns: num(b.tableSize.columns) || 0 };
  }
  if (type === 'image' && typeof b.altText === 'string') out.altText = str(b.altText, 200);
  return out;
}

export function sanitizeContext(raw) {
  const ctx = raw && typeof raw === 'object' ? raw : {};
  const slideCount = Math.max(0, Math.min(1000, Math.floor(num(ctx.slideCount) || 0)));
  const out = {
    deckTitle: str(ctx.deckTitle, LIMITS.title),
    scope: SCOPES.includes(ctx.scope) ? ctx.scope : 'slide',
    slideCount,
    activeSlide: null,
    selection: null,
    slides: [],
    truncated: !!ctx.truncated,
    layoutReport: null,
    assets: [],
    layouts: []
  };

  const a = ctx.activeSlide;
  if (a && typeof a === 'object' && Number.isInteger(a.index) && a.index >= 0 && a.index < Math.max(1, slideCount)) {
    out.activeSlide = {
      index: a.index,
      title: str(a.title, LIMITS.title),
      notes: str(a.notes, LIMITS.notes),
      background: hex(a.background),
      hasBackgroundImage: !!a.hasBackgroundImage,
      blocks: (Array.isArray(a.blocks) ? a.blocks : []).slice(0, LIMITS.blocksPerSlide).map(sanitizeBlock).filter(Boolean)
    };
  }

  const s = ctx.selection;
  if (s && typeof s === 'object' && out.activeSlide) {
    const blockIds = (Array.isArray(s.blockIds) ? s.blockIds : []).map(idOf).filter(Boolean).slice(0, 20);
    const known = new Set(out.activeSlide.blocks.map((b) => b.id));
    const ids = blockIds.filter((id) => known.has(id));
    if (ids.length) {
      const blockId = idOf(s.blockId);
      out.selection = {
        blockIds: ids,
        blockId: blockId && known.has(blockId) ? blockId : null,
        text: str(s.text, LIMITS.selection),
        partial: Number.isInteger(s.start) && Number.isInteger(s.end) && s.end > s.start
      };
    }
  }

  let budget = LIMITS.deckChars;
  for (const sl of (Array.isArray(ctx.slides) ? ctx.slides : []).slice(0, LIMITS.slides)) {
    if (!sl || !Number.isInteger(sl.index)) continue;
    const text = str(sl.text, Math.min(LIMITS.slideText, Math.max(0, budget)));
    budget -= text.length;
    out.slides.push({ index: sl.index, title: str(sl.title, LIMITS.title), ...(text && { text }), ...(sl.abridged && { abridged: true }) });
    if (budget <= 0) out.truncated = true;
  }

  const r = ctx.layoutReport;
  if (r && typeof r === 'object') {
    out.layoutReport = {
      measured: !!r.measured,
      findings: (Array.isArray(r.findings) ? r.findings : []).slice(0, LIMITS.findings).map((f) => ({
        kind: str(f?.kind, 40),
        severity: f?.severity === 'warning' ? 'warning' : 'info',
        blockIds: (Array.isArray(f?.blockIds) ? f.blockIds : []).map(idOf).filter(Boolean).slice(0, 10),
        message: str(f?.message, 300)
      }))
    };
  }

  out.assets = (Array.isArray(ctx.assets) ? ctx.assets : [])
    .slice(0, LIMITS.assets)
    .map((x) => ({
      id: idOf(x?.id),
      name: str(x?.name, 80),
      kind: ['emoji', 'sticker', 'icon'].includes(x?.kind) ? x.kind : 'sticker',
      category: str(x?.category, 40),
      tags: (Array.isArray(x?.tags) ? x.tags : []).slice(0, 12).map((t) => str(t, 30))
    }))
    .filter((x) => x.id);

  out.layouts = (Array.isArray(ctx.layouts) ? ctx.layouts : [])
    .slice(0, LIMITS.layouts)
    .map((l) => ({ id: idOf(l?.id), name: str(l?.name, 60), description: str(l?.description, 200) }))
    .filter((l) => l.id);

  return out;
}

// One-line description of what the request was about, kept with the
// conversation instead of the document text itself.
export function contextLabel(ctx) {
  if (ctx.scope === 'deck') return `Whole presentation (${ctx.slideCount} slides)`;
  if (!ctx.activeSlide) return 'No slide';
  const where = `Slide ${ctx.activeSlide.index + 1}${ctx.activeSlide.title ? `: ${ctx.activeSlide.title.slice(0, 60)}` : ''}`;
  if (ctx.scope === 'selection' && ctx.selection) return `Selection on ${where}`;
  return where;
}
