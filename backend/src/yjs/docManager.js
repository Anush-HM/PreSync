import * as Y from 'yjs';
import Deck from '../models/Deck.js';

// One Y.Doc per deck, kept in memory for as long as at least one editor
// socket is connected to it. This is the CRDT layer described in the
// spec — Mongo (via Deck.slides) is the source of truth at rest, and this
// module is the only bridge between the two. Live edits never touch
// Mongo directly; they flow through the Y.Doc and get flushed here.
const docs = new Map(); // deckId -> { doc, saveTimer, refCount }
const SAVE_DEBOUNCE_MS = 2000;

function blockToPlain(blockMap) {
  return {
    id: blockMap.get('id'),
    type: blockMap.get('type') || 'textbox',
    x: blockMap.get('x'),
    y: blockMap.get('y'),
    width: blockMap.get('width'),
    fontSize: blockMap.get('fontSize') ?? 16,
    text: blockMap.get('text') ?? '',
    imageUrl: blockMap.get('imageUrl') || undefined
  };
}

function slideToPlain(slideMap) {
  return {
    id: slideMap.get('id'),
    order: slideMap.get('order'),
    backgroundImageUrl: slideMap.get('backgroundImageUrl') || undefined,
    needsImageFallback: !!slideMap.get('needsImageFallback'),
    blocks: slideMap.get('blocks').toArray().map(blockToPlain)
  };
}

function plainToBlockMap(block) {
  const m = new Y.Map();
  m.set('id', block.id);
  m.set('type', block.type || 'textbox');
  m.set('x', block.x);
  m.set('y', block.y);
  m.set('width', block.width);
  m.set('fontSize', block.fontSize ?? 16);
  m.set('text', block.text ?? '');
  if (block.imageUrl) m.set('imageUrl', block.imageUrl);
  return m;
}

function plainToSlideMap(slide) {
  const m = new Y.Map();
  m.set('id', slide.id);
  m.set('order', slide.order);
  if (slide.backgroundImageUrl) m.set('backgroundImageUrl', slide.backgroundImageUrl);
  m.set('needsImageFallback', !!slide.needsImageFallback);
  const blocks = new Y.Array();
  blocks.push((slide.blocks || []).map(plainToBlockMap));
  m.set('blocks', blocks);
  return m;
}

async function persist(deckId, doc) {
  const slides = doc.getArray('slides').toArray().map(slideToPlain);
  await Deck.findByIdAndUpdate(deckId, { slides }).exec();
}

// Returns the shared Y.Doc for a deck, creating + hydrating it from Mongo
// if this is the first connection to touch it. Bumps a refcount so the
// doc can be released (and flushed) once every editor disconnects.
export async function getDoc(deckId) {
  let entry = docs.get(deckId);
  if (entry) {
    entry.refCount += 1;
    return entry.doc;
  }

  const doc = new Y.Doc();
  const slidesArr = doc.getArray('slides');

  const deck = await Deck.findById(deckId).lean();
  if (deck?.slides?.length) {
    doc.transact(() => {
      slidesArr.push(deck.slides.map(plainToSlideMap));
    });
  }

  entry = { doc, saveTimer: null, refCount: 1 };
  docs.set(deckId, entry);

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
// connection will rehydrate fresh from Mongo.
export function releaseDoc(deckId) {
  const entry = docs.get(deckId);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    if (entry.saveTimer) clearTimeout(entry.saveTimer);
    persist(deckId, entry.doc).catch((err) => console.error(`Yjs final persist failed for deck ${deckId}:`, err));
    docs.delete(deckId);
  }
}