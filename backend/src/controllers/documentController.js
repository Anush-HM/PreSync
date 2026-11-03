import mongoose from 'mongoose';
import Document from '../models/Document.js';
import DocumentComment from '../models/DocumentComment.js';
import DocumentVersion from '../models/DocumentVersion.js';
import ImportedDocument from '../models/ImportedDocument.js';
import User from '../models/User.js';
import { canEdit, roleOf } from '../services/documentAccess.js';
import { applyToLiveDoc, flushDocumentDoc, MAX_CONTENT_CHARS } from '../yjs/documentManager.js';
import { disconnectFromDocument } from '../yjs/rooms.js';
import { autoSnapshotDocument } from './documentCollabController.js';
import { detectFormat, unsupportedFormatError } from '../services/importService.js';
import { DocxParseError, parseDocx } from '../services/docxIngestService.js';
import {
  blankContent, blocksToContent, cleanBorder, cleanContent, cleanLayout, cleanPage, countWords, defaultLayout, defaultPage, DocumentContentError,
  importNotes, slotsFromWord
} from '../services/documentContent.js';
import { exportDocumentToDocx } from '../services/docxExportService.js';
import { exportDocumentToPdf } from '../services/documentPdfService.js';
import { exportFileName } from '../services/deckExportService.js';

const MAX_TITLE_LENGTH = 200;
const LIST_LIMIT = 200;
const DEFAULT_TITLE = 'Untitled document';
const PEOPLE = ['ownerId', 'collaboratorIds', 'viewerIds'].map((path) => ({ path, select: 'email name' }));

const EXPORTS = {
  docx: { render: exportDocumentToDocx, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pdf: { render: exportDocumentToPdf, type: 'application/pdf' }
};

function person(ref) {
  return ref && typeof ref === 'object' && ref._id ? { id: ref._id.toString(), name: ref.name || '', email: ref.email || '' } : null;
}

function summary(doc, userId) {
  const role = roleOf(doc, userId);
  const owner = person(doc.ownerId);
  return {
    id: doc._id.toString(),
    title: doc.title,
    wordCount: doc.wordCount || 0,
    sourceFileName: doc.sourceFileName || null,
    isOwner: role === 'owner',
    role,
    ...(owner ? { owner } : {}),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

// Who has access, for the share dialog. Needs the people populated.
function sharing(doc) {
  const people = (ids, role) => (ids || []).map(person).filter(Boolean).map((p) => ({ ...p, role }));
  return {
    owner: person(doc.ownerId),
    people: [...people(doc.collaboratorIds, 'editor'), ...people(doc.viewerIds, 'viewer')]
  };
}

function full(doc, userId) {
  return {
    ...summary(doc, userId),
    ...sharing(doc),
    content: doc.content,
    page: doc.page,
    layout: cleanLayout(doc.layout),
    importNotes: doc.importNotes || []
  };
}

// The document, when this user may at least read it (`edit` for changes,
// `owner` for sharing). Sends the error itself otherwise.
export async function findAccessible(req, res, need = 'view', { populate = false } = {}) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'Document not found' });
    return null;
  }
  const doc = await Document.findById(req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return null;
  }
  const role = roleOf(doc, req.userId);
  if (!role) {
    res.status(403).json({ error: 'You do not have access to this document' });
    return null;
  }
  if (need === 'edit' && !canEdit(role)) {
    res.status(403).json({ error: 'You can view this document but not change it' });
    return null;
  }
  if (need === 'owner' && role !== 'owner') {
    res.status(403).json({ error: 'Only the owner can change who has access' });
    return null;
  }
  if (populate) await doc.populate(PEOPLE);
  return doc;
}

const cleanTitle = (value, fallback) => (typeof value === 'string' ? value.trim().slice(0, MAX_TITLE_LENGTH) : '') || fallback;

export async function createDocument(req, res) {
  const content = blankContent();
  const doc = await Document.create({
    title: cleanTitle(req.body?.title, DEFAULT_TITLE),
    ownerId: req.userId,
    content,
    page: defaultPage(req.body?.pageSize === 'letter' ? 'letter' : 'a4'),
    layout: defaultLayout(),
    wordCount: 0
  });
  await doc.populate(PEOPLE);
  res.status(201).json(full(doc, req.userId));
}

