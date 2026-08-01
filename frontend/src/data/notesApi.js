import { API_BASE } from './apiConfig.js';

export async function fetchNotes(roomCode, viewerId) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/notes/${viewerId}`);
  if (!res.ok) return {};
  const { notes } = await res.json();
  // [{ slideId, text, updatedAt }] -> { [slideId]: text }, matching the
  // shape ViewerLivePage already keeps in local state.
  return Object.fromEntries(notes.map((n) => [n.slideId, n.text]));
}

export async function saveNote(roomCode, viewerId, slideId, text) {
  await fetch(`${API_BASE}/api/rooms/${roomCode}/notes/${viewerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slideId, text })
  });
}