import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listDecks,
  createDeck,
  getDeck,
  updateDeckSlides,
  updateDeckMeta,
  saveDeck,
  deleteDeck,
  duplicateDeck,
  addCollaborator,
  removeCollaborator
} from '../controllers/deckController.js';
import { importDeck } from '../controllers/ingestController.js';
import { exportDeck } from '../controllers/exportController.js';

const router = Router();

// Memory storage — the file never touches disk. Fine for now given
// decks are a few MB at most; revisit if very large files become common.
// The file type is checked by the import controller, which can tell the
// user exactly what is wrong (e.g. a legacy .ppt).
const MAX_UPLOAD_MB = 25;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

// Upload problems are the client's fault, so answer them with a 4xx
// here instead of letting them fall through to the generic 500 handler.
// "file" is the field name; "pdf" is still accepted for older clients.
function uploadDeckFile(req, res, next) {
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'pdf', maxCount: 1 }])(req, res, (err) => {
    if (!err) {
      req.file = req.files?.file?.[0] || req.files?.pdf?.[0];
      return next();
    }
    if (!(err instanceof multer.MulterError)) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File must be ${MAX_UPLOAD_MB}MB or smaller` });
    }
    return res.status(400).json({ error: 'Upload one .pdf or .pptx file in the "file" field' });
  });
}

// Every deck route is editor-only. There is no viewer-facing deck
// endpoint anywhere in this API — viewers only ever see slide content
// via the Socket.io broadcast channel (see sockets/index.js).
router.use(requireAuth);

router.get('/', asyncHandler(listDecks));
router.post('/', asyncHandler(createDeck));
router.post('/import', uploadDeckFile, asyncHandler(importDeck));
router.get('/:deckId', asyncHandler(getDeck));
router.patch('/:deckId', asyncHandler(updateDeckMeta));
router.put('/:deckId/slides', asyncHandler(updateDeckSlides));
router.post('/:deckId/save', asyncHandler(saveDeck));
router.post('/:deckId/duplicate', asyncHandler(duplicateDeck));
router.get('/:deckId/export', asyncHandler(exportDeck));
router.post('/:deckId/collaborators', asyncHandler(addCollaborator));
router.delete('/:deckId/collaborators/:userId', asyncHandler(removeCollaborator));
router.delete('/:deckId', asyncHandler(deleteDeck));

export default router;