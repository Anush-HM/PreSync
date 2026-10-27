import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { uploadImportFile } from '../middleware/upload.js';
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

// Every deck route is editor-only. There is no viewer-facing deck
// endpoint anywhere in this API — viewers only ever see slide content
// via the Socket.io broadcast channel (see sockets/index.js).
router.use(requireAuth);

router.get('/', asyncHandler(listDecks));
router.post('/', asyncHandler(createDeck));
router.post('/import', uploadImportFile, asyncHandler(importDeck));
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