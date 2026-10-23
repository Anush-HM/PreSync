import { describe, it, expect, vi, beforeEach } from 'vitest';
import { API_BASE } from './apiConfig.js';
import { getRoomByCode, joinRoomByCode } from './roomsApi.js';

describe('roomsApi', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('upper-cases the code and posts the display name when joining', async () => {
    fetchMock.mockResolvedValue(Response.json({ viewerId: 'v1', roomId: 'r1', currentSlideId: 's1' }));

    const result = await joinRoomByCode('k7qx2m', 'Priya');

    expect(result).toEqual({ viewerId: 'v1', roomId: 'r1', currentSlideId: 's1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/rooms/K7QX2M/join`);
    expect(JSON.parse(init.body)).toEqual({ displayName: 'Priya' });
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("surfaces the backend's error when a join fails", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Session has ended' }, { status: 410 }));
    await expect(joinRoomByCode('ABCD', 'Priya')).rejects.toThrow('Session has ended');
  });

  it('uses a generic message when a failed join has no JSON body', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(joinRoomByCode('ABCD', 'Priya')).rejects.toThrow('Could not join that session');
  });

  it('returns null for an unknown room code', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(getRoomByCode('zzzz')).resolves.toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/api/rooms/ZZZZ`);
  });
});
