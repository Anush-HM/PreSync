import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  API_BASE,
  apiFetch,
  clearAuthToken,
  getAuthToken,
  getCurrentUser,
  isLoggedIn,
  setAuthToken,
  setCurrentUser
} from './apiConfig.js';

function jsonResponse(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('auth storage', () => {
  it('stores and clears the token and user', () => {
    expect(isLoggedIn()).toBe(false);
    setAuthToken('abc');
    setCurrentUser({ id: 'u1', name: 'Priya' });
    expect(isLoggedIn()).toBe(true);
    expect(getAuthToken()).toBe('abc');
    expect(getCurrentUser()).toEqual({ id: 'u1', name: 'Priya' });

    clearAuthToken();
    expect(isLoggedIn()).toBe(false);
    expect(getCurrentUser()).toBeNull();
  });

  it('returns null for a corrupted stored user', () => {
    localStorage.setItem('presync:user', '{not json');
    expect(getCurrentUser()).toBeNull();
  });
});

describe('apiFetch', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends the bearer token and a JSON content type for JSON bodies', async () => {
    setAuthToken('tok');
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    const data = await apiFetch('/api/decks', { method: 'POST', body: '{}' });

    expect(data).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/decks`);
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok'
    });
  });

  it('leaves the content type to the browser for FormData uploads', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await apiFetch('/api/decks/import', { method: 'POST', body: new FormData() });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
  });

  it("throws the backend's error message on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Deck not found' }));
    await expect(apiFetch('/api/decks/x')).rejects.toThrow('Deck not found');
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }));
    await expect(apiFetch('/api/decks')).rejects.toThrow('Request failed (500)');
  });

  it('returns null for 204 responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiFetch('/api/decks/x', { method: 'DELETE' })).resolves.toBeNull();
  });

  it('clears auth and sends the user to login on a 401', async () => {
    setAuthToken('expired');
    setCurrentUser({ id: 'u1' });
    const location = { pathname: '/decks', href: '' };
    vi.stubGlobal('location', location);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    await expect(apiFetch('/api/decks')).rejects.toThrow('Session expired');
    expect(isLoggedIn()).toBe(false);
    expect(getCurrentUser()).toBeNull();
    expect(location.href).toBe('/login?next=%2Fdecks');
  });
});
