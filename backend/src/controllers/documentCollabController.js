import { createHash, randomUUID } from 'crypto';
import mongoose from 'mongoose';
import Document from '../models/Document.js';
import DocumentComment from '../models/DocumentComment.js';
import DocumentVersion from '../models/DocumentVersion.js';
import { roleOf } from '../services/documentAccess.js';
import { cleanLayout, countWords } from '../services/documentContent.js';
import { applyToLiveDoc, flushDocumentDoc, touchComments } from '../yjs/documentManager.js';
import { findAccessible } from './documentController.js';

// Comments and version history for Word documents.
//
// Comments: editors start threads on selected text, reply, resolve and
// reopen; only the author edits their text; the author or the owner
// deletes a thread. People with view access read the threads.
//
// Versions: copies of the document that anyone with access can preview;
// editors save named ones and restore. Restoring happens here, on the
// server, and goes into the live copy for everyone who has it open,
// after keeping a "Before restoring" version of what was there.

const MAX_TEXT = 2000;
const MAX_QUOTE = 500;
const MAX_REPLIES = 200;
const MAX_LABEL_LENGTH = 120;
export const MAX_VERSIONS_PER_DOCUMENT = 100;
export const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;
const PEOPLE = ['authorId', 'replies.authorId', 'resolvedBy'].map((path) => ({ path, select: 'email name' }));

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v) && /^[0-9a-f]{24}$/i.test(v);
const cleanText = (v) => (typeof v === 'string' ? v.trim() : '');

function person(ref) {
  return ref && typeof ref === 'object' && ref._id ? { id: ref._id.toString(), name: ref.name || '', email: ref.email || '' } : null;
}

// --- comments -----------------------------------------------------------

function shapeComment(c) {
  return {
    id: c._id.toString(),
    quote: c.quote || '',
    text: c.text,
    author: person(c.authorId),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    resolved: !!c.resolved,
    resolvedBy: person(c.resolvedBy),
    resolvedAt: c.resolvedAt || null,
    replies: (c.replies || []).map((r) => ({ id: r.id, text: r.text, author: person(r.authorId), createdAt: r.createdAt }))
  };
}

async function findThread(req, res, doc) {
  if (!isId(req.params.commentId)) {
    res.status(404).json({ error: 'Comment not found' });
    return null;
  }
  const c = await DocumentComment.findById(req.params.commentId);
  if (!c || c.documentId.toString() !== doc._id.toString()) {
    res.status(404).json({ error: 'Comment not found' });
    return null;
  }
  return c;
}

async function sendThread(res, doc, c, status = 200) {
  await touchComments(doc._id.toString());
  await c.populate(PEOPLE);
  res.status(status).json(shapeComment(c));
}

function checkText(res, text) {
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return false;
  }
  if (text.length > MAX_TEXT) {
    res.status(400).json({ error: `text must be ${MAX_TEXT} characters or fewer` });
    return false;
  }
  return true;
}

export async function listDocumentComments(req, res) {
  const doc = await findAccessible(req, res);
  if (!doc) return;
  const threads = await DocumentComment.find({ documentId: doc._id }).sort({ createdAt: 1 }).populate(PEOPLE);
  res.json(threads.map(shapeComment));
}

// { text, quote }. The editor adds the comment mark to the text once the
// thread exists, so the id is the server's.
export async function createDocumentComment(req, res) {
  const doc = await findAccessible(req, res, 'edit');
  if (!doc) return;
  const text = cleanText(req.body?.text);
  if (!checkText(res, text)) return;
  const quote = typeof req.body?.quote === 'string' ? req.body.quote.trim().slice(0, MAX_QUOTE) : '';
  const c = await DocumentComment.create({ documentId: doc._id, authorId: req.userId, quote, text });
  await sendThread(res, doc, c, 201);
}

export async function replyToDocumentComment(req, res) {
  const doc = await findAccessible(req, res, 'edit');
  if (!doc) return;
  const c = await findThread(req, res, doc);
  if (!c) return;
  const text = cleanText(req.body?.text);
  if (!checkText(res, text)) return;
  if (c.replies.length >= MAX_REPLIES) return res.status(409).json({ error: 'This thread has too many replies' });
  c.replies.push({ id: randomUUID(), authorId: req.userId, text, createdAt: new Date() });
  // Replying to a resolved thread opens it again.
  if (c.resolved) {
    c.resolved = false;
    c.resolvedBy = undefined;
    c.resolvedAt = undefined;
  }
  await c.save();
  await sendThread(res, doc, c, 201);
}

// { resolved } from any editor; { text } from the author only.
export async function updateDocumentComment(req, res) {
  const doc = await findAccessible(req, res, 'edit');
  if (!doc) return;
  const c = await findThread(req, res, doc);
  if (!c) return;
  if (req.body?.text !== undefined) {
    if (c.authorId.toString() !== req.userId) return res.status(403).json({ error: 'Only the author can edit a comment' });
    const text = cleanText(req.body.text);
    if (!checkText(res, text)) return;
    c.text = text;
  }
  if (typeof req.body?.resolved === 'boolean') {
    c.resolved = req.body.resolved;
    c.resolvedBy = req.body.resolved ? req.userId : undefined;
    c.resolvedAt = req.body.resolved ? new Date() : undefined;
  }
  await c.save();
  await sendThread(res, doc, c);
}

export async function deleteDocumentComment(req, res) {
  const doc = await findAccessible(req, res, 'edit');
  if (!doc) return;
  const c = await findThread(req, res, doc);
  if (!c) return;
  if (c.authorId.toString() !== req.userId && roleOf(doc, req.userId) !== 'owner') {
    return res.status(403).json({ error: 'Only the author or the owner can delete a comment' });
  }
  await c.deleteOne();
  await touchComments(doc._id.toString());
  res.status(204).end();
}

