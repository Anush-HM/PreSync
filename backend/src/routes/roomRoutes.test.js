import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../models/Deck.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../models/Room.js', () => ({
  default: { findOne: vi.fn(), findById: vi.fn(), create: vi.fn() }
}));
vi.mock('../models/Viewer.js', () => ({ default: { findOne: vi.fn(), create: vi.fn() } }));

const { default: Deck } = await import('../models/Deck.js');
const { default: Room } = await import('../models/Room.js');
const { default: Viewer } = await import('../models/Viewer.js');
const { startTestServer, tokenFor } = await import('../test/httpServer.js');

const PRESENTER_ID = '64b000000000000000000001';
const COLLAB_ID = '64b000000000000000000002';
const STRANGER_ID = '64b000000000000000000003';
const DECK_ID = '64b0000000000000000000d1';
const ROOM_ID = '64b0000000000000000000a1';

const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

function makeRoom(overrides = {}) {
  return {
    _id: ROOM_ID,
    code: 'ABC234',
    deckId: DECK_ID,
    presenterId: PRESENTER_ID,
    currentSlideId: 's1',
    active: true,
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function makeViewer(notes = []) {
  return { viewerId: 'viewer-1', roomId: ROOM_ID, notes, save: vi.fn().mockResolvedValue(undefined) };
}

let server;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(() => server.close());

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('POST /api/rooms/go-live', () => {
  const goLive = (userId) =>
    server.request('POST', '/api/rooms/go-live', { token: tokenFor(userId), body: { deckId: DECK_ID } });

  it('requires a login', async () => {
    const res = await server.request('POST', '/api/rooms/go-live', { body: { deckId: DECK_ID } });
    expect(res.status).toBe(401);
    expect(Room.create).not.toHaveBeenCalled();
  });

  it('404s for a missing deck', async () => {
    Deck.findById.mockResolvedValue(null);
    expect((await goLive(PRESENTER_ID)).status).toBe(404);
  });

  it('403s for a user who is not on the deck', async () => {
    Deck.findById.mockResolvedValue({ _id: DECK_ID, ownerId: PRESENTER_ID, collaboratorIds: [], slides: [] });
    expect((await goLive(STRANGER_ID)).status).toBe(403);
    expect(Room.create).not.toHaveBeenCalled();
  });

  it('lets a collaborator go live on the first slide with a fresh code', async () => {
    Deck.findById.mockResolvedValue({
      _id: DECK_ID,
      ownerId: PRESENTER_ID,
      collaboratorIds: [COLLAB_ID],
      slides: [{ id: 's1' }, { id: 's2' }]
    });
    Room.create.mockImplementation(async (doc) => ({ _id: ROOM_ID, ...doc }));

    const res = await goLive(COLLAB_ID);

    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(CODE_PATTERN);
    expect(res.body.roomId).toBe(ROOM_ID);
    expect(Room.create).toHaveBeenCalledWith({
      code: res.body.code,
      deckId: DECK_ID,
      presenterId: COLLAB_ID,
      currentSlideId: 's1'
    });
  });

  it('retries with a new code when the insert hits a duplicate code', async () => {
    Deck.findById.mockResolvedValue({ _id: DECK_ID, ownerId: PRESENTER_ID, collaboratorIds: [], slides: [] });
    const dup = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    Room.create
      .mockRejectedValueOnce(dup)
      .mockImplementationOnce(async (doc) => ({ _id: ROOM_ID, ...doc }));

    const res = await goLive(PRESENTER_ID);

    expect(res.status).toBe(201);
    expect(Room.create).toHaveBeenCalledTimes(2);
    expect(Room.create.mock.calls[1][0].code).toBe(res.body.code);
  });

  it('returns a clear 503 when every code attempt collides', async () => {
    Deck.findById.mockResolvedValue({ _id: DECK_ID, ownerId: PRESENTER_ID, collaboratorIds: [], slides: [] });
    Room.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }));

    const res = await goLive(PRESENTER_ID);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/room code/);
    expect(Room.create).toHaveBeenCalledTimes(5);
  });

  it('does not retry on other database errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Deck.findById.mockResolvedValue({ _id: DECK_ID, ownerId: PRESENTER_ID, collaboratorIds: [], slides: [] });
    Room.create.mockRejectedValue(new Error('connection lost'));

    const res = await goLive(PRESENTER_ID);

    expect(res.status).toBe(500);
    expect(Room.create).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/rooms/:roomId/end', () => {
  it('only lets the presenter end the session', async () => {
    const room = makeRoom();
    Room.findById.mockResolvedValue(room);
    const res = await server.request('POST', `/api/rooms/${ROOM_ID}/end`, { token: tokenFor(STRANGER_ID) });
    expect(res.status).toBe(403);
    expect(room.save).not.toHaveBeenCalled();
  });

  it('marks the room inactive and tells everyone connected', async () => {
    const room = makeRoom();
    Room.findById.mockResolvedValue(room);
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    server.app.set('io', { to });

    const res = await server.request('POST', `/api/rooms/${ROOM_ID}/end`, { token: tokenFor(PRESENTER_ID) });

    expect(res.status).toBe(204);
    expect(room.active).toBe(false);
    expect(room.save).toHaveBeenCalled();
    expect(to).toHaveBeenCalledWith('room:ABC234');
    expect(emit).toHaveBeenCalledWith('room:ended');
    server.app.set('io', undefined);
  });
});

