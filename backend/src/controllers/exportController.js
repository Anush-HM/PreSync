import Deck from '../models/Deck.js';
import { isEditorOf } from './deckController.js';
import { flushDoc } from '../yjs/docManager.js';
import { exportDeckToPdf, exportDeckToPptx, exportFileName } from '../services/deckExportService.js';

const FORMATS = {
  pdf: { render: exportDeckToPdf, type: 'application/pdf' },
  pptx: {
    render: exportDeckToPptx,
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  }
};

// Editor-only: GET /api/decks/:deckId/export?format=pdf|pptx. Flushes
// any live co-editing session first so the file has the latest edits.
export async function exportDeck(req, res) {
  const format = String(req.query.format || '').toLowerCase();
  const spec = FORMATS[format];
  if (!spec) return res.status(400).json({ error: 'format must be "pdf" or "pptx"' });

  const access = await Deck.findById(req.params.deckId);
  if (!access) return res.status(404).json({ error: 'Deck not found' });
  if (!isEditorOf(access, req.userId)) return res.status(403).json({ error: 'Not a collaborator on this deck' });

  // Re-read after the flush so live edits are included.
  const flushed = await flushDoc(req.params.deckId);
  const deck = flushed ? await Deck.findById(req.params.deckId) : access;

  const file = await spec.render(deck.toObject ? deck.toObject() : deck);
  const name = exportFileName(deck.title, format);
  res.set({
    'Content-Type': spec.type,
    'Content-Length': file.length,
    'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    // The editor runs on another origin and reads the name from here.
    'Access-Control-Expose-Headers': 'Content-Disposition'
  });
  res.send(file);
}
