import Deck from '../models/Deck.js';
import { extractSlidesFromPdf } from '../services/pdfIngestService.js';

// Editor-only: uploads a PDF, extracts real editable text content, and
// creates a new Deck owned by the uploading user. This is the only way
// a Deck's slides get their initial content — everything after this
// point is live editing via Yjs.
export async function importPdf(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file uploaded (expected field name "pdf")' });
  }
  if (req.file.mimetype !== 'application/pdf') {
    return res.status(400).json({ error: 'Uploaded file must be a PDF' });
  }

  let slides;
  try {
    slides = await extractSlidesFromPdf(req.file.buffer);
  } catch (err) {
    return res.status(422).json({ error: `Could not parse PDF: ${err.message}` });
  }

  const title = req.body.title?.trim() || req.file.originalname.replace(/\.pdf$/i, '');

  const deck = await Deck.create({
    title,
    ownerId: req.userId,
    slides
  });

  res.status(201).json({
    id: deck._id,
    title: deck.title,
    slideCount: deck.slides.length,
    slides: deck.slides
  });
}