// Stand-in for the Socket.io broadcast channel described in the spec.
// Uses localStorage + the native "storage" event so a presenter tab and a
// viewer tab (same browser) can see each other update live, with zero
// backend. This is scaffolding only — real presenter -> audience sync will
// replace this with actual Socket.io rooms.

const roomKey = (code) => `presync:room:${code}`;

export function publishSlide(code, slideIndex) {
  localStorage.setItem(roomKey(code), JSON.stringify({ slideIndex, ts: Date.now() }));
}

export function readSlide(code) {
  try {
    const raw = localStorage.getItem(roomKey(code));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Subscribe to changes for a given room code. Returns an unsubscribe fn.
export function subscribeToRoom(code, callback) {
  const key = roomKey(code);
  function handler(e) {
    if (e.key === key && e.newValue) {
      callback(JSON.parse(e.newValue));
    }
  }
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}