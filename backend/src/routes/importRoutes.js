import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { uploadImportFile } from '../middleware/upload.js';
import {
  analyzeImport,
  listImports,
  getImport,
  saveImportOutline,
  createDeckFromImport,
  deleteImport
} from '../controllers/importController.js';

// Editor-only: upload a Word, PowerPoint or PDF file, review what was
// extracted, then create presentations from it.
const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(listImports));
router.post('/', uploadImportFile, asyncHandler(analyzeImport));
router.get('/:importId', asyncHandler(getImport));
router.put('/:importId/outline', asyncHandler(saveImportOutline));
router.post('/:importId/decks', asyncHandler(createDeckFromImport));
router.delete('/:importId', asyncHandler(deleteImport));

export default router;
