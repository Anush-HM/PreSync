import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createDeckFromTemplate, createTemplate, deleteTemplate, listTemplates } from '../controllers/templateController.js';

const router = Router();

// A user's saved templates. Built-in starter templates live in the
// frontend (data/templates.js) and are created through POST /api/decks.
router.use(requireAuth);

router.get('/', asyncHandler(listTemplates));
router.post('/', asyncHandler(createTemplate));
router.delete('/:templateId', asyncHandler(deleteTemplate));
router.post('/:templateId/decks', asyncHandler(createDeckFromTemplate));

export default router;
