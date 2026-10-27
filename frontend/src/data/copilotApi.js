import { apiFetch } from './apiConfig.js';

// REST calls for the AI Copilot (backend/src/routes/aiRoutes.js). The
// API key never reaches the browser; these only talk to PreSync.

export function getCopilotStatus() {
  return apiFetch('/api/ai/status');
}

export function listConversations(deckId) {
  return apiFetch(`/api/ai/decks/${deckId}/conversations`);
}

export function getConversation(conversationId) {
  return apiFetch(`/api/ai/conversations/${conversationId}`);
}

export function deleteConversation(conversationId) {
  return apiFetch(`/api/ai/conversations/${conversationId}`, { method: 'DELETE' });
}

export function clearConversations(deckId) {
  return apiFetch(`/api/ai/decks/${deckId}/conversations`, { method: 'DELETE' });
}

// { conversationId?, message, mode, brief?, context, history? }
export function askCopilot(deckId, body, { signal } = {}) {
  return apiFetch(`/api/ai/decks/${deckId}/assist`, {
    method: 'POST',
    body: JSON.stringify({ ...body, dataConsent: true }),
    signal
  });
}

export function setActionStatus(conversationId, messageId, index, status) {
  return apiFetch(`/api/ai/conversations/${conversationId}/messages/${messageId}/actions/${index}`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
}
