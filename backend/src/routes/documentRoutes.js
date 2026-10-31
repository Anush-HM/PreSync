import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { uploadImportFile } from '../middleware/upload.js';
import {
  createDocument,
  listDocuments,
  getDocument,
  updateDocument,
  deleteDocument,
  importDocx,
  createFromImport,
  exportDocument
} from '../controllers/documentController.js';

// Editor-only: Word documents, independent of presentations.
const router = Router();
router.use(requireAuth);

router.post('/', asyncHandler(createDocument));
router.get('/', asyncHandler(listDocuments));
router.post('/import-docx', uploadImportFile, asyncHandler(importDocx));
router.post('/from-import/:importId', asyncHandler(createFromImport));
router.get('/:id', asyncHandler(getDocument));
router.put('/:id', asyncHandler(updateDocument));
router.delete('/:id', asyncHandler(deleteDocument));
router.get('/:id/export/:format', asyncHandler(exportDocument));

export default router;
