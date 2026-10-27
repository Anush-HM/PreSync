import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getAiConfig } from '../ai/config.js';
import { createRateLimiter } from '../ai/rateLimit.js';
import {
  assist,
  clearConversations,
  createConversation,
  deleteConversation,
  getConversation,
  getStatus,
  listConversations,
  updateActionStatus
} from '../controllers/aiController.js';

// AI Copilot API. Editor-only, like the deck routes; only the model
// call itself is rate limited.
export const assistLimiter = createRateLimiter({ limit: () => getAiConfig().rateLimitPerMinute });

const router = Router();
router.use(requireAuth);

router.get('/status', getStatus);
router.get('/decks/:deckId/conversations', listConversations);
router.post('/decks/:deckId/conversations', createConversation);
router.delete('/decks/:deckId/conversations', clearConversations);
router.post('/decks/:deckId/assist', assistLimiter, assist);
router.get('/conversations/:conversationId', getConversation);
router.delete('/conversations/:conversationId', deleteConversation);
router.patch('/conversations/:conversationId/messages/:messageId/actions/:index', updateActionStatus);

export default router;
