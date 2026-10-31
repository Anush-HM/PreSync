import mongoose from 'mongoose';
import Document from '../models/Document.js';
import ImportedDocument from '../models/ImportedDocument.js';
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
// MongoDB refuses a record of 16MB; leave room for the other fields.
const MAX_CONTENT_CHARS = 15 * 1024 * 1024;

const EXPORTS = {
  docx: { render: exportDocumentToDocx, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pdf: { render: exportDocumentToPdf, type: 'application/pdf' }
};

function summary(doc, userId) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    wordCount: doc.wordCount || 0,
    sourceFileName: doc.sourceFileName || null,
    isOwner: doc.ownerId.toString() === userId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function full(doc, userId) {
  return { ...summary(doc, userId), content: doc.content, page: doc.page, layout: cleanLayout(doc.layout), importNotes: doc.importNotes || [] };
}

const canEdit = (doc, userId) =>
  doc.ownerId.toString() === userId || (doc.collaboratorIds || []).some((id) => id.toString() === userId);

async function findAccessible(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'Document not found' });
    return null;
  }
  const doc = await Document.findById(req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return null;
  }
  if (!canEdit(doc, req.userId)) {
    res.status(403).json({ error: 'You do not have access to this document' });
    return null;
  }
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
  res.status(201).json(full(doc, req.userId));
}

export async function listDocuments(req, res) {
  const docs = await Document.find({ $or: [{ ownerId: req.userId }, { collaboratorIds: req.userId }] })
    .select('title ownerId wordCount sourceFileName createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(LIST_LIMIT);
  res.json(docs.map((d) => summary(d, req.userId)));
}

export async function getDocument(req, res) {
  const doc = await findAccessible(req, res);
  if (!doc) return;
  res.json(full(doc, req.userId));
}

export async function updateDocument(req, res) {
  const doc = await findAccessible(req, res);
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
  res.json(summary(doc, req.userId));
}

export async function deleteDocument(req, res) {
  const doc = await findAccessible(req, res);
  if (!doc) return;
  if (doc.ownerId.toString() !== req.userId) return res.status(403).json({ error: 'Only the owner can delete this document' });
  await doc.deleteOne();
  res.status(204).end();
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
  res.status(201).json(full(doc, req.userId));
}

export async function exportDocument(req, res) {
  const spec = EXPORTS[req.params.format];
  if (!spec) return res.status(400).json({ error: 'format must be "docx" or "pdf"' });
  const doc = await findAccessible(req, res);
  if (!doc) return;

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
