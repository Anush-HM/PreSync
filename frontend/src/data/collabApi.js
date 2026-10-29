import { apiFetch } from './apiConfig.js';

// Version history: [{ id, label, kind, createdAt, slideCount, author, thumbnail }].
export const listVersions = (deckId) => apiFetch(`/api/decks/${deckId}/versions`);
export const getVersion = (deckId, versionId) => apiFetch(`/api/decks/${deckId}/versions/${versionId}`);
export const saveVersion = (deckId, label = '', kind = 'manual') =>
  apiFetch(`/api/decks/${deckId}/versions`, { method: 'POST', body: JSON.stringify({ label, kind }) });
export const renameVersion = (deckId, versionId, label) =>
  apiFetch(`/api/decks/${deckId}/versions/${versionId}`, { method: 'PATCH', body: JSON.stringify({ label }) });

// Comment threads: [{ id, slideId, blockId, text, author, createdAt, resolved, replies }].
export const listComments = (deckId) => apiFetch(`/api/decks/${deckId}/comments`);
export const addComment = (deckId, { slideId, blockId, text }) =>
  apiFetch(`/api/decks/${deckId}/comments`, { method: 'POST', body: JSON.stringify({ slideId, blockId, text }) });
export const replyToComment = (deckId, id, text) =>
  apiFetch(`/api/decks/${deckId}/comments/${id}/replies`, { method: 'POST', body: JSON.stringify({ text }) });
export const updateComment = (deckId, id, patch) =>
  apiFetch(`/api/decks/${deckId}/comments/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteComment = (deckId, id) => apiFetch(`/api/decks/${deckId}/comments/${id}`, { method: 'DELETE' });

const KIND_LABELS = { auto: 'Automatic', restore: 'Before restoring', manual: 'Saved version' };

// A version's name for lists: its label, else what made it.
export function versionName(v) {
  return v.label || KIND_LABELS[v.kind] || 'Version';
}

// Groups threads for the panel: open ones on the current slide first,
// then other open ones, then resolved ones (only when asked for).
export function sortThreads(threads, slides, activeSlideId, { showResolved = false } = {}) {
  const order = new Map(slides.map((s, i) => [s.id, i]));
  const pos = (t) => (order.has(t.slideId) ? order.get(t.slideId) : Number.MAX_SAFE_INTEGER);
  return threads
    .filter((t) => showResolved || !t.resolved)
    .sort((a, b) =>
      Number(a.resolved) - Number(b.resolved)
      || Number(b.slideId === activeSlideId) - Number(a.slideId === activeSlideId)
      || pos(a) - pos(b)
      || new Date(a.createdAt) - new Date(b.createdAt));
}
