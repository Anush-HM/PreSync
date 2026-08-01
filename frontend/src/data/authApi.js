import { apiFetch, setAuthToken, setCurrentUser } from './apiConfig.js';

// Both calls return { token, user }. We persist both here so every other
// page can assume getAuthToken()/getCurrentUser() are already populated
// once this resolves.
export async function register({ email, password, name }) {
  const data = await apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name })
  });
  setAuthToken(data.token);
  setCurrentUser(data.user);
  return data.user;
}

export async function login({ email, password }) {
  const data = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  setAuthToken(data.token);
  setCurrentUser(data.user);
  return data.user;
}