describe('GET /api/rooms/:code', () => {
  it('needs no login and matches the code case-insensitively', async () => {
    Room.findOne.mockResolvedValue(makeRoom());
    const res = await server.request('GET', '/api/rooms/abc234');
    expect(res.status).toBe(200);
    expect(Room.findOne).toHaveBeenCalledWith({ code: 'ABC234', active: true });
    expect(res.body).toEqual({ code: 'ABC234', active: true, currentSlideId: 's1' });
  });

  it('404s when no session is active for the code', async () => {
    Room.findOne.mockResolvedValue(null);
    expect((await server.request('GET', '/api/rooms/ZZZ999')).status).toBe(404);
  });
});

describe('POST /api/rooms/:code/join', () => {
  it('requires a display name', async () => {
    const res = await server.request('POST', '/api/rooms/ABC234/join', { body: { displayName: '  ' } });
    expect(res.status).toBe(400);
    expect(Room.findOne).not.toHaveBeenCalled();
  });

  it('404s for a code with no active session', async () => {
    Room.findOne.mockResolvedValue(null);
    const res = await server.request('POST', '/api/rooms/ABC234/join', { body: { displayName: 'Sam' } });
    expect(res.status).toBe(404);
    expect(Viewer.create).not.toHaveBeenCalled();
  });

  it('creates a viewer and returns only what the viewer needs', async () => {
    Room.findOne.mockResolvedValue(makeRoom());
    const res = await server.request('POST', '/api/rooms/abc234/join', { body: { displayName: ' Sam ' } });

    expect(res.status).toBe(201);
    expect(res.body.viewerId).toMatch(/^viewer-/);
    expect(res.body).toEqual({ viewerId: res.body.viewerId, roomId: ROOM_ID, currentSlideId: 's1' });
    expect(Viewer.create).toHaveBeenCalledWith({
      viewerId: res.body.viewerId,
      roomId: ROOM_ID,
      displayName: 'Sam'
    });
  });
});

