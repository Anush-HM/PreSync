import * as Y from 'yjs';
import Document from '../models/Document.js';
import { cleanContent, cleanLayout, cleanPage, countWords } from '../services/documentContent.js';
import { FRAGMENT, META, fillDoc, readContent, writeContent } from './documentYjs.js';

// One Y.Doc per open Word document, kept while at least one socket is
// connected to it: the live co-editing copy. Mongo (Document.content) is
// the copy at rest, written here a moment after each change and when the
// last person leaves. Same life cycle as decks in docManager.js.
const docs = new Map(); // documentId -> { doc, saveTimer, refCount, ready }
const pendingFlushes = new Map();
const SAVE_DEBOUNCE_MS = 1500;
const MAX_TITLE_LENGTH = 200;
// MongoDB refuses a record of 16MB; leave room for the other fields.
export const MAX_CONTENT_CHARS = 15 * 1024 * 1024;

// What the Y.Doc holds now, as the fields stored on a Document.
export function docToFields(doc, current = {}) {
  const meta = doc.getMap(META);
  const content = cleanContent(readContent(doc.getXmlFragment(FRAGMENT)), { lenient: true });
  const title = typeof meta.get('title') === 'string' ? meta.get('title').trim().slice(0, MAX_TITLE_LENGTH) : '';
  const fields = {
    content,
    wordCount: countWords(content),
    page: cleanPage(meta.get('page'), current.page),
    layout: cleanLayout(meta.get('layout'))
  };
  if (title) fields.title = title;
  return fields;
}

async function persist(documentId, doc) {
  const fields = docToFields(doc);
  if (JSON.stringify(fields.content).length > MAX_CONTENT_CHARS) {
    // Keep the rest; the editor already warns before pictures get this big.
    delete fields.content;
    delete fields.wordCount;
    console.error(`Document ${documentId} is too large to save its text`);
  }
  await Document.findByIdAndUpdate(documentId, fields).exec();
}

export async function getDocumentDoc(documentId) {
  const existing = docs.get(documentId);
  if (existing) {
    existing.refCount += 1;
    try {
      return await existing.ready;
    } catch (err) {
      existing.refCount -= 1;
      throw err;
    }
  }
  const entry = { doc: new Y.Doc(), saveTimer: null, refCount: 1, ready: null };
  entry.ready = hydrate(documentId, entry);
  docs.set(documentId, entry);
  try {
    return await entry.ready;
  } catch (err) {
    if (docs.get(documentId) === entry) docs.delete(documentId);
    throw err;
  }
}

async function hydrate(documentId, entry) {
  const flush = pendingFlushes.get(documentId);
  if (flush) await flush;
  const stored = await Document.findById(documentId).lean();
  if (!stored) throw new Error('Document not found');
  fillDoc(entry.doc, { ...stored, layout: cleanLayout(stored.layout) });
  entry.doc.on('update', () => {
    if (entry.saveTimer) clearTimeout(entry.saveTimer);
    entry.saveTimer = setTimeout(() => {
      entry.saveTimer = null;
      persist(documentId, entry.doc).catch((err) => console.error(`Saving document ${documentId} failed:`, err));
    }, SAVE_DEBOUNCE_MS);
  });
  return entry.doc;
}

export function releaseDocumentDoc(documentId) {
  const entry = docs.get(documentId);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount > 0) return;
  if (entry.saveTimer) clearTimeout(entry.saveTimer);
  docs.delete(documentId);
  const flush = entry.ready
    .then((doc) => persist(documentId, doc))
    .catch((err) => console.error(`Final save of document ${documentId} failed:`, err))
    .finally(() => {
      if (pendingFlushes.get(documentId) === flush) pendingFlushes.delete(documentId);
    });
  pendingFlushes.set(documentId, flush);
}

// Writes the live copy to Mongo now, so a download, Save or version sees
// the latest edits. False when nobody has the document open.
export async function flushDocumentDoc(documentId) {
  const entry = docs.get(documentId);
  if (!entry) {
    const flush = pendingFlushes.get(documentId);
    if (flush) await flush;
    return false;
  }
  const doc = await entry.ready;
  if (entry.saveTimer) {
    clearTimeout(entry.saveTimer);
    entry.saveTimer = null;
  }
  await persist(documentId, doc);
  return true;
}

// Puts stored fields into the live copy for everyone who has it open
// (restoring a version, or a save from an editor that is not live).
// False when nobody has the document open.
export async function applyToLiveDoc(documentId, { content, title, page, layout }) {
  const entry = docs.get(documentId);
  if (!entry) return false;
  const doc = await entry.ready;
  doc.transact(() => {
    if (content !== undefined) writeContent(doc.getXmlFragment(FRAGMENT), content);
    const meta = doc.getMap(META);
    if (title !== undefined) meta.set('title', title);
    if (page !== undefined) meta.set('page', page);
    if (layout !== undefined) meta.set('layout', layout);
  }, 'server');
  return true;
}

// Tells open editors that comment threads changed.
export async function touchComments(documentId) {
  const entry = docs.get(documentId);
  if (!entry) return;
  const doc = await entry.ready;
  const meta = doc.getMap(META);
  meta.set('commentsRev', (meta.get('commentsRev') || 0) + 1);
}

export function isLive(documentId) {
  return docs.has(documentId);
}
