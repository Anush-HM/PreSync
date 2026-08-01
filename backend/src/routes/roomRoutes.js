import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  goLive,
  joinRoom,
  getRoomByCode,
  endRoom,
  getViewerNotes,
  saveViewerNote
} from '../controllers/roomController.js';

const router = Router();

// Editor-only.
router.post('/go-live', requireAuth, asyncHandler(goLive));
router.post('/:roomId/end', requireAuth, asyncHandler(endRoom));

// Deliberately unauthenticated — this is the viewer join-by-code path.
// No JWT is ever checked here, which is what makes the access boundary
// architectural rather than just a permissions check.
router.get('/:code', asyncHandler(getRoomByCode));
router.post('/:code/join', asyncHandler(joinRoom));
router.get('/:code/notes/:viewerId', asyncHandler(getViewerNotes));
router.put('/:code/notes/:viewerId', asyncHandler(saveViewerNote));

export default router;