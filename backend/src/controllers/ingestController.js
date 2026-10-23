import Deck from '../models/Deck.js';
import { extractSlidesFromPdf } from '../services/pdfIngestService.js';
import { extractSlidesFromPptx } from '../services/pptxIngestService.js';

const PDF_MIME = 'application/pdf';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const LEGACY_PPT_MIME = 'application/vnd.ms-powerpoint';

// Browsers often send .pptx as application/octet-stream, so the
// extension counts as much as the declared type.
export function detectFormat(file) {
  const ext = (file.originalname.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  if (ext === 'pdf' || file.mimetype === PDF_MIME) return 'pdf';
  if (ext === 'pptx' || file.mimetype === PPTX_MIME) return 'pptx';
  if (ext === 'ppt' || file.mimetype === LEGACY_PPT_MIME) return 'ppt';
  return null;
}

const EXTRACTORS = {
  pdf: { extract: extractSlidesFromPdf, label: 'PDF' },
  pptx: { extract: extractSlidesFromPptx, label: 'PowerPoint file' }
};

// Editor-only: uploads a PDF or .pptx, extracts real editable content,
// and creates a new Deck owned by the uploading user. This is the only
// way a Deck's slides get their initial content — everything after this
// point is live editing via Yjs.
export async function importDeck(req, res) {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded (expected field name "file")' });
  }

  const format = detectFormat(file);
  if (format === 'ppt') {
    return res.status(415).json({
      error: 'Legacy .ppt files are not supported. Open it in PowerPoint, Keynote or Google Slides and save it as .pptx, then import that.'
    });
  }
  if (!format) {
    return res.status(400).json({ error: 'Only PDF (.pdf) and PowerPoint (.pptx) files can be imported' });
  }

  const { extract, label } = EXTRACTORS[format];
  let slides;
  try {
    slides = await extract(file.buffer);
  } catch (err) {
    return res.status(422).json({ error: `Could not parse ${label}: ${err.message}` });
  }

  const title = req.body.title?.trim() || file.originalname.replace(/\.(pdf|pptx)$/i, '');

  const deck = await Deck.create({
    title,
    ownerId: req.userId,
    slides
  });

  res.status(201).json({
    id: deck._id,
    title: deck.title,
    format,
    slideCount: deck.slides.length,
    slides: deck.slides
  });
}
