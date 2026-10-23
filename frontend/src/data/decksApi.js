import { API_BASE, apiFetch, getAuthToken } from './apiConfig.js';

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

export async function updateDeckSlides(deckId, slides) {
  return apiFetch(`/api/decks/${deckId}/slides`, {
    method: 'PUT',
    body: JSON.stringify({ slides })
  });
}

// File types the import endpoint understands (legacy .ppt is refused
// with an explanation, so it's offered in the picker too).
export const IMPORT_ACCEPT = '.pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation';

// PDF / PPTX import — multipart, so apiFetch's JSON header logic backs
// off automatically for FormData bodies.
export async function importDeckFile(file) {
  const form = new FormData();
  form.append('file', file);
  return apiFetch('/api/decks/import', {
    method: 'POST',
    body: form
  });
}

// Owner-only: invite a collaborator by email. Returns updated deck meta.
export async function addCollaborator(deckId, email) {
  return apiFetch(`/api/decks/${deckId}/collaborators`, {
    method: 'POST',
    body: JSON.stringify({ email })
  });
}

// Owner-only: remove a collaborator by userId. Returns updated deck meta.
export async function removeCollaborator(deckId, userId) {
  return apiFetch(`/api/decks/${deckId}/collaborators/${userId}`, {
    method: 'DELETE'
  });
}
// Any editor: rename the deck. Returns updated deck meta.
export async function renameDeck(deckId, title) {
  return apiFetch(`/api/decks/${deckId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title })
  });
}

// Flush the live co-editing document to the database right now.
// Resolves to { savedAt, flushed }.
export async function saveDeck(deckId) {
  return apiFetch(`/api/decks/${deckId}/save`, { method: 'POST' });
}

export const EXPORT_FORMATS = {
  pdf: { label: 'PDF (.pdf)', ext: 'pdf' },
  pptx: { label: 'PowerPoint (.pptx)', ext: 'pptx' }
};

function fileNameFrom(res, fallback) {
  const header = res.headers.get('Content-Disposition') || '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain ? plain[1] : fallback;
}

// Downloads the deck as a PDF or PPTX file. Uses fetch directly (not
// apiFetch) because the response is a binary file, not JSON.
export async function downloadDeckExport(deckId, format) {
  const res = await fetch(`${API_BASE}/api/decks/${deckId}/export?format=${format}`, {
    headers: { Authorization: `Bearer ${getAuthToken()}` }
  });
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // not JSON — keep the generic message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameFrom(res, `deck.${EXPORT_FORMATS[format].ext}`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