export async function listDocuments(req, res) {
  const docs = await Document.find({ $or: [{ ownerId: req.userId }, { collaboratorIds: req.userId }, { viewerIds: req.userId }] })
    .select('title ownerId collaboratorIds viewerIds wordCount sourceFileName createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(LIST_LIMIT)
    .populate({ path: 'ownerId', select: 'email name' });
  res.json(docs.map((d) => summary(d, req.userId)));
}

export async function getDocument(req, res) {
  const doc = await findAccessible(req, res, 'view', { populate: true });
  if (!doc) return;
  res.json(full(doc, req.userId));
}

// For editors that are not connected live: also put the change into the
// live copy, if others have it open, so it is not overwritten by theirs.
export async function updateDocument(req, res) {
  const doc = await findAccessible(req, res, 'edit');
  if (!doc) return;
  const { title, content, page, layout } = req.body || {};
  if (title !== undefined) doc.title = cleanTitle(title, doc.title);
  if (layout !== undefined) {
    doc.layout = cleanLayout(layout);
    doc.markModified('layout');
  }
  if (page !== undefined) {
    doc.page = cleanPage(page, doc.page);
    doc.markModified('page');
  }
  if (content !== undefined) {
    let cleaned;
    try {
      cleaned = cleanContent(content);
    } catch (err) {
      if (err instanceof DocumentContentError) return res.status(400).json({ error: err.message });
      throw err;
    }
    if (JSON.stringify(cleaned).length > MAX_CONTENT_CHARS) {
      return res.status(413).json({ error: 'This document is too large to save. Try removing or shrinking some pictures.' });
    }
    doc.content = cleaned;
    doc.wordCount = countWords(cleaned);
    doc.markModified('content');
  }
  await doc.save();
  await applyToLiveDoc(doc._id.toString(), {
    ...(title !== undefined ? { title: doc.title } : {}),
    ...(layout !== undefined ? { layout: doc.layout } : {}),
    ...(page !== undefined ? { page: doc.page } : {}),
    ...(content !== undefined ? { content: doc.content } : {})
  });
  res.json(summary(doc, req.userId));
}

// Explicit Save: writes the live copy now, and keeps an automatic
// version now and then.
export async function saveDocument(req, res) {
  let doc = await findAccessible(req, res, 'edit');
  if (!doc) return;
  if (await flushDocumentDoc(doc._id.toString())) doc = (await Document.findById(doc._id)) || doc;
  const version = await autoSnapshotDocument(doc, req.userId);
  res.json({ ...summary(doc, req.userId), savedAt: new Date().toISOString(), versionId: version ? version._id.toString() : null });
}

export async function deleteDocument(req, res) {
  const doc = await findAccessible(req, res);
  if (!doc) return;
  if (roleOf(doc, req.userId) !== 'owner') return res.status(403).json({ error: 'Only the owner can delete this document' });
  await doc.deleteOne();
  await Promise.all([DocumentComment.deleteMany({ documentId: doc._id }), DocumentVersion.deleteMany({ documentId: doc._id })]);
  res.status(204).end();
}

// Owner only: gives someone with a PreSync account edit or view access,
// or changes the access they have.
export async function shareDocument(req, res) {
  const doc = await findAccessible(req, res, 'owner');
  if (!doc) return;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const role = req.body?.role === 'viewer' ? 'viewer' : 'editor';
  if (!email) return res.status(400).json({ error: 'email is required' });
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'No PreSync account with that email' });
  const userId = user._id.toString();
  if (userId === doc.ownerId.toString()) return res.status(400).json({ error: 'That is already the owner' });
  if (roleOf(doc, userId) === role) return res.status(400).json({ error: `They can already ${role === 'viewer' ? 'view' : 'edit'} this document` });
  doc.collaboratorIds = (doc.collaboratorIds || []).filter((id) => id.toString() !== userId);
  doc.viewerIds = (doc.viewerIds || []).filter((id) => id.toString() !== userId);
  (role === 'viewer' ? doc.viewerIds : doc.collaboratorIds).push(user._id);
  await doc.save();
  disconnectFromDocument(doc._id.toString(), userId);
  await doc.populate(PEOPLE);
  res.status(201).json(sharing(doc));
}

// Owner only: changes one person's access ({ role }).
export async function updateShare(req, res) {
  const doc = await findAccessible(req, res, 'owner');
  if (!doc) return;
  const { userId } = req.params;
  const current = roleOf(doc, userId);
  if (!current || current === 'owner') return res.status(404).json({ error: 'That person does not have access' });
  const role = req.body?.role === 'viewer' ? 'viewer' : req.body?.role === 'editor' ? 'editor' : null;
  if (!role) return res.status(400).json({ error: 'role must be "editor" or "viewer"' });
  if (role !== current) {
    const id = [...(doc.collaboratorIds || []), ...(doc.viewerIds || [])].find((x) => x.toString() === userId);
    doc.collaboratorIds = (doc.collaboratorIds || []).filter((x) => x.toString() !== userId);
    doc.viewerIds = (doc.viewerIds || []).filter((x) => x.toString() !== userId);
    (role === 'viewer' ? doc.viewerIds : doc.collaboratorIds).push(id);
    await doc.save();
    disconnectFromDocument(doc._id.toString(), userId);
  }
  await doc.populate(PEOPLE);
  res.json(sharing(doc));
}

