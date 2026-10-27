// Central place for the backend origin, since nothing in the frontend
// talked to the real backend yet (it all ran on mock data). Swap
// via a .env VITE_API_URL for non-local setups.
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
export const WS_BASE = API_BASE.replace(/^http/, 'ws');

const TOKEN_KEY = 'presync:token';
const USER_KEY = 'presync:user';

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setAuthToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getCurrentUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function isLoggedIn() {
  return !!getAuthToken();
}

// Shared fetch wrapper for editor-only REST calls — attaches the bearer
// token and throws with the backend's error message on non-2xx so
// callers can show it directly instead of a generic "failed" string.
// On a 401, clears auth and reloads to the login page so an expired or
// revoked token never silently strands the user on a broken page.
export async function apiFetch(path, options = {}) {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  // Expired / invalid token — clear auth and redirect so the user lands
  // on the login page with proper "from" state preserved.
  if (res.status === 401) {
    clearAuthToken();
    const from = window.location.pathname;
    window.location.href = `/login?next=${encodeURIComponent(from)}`;
    // Throw so the calling code's catch block also stops processing.
    throw new Error('Session expired. Please sign in again.');
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let body = null;
    try {
      body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    // Status and the backend's error code ride along for callers that
    // react to specific failures (e.g. the Copilot's rate-limit notice).
    const err = new Error(message);
    err.status = res.status;
    if (body?.code) err.code = body.code;
    if (body?.retryAfter) err.retryAfter = body.retryAfter;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}