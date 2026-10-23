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
  addCollaborator,
  removeCollaborator
} from '../controllers/deckController.js';
import { importPdf } from '../controllers/ingestController.js';

const router = Router();

// Memory storage — the file never touches disk. Fine for now given PDF
// decks are a few MB at most; revisit if very large files become common.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    }
    cb(null, true);
  }
});

// Upload problems are the client's fault, so answer them with a 4xx
// here instead of letting them fall through to the generic 500 handler.
function uploadPdf(req, res, next) {
  upload.single('pdf')(req, res, (err) => {
    if (!err) return next();
    if (!(err instanceof multer.MulterError)) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'PDF must be 25MB or smaller' });
    }
    return res.status(400).json({ error: 'Only PDF files are accepted (field name "pdf")' });
  });
}

// Every deck route is editor-only. There is no viewer-facing deck
// endpoint anywhere in this API — viewers only ever see slide content
// via the Socket.io broadcast channel (see sockets/index.js).
router.use(requireAuth);

router.get('/', asyncHandler(listDecks));
router.post('/', asyncHandler(createDeck));
router.post('/import', uploadPdf, asyncHandler(importPdf));
router.get('/:deckId', asyncHandler(getDeck));
router.patch('/:deckId', asyncHandler(updateDeckMeta));
router.put('/:deckId/slides', asyncHandler(updateDeckSlides));
router.post('/:deckId/save', asyncHandler(saveDeck));
router.post('/:deckId/collaborators', asyncHandler(addCollaborator));
router.delete('/:deckId/collaborators/:userId', asyncHandler(removeCollaborator));
router.delete('/:deckId', asyncHandler(deleteDeck));

export default router;