// The owner removes someone; anyone else may remove themselves.
export async function removeShare(req, res) {
  const doc = await findAccessible(req, res);
  if (!doc) return;
  const { userId } = req.params;
  if (roleOf(doc, req.userId) !== 'owner' && userId !== req.userId) {
    return res.status(403).json({ error: 'Only the owner can change who has access' });
  }
  if (userId === doc.ownerId.toString()) return res.status(400).json({ error: 'The owner cannot be removed' });
  doc.collaboratorIds = (doc.collaboratorIds || []).filter((x) => x.toString() !== userId);
  doc.viewerIds = (doc.viewerIds || []).filter((x) => x.toString() !== userId);
  await doc.save();
  disconnectFromDocument(doc._id.toString(), userId);
  await doc.populate(PEOPLE);
  res.json(sharing(doc));
}

// Uploads a .docx and creates an editable document from it.
export async function importDocx(req, res) {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded (expected field name "file")' });

  const format = detectFormat(file);
  const unsupported = unsupportedFormatError(format);
  if (unsupported) return res.status(unsupported.status).json({ error: unsupported.error });
  if (format !== 'docx') return res.status(400).json({ error: 'Only Word (.docx) files open in the document editor' });

  let parsed;
  try {
    parsed = await parseDocx(file.buffer);
  } catch (err) {
    if (err instanceof DocxParseError || err instanceof SyntaxError || /xml/i.test(err.message || '')) {
      return res.status(422).json({ error: `Could not read this Word document: ${err.message}` });
    }
    throw err;
  }

  const content = blocksToContent(parsed.blocks, parsed.images);
  const firstTitle = parsed.blocks.find((b) => b.type === 'title')?.text;
  const doc = await Document.create({
    title: cleanTitle(parsed.meta.title || firstTitle, file.originalname.replace(/\.docx$/i, '') || DEFAULT_TITLE),
    ownerId: req.userId,
    content,
    page: cleanPage(parsed.meta.page, defaultPage()),
    layout: { ...defaultLayout(), header: slotsFromWord(parsed.header || []), footer: slotsFromWord(parsed.footer || []), pageBorder: cleanBorder(parsed.pageBorder) },
    wordCount: countWords(content),
    sourceFileName: file.originalname,
    importNotes: importNotes(parsed.found)
  });
  await doc.populate(PEOPLE);
  res.status(201).json(full(doc, req.userId));
}

// Word files imported before the editor existed: their extracted blocks
// are enough to open them, without uploading the file again.
export async function createFromImport(req, res) {
  if (!mongoose.isValidObjectId(req.params.importId)) return res.status(404).json({ error: 'Import not found' });
  const source = await ImportedDocument.findById(req.params.importId);
  if (!source) return res.status(404).json({ error: 'Import not found' });
  if (source.ownerId.toString() !== req.userId) return res.status(403).json({ error: 'This import belongs to someone else' });
  if (source.format !== 'docx') return res.status(400).json({ error: 'Only Word imports open in the document editor' });

  const content = blocksToContent(source.blocks, source.images);
  const doc = await Document.create({
    title: cleanTitle(source.title, DEFAULT_TITLE),
    ownerId: req.userId,
    content,
    page: cleanPage(source.page, defaultPage()),
    layout: { ...defaultLayout(), header: slotsFromWord(source.header || []), footer: slotsFromWord(source.footer || []), pageBorder: cleanBorder(source.pageBorder) },
    wordCount: countWords(content),
    sourceFileName: source.fileName
  });
  await doc.populate(PEOPLE);
  res.status(201).json(full(doc, req.userId));
}

export async function exportDocument(req, res) {
  const spec = EXPORTS[req.params.format];
  if (!spec) return res.status(400).json({ error: 'format must be "docx" or "pdf"' });
  let doc = await findAccessible(req, res);
  if (!doc) return;
  // Includes what co-editors typed in the last moment.
  if (await flushDocumentDoc(doc._id.toString())) doc = (await Document.findById(doc._id)) || doc;

  const file = await spec.render(doc.toObject ? doc.toObject() : doc);
  const name = exportFileName(doc.title || 'document', req.params.format);
  res.set({
    'Content-Type': spec.type,
    'Content-Length': file.length,
    'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    // The editor runs on another origin and reads the name from here.
    'Access-Control-Expose-Headers': 'Content-Disposition'
  });
  res.send(file);
}