// --- versions -------------------------------------------------------------

export function documentFingerprint(doc) {
  return createHash('sha256')
    .update(JSON.stringify([doc.content, doc.page, doc.layout ?? null, doc.title]))
    .digest('hex');
}

function shapeVersion(v) {
  return {
    id: v._id.toString(),
    label: v.label || '',
    kind: v.kind,
    title: v.title,
    wordCount: v.wordCount || 0,
    createdAt: v.createdAt,
    author: person(v.authorId)
  };
}

// Drops the oldest automatic versions once there are too many; named
// ones go only when nothing else is left to drop.
async function prune(documentId) {
  const all = await DocumentVersion.find({ documentId }).select('kind createdAt').sort({ createdAt: 1 });
  let extra = all.length - MAX_VERSIONS_PER_DOCUMENT;
  if (extra <= 0) return;
  const order = [...all.filter((v) => v.kind !== 'manual'), ...all.filter((v) => v.kind === 'manual')];
  for (const v of order) {
    if (extra <= 0) break;
    await DocumentVersion.deleteOne({ _id: v._id });
    extra -= 1;
  }
}

export async function snapshotDocument(doc, authorId, { label = '', kind = 'manual', skipIfUnchanged = false } = {}) {
  const fingerprint = documentFingerprint(doc);
  if (skipIfUnchanged) {
    const latest = await DocumentVersion.findOne({ documentId: doc._id }).sort({ createdAt: -1 }).select('fingerprint');
    if (latest?.fingerprint === fingerprint) return null;
  }
  const version = await DocumentVersion.create({
    documentId: doc._id,
    authorId,
    label,
    kind,
    title: doc.title,
    content: doc.content,
    page: doc.page,
    layout: doc.layout ?? null,
    wordCount: doc.wordCount || countWords(doc.content || { type: 'doc' }),
    fingerprint
  });
  await prune(doc._id);
  return version;
}

// Called by Save: a version when the last one is old enough and the
// document has changed since.
export async function autoSnapshotDocument(doc, authorId) {
  const latest = await DocumentVersion.findOne({ documentId: doc._id }).sort({ createdAt: -1 }).select('createdAt fingerprint');
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < AUTO_VERSION_INTERVAL_MS) return null;
  if (latest?.fingerprint === documentFingerprint(doc)) return null;
  return snapshotDocument(doc, authorId, { kind: 'auto' });
}

async function findVersion(req, res, doc) {
  if (!isId(req.params.versionId)) {
    res.status(404).json({ error: 'Version not found' });
    return null;
  }
  const v = await DocumentVersion.findById(req.params.versionId).populate({ path: 'authorId', select: 'email name' });
  if (!v || v.documentId.toString() !== doc._id.toString()) {
    res.status(404).json({ error: 'Version not found' });
    return null;
  }
  return v;
}

function labelFrom(req, res) {
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  if (label.length > MAX_LABEL_LENGTH) {
    res.status(400).json({ error: `label must be ${MAX_LABEL_LENGTH} characters or fewer` });
    return null;
  }
  return label;
}

export async function listDocumentVersions(req, res) {
  const doc = await findAccessible(req, res);
  if (!doc) return;
  const versions = await DocumentVersion.find({ documentId: doc._id })
    .select('-content')
    .sort({ createdAt: -1 })
    .populate({ path: 'authorId', select: 'email name' });
  res.json(versions.map(shapeVersion));
}

export async function createDocumentVersion(req, res) {
  let doc = await findAccessible(req, res, 'edit');
  if (!doc) return;
  const label = labelFrom(req, res);
  if (label === null) return;
  if (await flushDocumentDoc(doc._id.toString())) doc = (await Document.findById(doc._id)) || doc;
  const version = await snapshotDocument(doc, req.userId, { label });
  await version.populate({ path: 'authorId', select: 'email name' });
  res.status(201).json(shapeVersion(version));
}

// One version with its content, for previewing.
export async function getDocumentVersion(req, res) {
  const doc = await findAccessible(req, res);
  if (!doc) return;
  const v = await findVersion(req, res, doc);
  if (!v) return;
  res.json({ ...shapeVersion(v), content: v.content, page: v.page, layout: cleanLayout(v.layout) });
}

export async function updateDocumentVersion(req, res) {
  const doc = await findAccessible(req, res, 'edit');
  if (!doc) return;
  const v = await findVersion(req, res, doc);
  if (!v) return;
  const label = labelFrom(req, res);
  if (label === null) return;
  v.label = label;
  if (label && v.kind === 'auto') v.kind = 'manual';
  await v.save();
  res.json(shapeVersion(v));
}

// Brings a version's text, page and layout back for everyone (the title
// stays). What was there first is kept as a "Before restoring" version.
export async function restoreDocumentVersion(req, res) {
  let doc = await findAccessible(req, res, 'edit');
  if (!doc) return;
  const v = await findVersion(req, res, doc);
  if (!v) return;
  const id = doc._id.toString();
  if (await flushDocumentDoc(id)) doc = (await Document.findById(doc._id)) || doc;
  const before = await snapshotDocument(doc, req.userId, { kind: 'restore' });

  doc.content = v.content;
  doc.page = v.page || doc.page;
  doc.layout = v.layout ?? doc.layout;
  doc.wordCount = v.wordCount || countWords(v.content);
  doc.markModified('content');
  doc.markModified('page');
  doc.markModified('layout');
  await doc.save();
  await applyToLiveDoc(id, { content: doc.content, page: doc.page, layout: cleanLayout(doc.layout), });
  res.json({ restored: shapeVersion(v), backupId: before._id.toString() });
}
