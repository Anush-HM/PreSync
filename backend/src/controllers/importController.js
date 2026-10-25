import mongoose from 'mongoose';
import Deck from '../models/Deck.js';
import ImportedDocument from '../models/ImportedDocument.js';
import { detectFormat, extractImport, ImportParseError, unsupportedFormatError } from '../services/importService.js';
import { outlineToSlides, sanitizeOutline } from '../services/documentAnalysis.js';

const MAX_TITLE_LENGTH = 200;
const LIST_LIMIT = 50;

function summary(doc) {
  const a = doc.analysis || {};
  return {
    id: doc._id.toString(),
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    format: doc.format,
    title: doc.title,
    createdAt: doc.createdAt,
    pageCount: a.pageCount ?? null,
    slideCount: a.slideCount ?? null,
    suggestedSlides: a.suggestedSlides ?? null,
    warningCount: a.warnings?.length || 0,
    deckIds: (doc.deckIds || []).map(String)
  };
}

function full(doc) {
  return {
    ...summary(doc),
    analysis: doc.analysis,
    outline: doc.outline,
    blocks: doc.blocks,
    images: doc.images,
    slides: doc.slides
  };
}

async function findOwned(req, res) {
  if (!mongoose.isValidObjectId(req.params.importId)) {
    res.status(404).json({ error: 'Import not found' });
    return null;
  }
  const doc = await ImportedDocument.findById(req.params.importId);
  if (!doc) {
    res.status(404).json({ error: 'Import not found' });
    return null;
  }
  if (doc.ownerId.toString() !== req.userId) {
    res.status(403).json({ error: 'This import belongs to someone else' });
    return null;
  }
  return doc;
}

// Upload + analyse. Nothing is converted yet: the user reviews the
// result and then chooses what to create from it.
export async function analyzeImport(req, res) {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded (expected field name "file")' });

  const format = detectFormat(file);
  const unsupported = unsupportedFormatError(format);
  if (unsupported) return res.status(unsupported.status).json({ error: unsupported.error });

  let extracted;
  try {
    extracted = await extractImport(file, format);
  } catch (err) {
    if (err instanceof ImportParseError) return res.status(422).json({ error: err.message });
    throw err;
  }

  const doc = await ImportedDocument.create({
    ownerId: req.userId,
    fileName: file.originalname,
    fileSize: file.size,
    format,
    title: extracted.title.slice(0, MAX_TITLE_LENGTH),
    analysis: extracted.analysis,
    outline: extracted.outline,
    blocks: extracted.blocks,
    images: extracted.images,
    slides: extracted.slides
  });

  res.status(201).json(full(doc));
}

export async function listImports(req, res) {
  const docs = await ImportedDocument.find({ ownerId: req.userId })
    .select('fileName fileSize format title createdAt deckIds analysis.pageCount analysis.slideCount analysis.suggestedSlides analysis.warnings')
    .sort({ createdAt: -1 })
    .limit(LIST_LIMIT);
  res.json(docs.map(summary));
}

export async function getImport(req, res) {
  const doc = await findOwned(req, res);
  if (!doc) return;
  res.json(full(doc));
}

// Saves the user's edits to the suggested outline.
export async function saveImportOutline(req, res) {
  const doc = await findOwned(req, res);
  if (!doc) return;
  let outline;
  try {
    outline = sanitizeOutline(req.body.outline, new Set(doc.images.map((i) => i.id)));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  doc.outline = outline;
  doc.markModified('outline');
  await doc.save();
  res.json({ outline: doc.outline });
}

// Creates a presentation from an import.
//   mode "original": the PowerPoint/PDF slides as extracted (edit the import)
//   mode "outline":  new slides generated from the (optionally edited) outline
export async function createDeckFromImport(req, res) {
  const doc = await findOwned(req, res);
  if (!doc) return;

  const mode = req.body.mode === 'original' ? 'original' : 'outline';
  let slides;
  if (mode === 'original') {
    if (doc.format === 'docx') {
      return res.status(400).json({ error: 'Word documents become presentations through their outline' });
    }
    slides = doc.slides;
  } else {
    let outline;
    try {
      outline = sanitizeOutline(req.body.outline ?? doc.outline, new Set(doc.images.map((i) => i.id)));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (req.body.outline) {
      doc.outline = outline;
      doc.markModified('outline');
    }
    slides = outlineToSlides(outline, doc.images);
  }

  const requested = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const title = (requested || doc.title).slice(0, MAX_TITLE_LENGTH);
  const deck = await Deck.create({ title, ownerId: req.userId, slides });

  doc.deckIds.push(deck._id);
  await doc.save();

  res.status(201).json({ id: deck._id.toString(), title: deck.title, slideCount: deck.slides.length, mode });
}

// Deletes the stored import. Presentations made from it are kept.
export async function deleteImport(req, res) {
  const doc = await findOwned(req, res);
  if (!doc) return;
  await doc.deleteOne();
  res.status(204).end();
}
