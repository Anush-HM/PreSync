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
  exportDocument,
  saveDocument,
  shareDocument,
  updateShare,
  removeShare
} from '../controllers/documentController.js';
import {
  createDocumentComment,
  createDocumentVersion,
  deleteDocumentComment,
  getDocumentVersion,
  listDocumentComments,
  listDocumentVersions,
  replyToDocumentComment,
  restoreDocumentVersion,
  updateDocumentComment,
  updateDocumentVersion
} from '../controllers/documentCollabController.js';

// Word documents, independent of presentations. Owners, editors and
// viewers each get what services/documentAccess.js allows them.
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
router.post('/:id/save', asyncHandler(saveDocument));
router.post('/:id/share', asyncHandler(shareDocument));
router.patch('/:id/share/:userId', asyncHandler(updateShare));
router.delete('/:id/share/:userId', asyncHandler(removeShare));
router.get('/:id/comments', asyncHandler(listDocumentComments));
router.post('/:id/comments', asyncHandler(createDocumentComment));
router.post('/:id/comments/:commentId/replies', asyncHandler(replyToDocumentComment));
router.patch('/:id/comments/:commentId', asyncHandler(updateDocumentComment));
router.delete('/:id/comments/:commentId', asyncHandler(deleteDocumentComment));
router.get('/:id/versions', asyncHandler(listDocumentVersions));
router.post('/:id/versions', asyncHandler(createDocumentVersion));
router.get('/:id/versions/:versionId', asyncHandler(getDocumentVersion));
router.patch('/:id/versions/:versionId', asyncHandler(updateDocumentVersion));
router.post('/:id/versions/:versionId/restore', asyncHandler(restoreDocumentVersion));

export default router;
