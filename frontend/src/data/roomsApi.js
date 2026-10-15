import { apiFetch, API_BASE } from './apiConfig.js';

// Editor-only — starts a live session for a deck. Returns { code, roomId }.
export async function goLive(deckId) {
  return apiFetch('/api/rooms/go-live', {
    method: 'POST',
    body: JSON.stringify({ deckId })
  });
}

// Editor-only — ends the session so viewers stop receiving updates and
// the code can no longer be joined.
export async function endRoom(roomId) {
  return apiFetch(`/api/rooms/${roomId}/end`, { method: 'POST' });
}

// Unauthenticated join-by-code path — no bearer token involved, so this
// calls the backend directly rather than through apiFetch.
export async function joinRoomByCode(code, displayName) {
  const res = await fetch(`${API_BASE}/api/rooms/${code.toUpperCase()}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not join that session');
  }
  return res.json(); // { viewerId, roomId, currentSlideId }
}

export async function getRoomByCode(code) {
  const res = await fetch(`${API_BASE}/api/rooms/${code.toUpperCase()}`);
  if (!res.ok) return null;
  return res.json();
}

// Editor-only — fetches past session history for a deck with viewer names.
// Returns { sessions: [{ roomId, code, createdAt, durationMin, viewerCount, viewers, questions }] }
export async function getSessionHistory(deckId) {
  return apiFetch(`/api/rooms/history/${deckId}`);
}