describe('viewer notes', () => {
  const notesPath = '/api/rooms/abc234/notes/viewer-1';

  it('404s for an unknown viewer', async () => {
    Viewer.findOne.mockResolvedValue(null);
    const res = await server.request('GET', notesPath);
    expect(res.status).toBe(404);
    expect(Viewer.findOne).toHaveBeenCalledWith({ viewerId: 'viewer-1' });
  });

  it('404s for a viewer whose room has a different code', async () => {
    Viewer.findOne.mockResolvedValue(makeViewer([{ slideId: 's1', text: 'private' }]));
    Room.findById.mockResolvedValue(makeRoom({ code: 'ZZZ999' }));
    const res = await server.request('GET', notesPath);
    expect(res.status).toBe(404);
    expect(res.body.notes).toBeUndefined();
  });

  it("returns the viewer's own notes", async () => {
    Viewer.findOne.mockResolvedValue(makeViewer([{ slideId: 's1', text: 'remember this' }]));
    Room.findById.mockResolvedValue(makeRoom());
    const res = await server.request('GET', notesPath);
    expect(res.status).toBe(200);
    expect(res.body.notes).toEqual([{ slideId: 's1', text: 'remember this' }]);
    expect(Room.findById).toHaveBeenCalledWith(ROOM_ID);
  });

  // Codes are reused after a room ends. Looking the room up by code would
  // hit whichever room Mongo returned first; the viewer's own room must win.
  it('finds the viewer in the active room when an ended room shares its code', async () => {
    const NEW_ROOM_ID = '64b0000000000000000000a2';
    const oldRoom = makeRoom({ active: false });
    const newRoom = makeRoom({ _id: NEW_ROOM_ID });
    Room.findOne.mockResolvedValue(oldRoom);
    Room.findById.mockImplementation(async (id) => (id === NEW_ROOM_ID ? newRoom : oldRoom));
    const viewer = { ...makeViewer(), roomId: NEW_ROOM_ID };
    Viewer.findOne.mockImplementation(async (query) =>
      query.viewerId === viewer.viewerId && (!query.roomId || query.roomId === viewer.roomId)
        ? viewer
        : null
    );

    const res = await server.request('PUT', notesPath, { body: { slideId: 's1', text: 'new session' } });
    expect(res.status).toBe(200);
    expect(viewer.notes[0]).toMatchObject({ slideId: 's1', text: 'new session' });
    expect(viewer.save).toHaveBeenCalled();
  });

  it('still saves notes after the session has ended', async () => {
    const viewer = makeViewer();
    Viewer.findOne.mockResolvedValue(viewer);
    Room.findById.mockResolvedValue(makeRoom({ active: false }));
    const res = await server.request('PUT', notesPath, { body: { slideId: 's1', text: 'after' } });
    expect(res.status).toBe(200);
    expect(viewer.save).toHaveBeenCalled();
  });

  it('requires a slide id when saving', async () => {
    const res = await server.request('PUT', notesPath, { body: { text: 'hi' } });
    expect(res.status).toBe(400);
  });

  it('adds a note for a new slide', async () => {
    const viewer = makeViewer();
    Viewer.findOne.mockResolvedValue(viewer);
    Room.findById.mockResolvedValue(makeRoom());
    const res = await server.request('PUT', notesPath, { body: { slideId: 's2', text: 'new' } });
    expect(res.status).toBe(200);
    expect(viewer.notes).toHaveLength(1);
    expect(viewer.notes[0]).toMatchObject({ slideId: 's2', text: 'new' });
    expect(viewer.save).toHaveBeenCalled();
  });

  it('updates the existing note for a slide instead of adding another', async () => {
    const viewer = makeViewer([{ slideId: 's1', text: 'old', updatedAt: new Date(0) }]);
    Viewer.findOne.mockResolvedValue(viewer);
    Room.findById.mockResolvedValue(makeRoom());
    const res = await server.request('PUT', notesPath, { body: { slideId: 's1', text: 'edited' } });
    expect(res.status).toBe(200);
    expect(viewer.notes).toHaveLength(1);
    expect(viewer.notes[0].text).toBe('edited');
    expect(viewer.notes[0].updatedAt.getTime()).toBeGreaterThan(0);
  });
});
