import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listDecks,
  createDeck,
  getDeck,
  updateDeckSlides,
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
      return cb(new Error('Only PDF files are accepted'));
    }
    cb(null, true);
  }
});

// Every deck route is editor-only. There is no viewer-facing deck
// endpoint anywhere in this API — viewers only ever see slide content
// via the Socket.io broadcast channel (see sockets/index.js).
router.use(requireAuth);

router.get('/', asyncHandler(listDecks));
router.post('/', asyncHandler(createDeck));
router.post('/import', upload.single('pdf'), asyncHandler(importPdf));
router.get('/:deckId', asyncHandler(getDeck));
router.put('/:deckId/slides', asyncHandler(updateDeckSlides));
router.post('/:deckId/collaborators', asyncHandler(addCollaborator));
router.delete('/:deckId/collaborators/:userId', asyncHandler(removeCollaborator));
router.delete('/:deckId', asyncHandler(deleteDeck));

export default router;