import * as Y from 'yjs';
import Deck from '../models/Deck.js';

// One Y.Doc per deck, kept in memory for as long as at least one editor
// socket is connected to it. This is the CRDT layer described in the
// spec — Mongo (via Deck.slides) is the source of truth at rest, and this
// module is the only bridge between the two. Live edits never touch
// Mongo directly; they flow through the Y.Doc and get flushed here.
const docs = new Map(); // deckId -> { doc, saveTimer, refCount, ready }
const pendingFlushes = new Map(); // deckId -> promise of the final persist after release
const SAVE_DEBOUNCE_MS = 2000;

// Optional fields copied verbatim between Mongo and the Y.Doc when set.
// Keep these in step with the Deck model and frontend/src/data/yjsClient.js.
export const BLOCK_OPTIONAL_KEYS = [
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'underline',
  'linethrough',
  'fill',
  'textAlign',
  'lineHeight',
  'paragraphSpacing',
  'styles',
  'height',
  'verticalAlign',
  'rotation',
  'flipH',
  'flipV',
  'role',
  'shape',
  'path',
  'radius',
  'background',
  'fillGradient',
  'opacity',
  'stroke',
  'strokeWidth',
  'dash',
  'table',
  'chart',
  'imageUrl'
];
export const SLIDE_OPTIONAL_KEYS = ['backgroundImageUrl', 'backgroundColor', 'backgroundGradient', 'backgroundRepeat'];

function copyOptional(keys, read, write) {
  for (const key of keys) {
    const value = read(key);
    if (value !== undefined && value !== null && value !== '') write(key, value);
  }
}

export function blockToPlain(blockMap) {
  const plain = {
    id: blockMap.get('id'),
    type: blockMap.get('type') || 'textbox',
    x: blockMap.get('x'),
    y: blockMap.get('y'),
    width: blockMap.get('width'),
    fontSize: blockMap.get('fontSize') ?? 16,
    text: blockMap.get('text') ?? ''
  };
  copyOptional(BLOCK_OPTIONAL_KEYS, (k) => blockMap.get(k), (k, v) => (plain[k] = v));
  return plain;
}

export function slideToPlain(slideMap) {
  const plain = {
    id: slideMap.get('id'),
    order: slideMap.get('order'),
    needsImageFallback: !!slideMap.get('needsImageFallback'),
    notes: slideMap.get('notes') ?? '',
    blocks: slideMap.get('blocks').toArray().map(blockToPlain)
  };
  copyOptional(SLIDE_OPTIONAL_KEYS, (k) => slideMap.get(k), (k, v) => (plain[k] = v));
  return plain;
}

export function plainToBlockMap(block) {
  const m = new Y.Map();
  m.set('id', block.id);
  m.set('type', block.type || 'textbox');
  m.set('x', block.x);
  m.set('y', block.y);
  m.set('width', block.width);
  m.set('fontSize', block.fontSize ?? 16);
  m.set('text', block.text ?? '');
  copyOptional(BLOCK_OPTIONAL_KEYS, (k) => block[k], (k, v) => m.set(k, v));
  return m;
}

export function plainToSlideMap(slide) {
  const m = new Y.Map();
  m.set('id', slide.id);
  m.set('order', slide.order);
  m.set('needsImageFallback', !!slide.needsImageFallback);
  m.set('notes', slide.notes ?? '');
  copyOptional(SLIDE_OPTIONAL_KEYS, (k) => slide[k], (k, v) => m.set(k, v));
  const blocks = new Y.Array();
  blocks.push((slide.blocks || []).map(plainToBlockMap));
  m.set('blocks', blocks);
  return m;
}

// Slides are re-numbered on the way out so `order` always matches the
// array position, even after editors reorder or delete slides.
export function docToSlides(doc) {
  return doc.getArray('slides').toArray().map((slideMap, i) => ({ ...slideToPlain(slideMap), order: i }));
}

async function persist(deckId, doc) {
  await Deck.findByIdAndUpdate(deckId, { slides: docToSlides(doc) }).exec();
}

// Returns the shared Y.Doc for a deck, creating + hydrating it from Mongo
// if this is the first connection to touch it. Bumps a refcount so the
// doc can be released (and flushed) once every editor disconnects.
//
// The entry is registered synchronously, before the Mongo read, so editors
// who connect while hydration is still in flight wait on the same promise
// and share one Y.Doc instead of each building their own copy.
export async function getDoc(deckId) {
  const existing = docs.get(deckId);
  if (existing) {
    existing.refCount += 1;
    try {
      return await existing.ready;
    } catch (err) {
      existing.refCount -= 1;
      throw err;
    }
  }

  const doc = new Y.Doc();
  const entry = { doc, saveTimer: null, refCount: 1, ready: null };
  entry.ready = hydrate(deckId, entry);
  docs.set(deckId, entry);

  try {
    return await entry.ready;
  } catch (err) {
    if (docs.get(deckId) === entry) docs.delete(deckId);
    throw err;
  }
}

async function hydrate(deckId, entry) {
  const { doc } = entry;

  // If the previous editing session for this deck is still flushing to
  // Mongo, wait for it so we don't hydrate from stale slides.
  const flush = pendingFlushes.get(deckId);
  if (flush) await flush;

  const deck = await Deck.findById(deckId).lean();
  if (deck?.slides?.length) {
    doc.transact(() => {
      doc.getArray('slides').push(deck.slides.map(plainToSlideMap));
    });
  }

  doc.on('update', () => {
    if (entry.saveTimer) clearTimeout(entry.saveTimer);
    entry.saveTimer = setTimeout(() => {
      persist(deckId, doc).catch((err) => console.error(`Yjs persist failed for deck ${deckId}:`, err));
    }, SAVE_DEBOUNCE_MS);
  });

  return doc;
}

// Called when an editor socket disconnects. Once nobody is left editing
// this deck, flush immediately and drop the in-memory doc — the next
// connection will rehydrate fresh from Mongo once the flush has landed.
export function releaseDoc(deckId) {
  const entry = docs.get(deckId);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    if (entry.saveTimer) clearTimeout(entry.saveTimer);
    docs.delete(deckId);
    const flush = persist(deckId, entry.doc)
      .catch((err) => console.error(`Yjs final persist failed for deck ${deckId}:`, err))
      .finally(() => {
        if (pendingFlushes.get(deckId) === flush) pendingFlushes.delete(deckId);
      });
    pendingFlushes.set(deckId, flush);
  }
}

// Writes a deck's live Y.Doc to Mongo right away instead of waiting for
// the debounce, so an explicit "Save" or an export sees the latest
// edits. Returns false when nobody is editing the deck (Mongo is already
// current, apart from a release flush that is awaited here).
export async function flushDoc(deckId) {
  const entry = docs.get(deckId);
  if (!entry) {
    const flush = pendingFlushes.get(deckId);
    if (flush) await flush;
    return false;
  }
  const doc = await entry.ready;
  if (entry.saveTimer) {
    clearTimeout(entry.saveTimer);
    entry.saveTimer = null;
  }
  await persist(deckId, doc);
  return true;
}
