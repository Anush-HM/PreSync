import Deck from '../models/Deck.js';
import { extractSlidesFromPdf } from '../services/pdfIngestService.js';
import { extractSlidesFromPptx } from '../services/pptxIngestService.js';
import { parseDocx } from '../services/docxIngestService.js';
import { analyzeDocx, outlineToSlides } from '../services/documentAnalysis.js';
import { detectFormat, FORMAT_LABELS, unsupportedFormatError } from '../services/importService.js';

// Word documents go through the same outline step as the review flow,
// using the suggested outline unchanged.
async function extractSlidesFromDocx(buffer, fileName) {
  const parsed = await parseDocx(buffer);
  const { outline } = analyzeDocx(parsed, fileName);
  return { slides: outlineToSlides(outline, parsed.images, parsed.blocks) };
}

const EXTRACTORS = {
  pdf: (file) => extractSlidesFromPdf(file.buffer),
  pptx: (file) => extractSlidesFromPptx(file.buffer),
  docx: (file) => extractSlidesFromDocx(file.buffer, file.originalname)
};

// Editor-only: uploads a file and straight away creates a new Deck owned
// by the uploading user, with no review step. The dashboard uses the
// /api/imports flow instead, which lets the user review first.
export async function importDeck(req, res) {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded (expected field name "file")' });
  }

  const format = detectFormat(file);
  const unsupported = unsupportedFormatError(format);
  if (unsupported) return res.status(unsupported.status).json({ error: unsupported.error });

  let extracted;
  try {
    extracted = await EXTRACTORS[format](file);
  } catch (err) {
    return res.status(422).json({ error: `Could not parse ${FORMAT_LABELS[format]}: ${err.message}` });
  }

  const { slides, canvasWidth = 960, canvasHeight = 540 } = extracted;
  const title = req.body.title?.trim() || file.originalname.replace(/\.(pdf|pptx|docx)$/i, '');

  const deck = await Deck.create({
    title,
    ownerId: req.userId,
    slides,
    canvasWidth,
    canvasHeight
  });

  res.status(201).json({
    id: deck._id,
    title: deck.title,
    format,
    slideCount: deck.slides.length,
    slides: deck.slides
  });
}
