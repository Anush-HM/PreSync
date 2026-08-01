import { apiFetch } from './apiConfig.js';

export async function listDecks() {
  return apiFetch('/api/decks');
}

export async function createDeck(title) {
  return apiFetch('/api/decks', {
    method: 'POST',
    body: JSON.stringify({ title })
  });
}

export async function getDeck(deckId) {
  return apiFetch(`/api/decks/${deckId}`);
}

export async function deleteDeck(deckId) {
  return apiFetch(`/api/decks/${deckId}`, { method: 'DELETE' });
}

// PDF import — multipart, so apiFetch's JSON header logic backs off
// automatically for FormData bodies.
export async function importDeckPdf(file) {
  const form = new FormData();
  form.append('pdf', file);
  return apiFetch('/api/decks/import', {
    method: 'POST',
    body: form
  });
}