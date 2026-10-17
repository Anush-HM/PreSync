import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../models/Deck.js', () => ({
  default: { find: vi.fn(), findById: vi.fn(), create: vi.fn() }
}));
vi.mock('../models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../services/pdfIngestService.js', () => ({ extractSlidesFromPdf: vi.fn() }));

const { default: Deck } = await import('../models/Deck.js');
const { default: User } = await import('../models/User.js');
const { extractSlidesFromPdf } = await import('../services/pdfIngestService.js');
const { startTestServer, tokenFor } = await import('../test/httpServer.js');

const OWNER_ID = '64b000000000000000000001';
const COLLAB_ID = '64b000000000000000000002';
const STRANGER_ID = '64b000000000000000000003';
const DECK_ID = '64b0000000000000000000d1';

const users = {
  [OWNER_ID]: { _id: OWNER_ID, email: 'owner@example.com', name: 'Owner' },
  [COLLAB_ID]: { _id: COLLAB_ID, email: 'collab@example.com', name: 'Collab' }
};

// Stands in for a Mongoose deck document: enough of save/deleteOne/
// populate/toObject for the controller's serializeDeck to run for real.
function makeDeck({ collaboratorIds = [COLLAB_ID], slides = [] } = {}) {
  const deck = {
    _id: DECK_ID,
    title: 'Quarterly review',
    ownerId: OWNER_ID,
    collaboratorIds: [...collaboratorIds],
    slides,
    save: vi.fn().mockResolvedValue(undefined),
    deleteOne: vi.fn().mockResolvedValue(undefined),
    populate: vi.fn(async () => ({
      toObject: () => ({
        _id: deck._id,
        title: deck.title,
        ownerId: users[deck.ownerId],
        collaboratorIds: deck.collaboratorIds.map((id) => users[id]),
        slides: deck.slides
      })
    }))
  };
  return deck;
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

describe('auth on deck routes', () => {
  it('rejects a request with no token', async () => {
    const res = await server.request('GET', '/api/decks');
    expect(res.status).toBe(401);
    expect(Deck.find).not.toHaveBeenCalled();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const res = await server.request('GET', '/api/decks', {
      headers: { Authorization: 'Bearer not-a-real-token' }
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });
});

describe('GET /api/decks', () => {
  it('lists only decks the user owns or co-edits', async () => {
    const sort = vi.fn().mockResolvedValue([
      { _id: 'd1', title: 'Mine', updatedAt: '2026-01-01', slides: [{}, {}], ownerId: OWNER_ID },
      { _id: 'd2', title: 'Shared', updatedAt: '2026-01-02', slides: [], ownerId: COLLAB_ID }
    ]);
    Deck.find.mockReturnValue({ select: () => ({ sort }) });

    const res = await server.request('GET', '/api/decks', { token: tokenFor(OWNER_ID) });

    expect(res.status).toBe(200);
    expect(Deck.find).toHaveBeenCalledWith({
      $or: [{ ownerId: OWNER_ID }, { collaboratorIds: OWNER_ID }]
    });
    expect(res.body).toEqual([
      { id: 'd1', title: 'Mine', updatedAt: '2026-01-01', slideCount: 2, isOwner: true },
      { id: 'd2', title: 'Shared', updatedAt: '2026-01-02', slideCount: 0, isOwner: false }
    ]);
  });
});

describe('POST /api/decks', () => {
  it('creates an empty deck owned by the caller, with a default title', async () => {
    Deck.create.mockImplementation(async (doc) => ({ _id: DECK_ID, ...doc }));
    const res = await server.request('POST', '/api/decks', { token: tokenFor(OWNER_ID), body: {} });
    expect(res.status).toBe(201);
    expect(Deck.create).toHaveBeenCalledWith({
      title: 'Untitled deck',
      ownerId: OWNER_ID,
      slides: []
    });
  });
});

describe('GET /api/decks/:deckId', () => {
  it('404s for a missing deck', async () => {
    Deck.findById.mockResolvedValue(null);
    const res = await server.request('GET', `/api/decks/${DECK_ID}`, { token: tokenFor(OWNER_ID) });
    expect(res.status).toBe(404);
  });

  it('403s for a user who is not on the deck', async () => {
    Deck.findById.mockResolvedValue(makeDeck());
    const res = await server.request('GET', `/api/decks/${DECK_ID}`, {
      token: tokenFor(STRANGER_ID)
    });
    expect(res.status).toBe(403);
  });

  it('returns the deck with owner and collaborators resolved', async () => {
    const slides = [{ id: 's1', order: 0, blocks: [] }];
    Deck.findById.mockResolvedValue(makeDeck({ slides }));
    const res = await server.request('GET', `/api/decks/${DECK_ID}`, {
      token: tokenFor(COLLAB_ID)
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: DECK_ID,
      isOwner: false,
      owner: { id: OWNER_ID, email: 'owner@example.com', name: 'Owner' },
      collaborators: [{ id: COLLAB_ID, email: 'collab@example.com', name: 'Collab' }],
      slides,
      slideCount: 1
    });
  });
});

describe('PUT /api/decks/:deckId/slides', () => {
  it('lets a collaborator replace the slides', async () => {
    const deck = makeDeck();
    Deck.findById.mockResolvedValue(deck);
    const slides = [{ id: 's1', order: 0, blocks: [] }];
    const res = await server.request('PUT', `/api/decks/${DECK_ID}/slides`, {
      token: tokenFor(COLLAB_ID),
      body: { slides }
    });
    expect(res.status).toBe(200);
    expect(deck.slides).toEqual(slides);
    expect(deck.save).toHaveBeenCalled();
  });

  it('does not save for a user who is not on the deck', async () => {
    const deck = makeDeck();
    Deck.findById.mockResolvedValue(deck);
    const res = await server.request('PUT', `/api/decks/${DECK_ID}/slides`, {
      token: tokenFor(STRANGER_ID),
      body: { slides: [] }
    });
    expect(res.status).toBe(403);
    expect(deck.save).not.toHaveBeenCalled();
  });
});

describe('POST /api/decks/:deckId/collaborators', () => {
  const invite = (userId, email) =>
    server.request('POST', `/api/decks/${DECK_ID}/collaborators`, {
      token: tokenFor(userId),
      body: { email }
    });

  it('only lets the owner invite', async () => {
    Deck.findById.mockResolvedValue(makeDeck());
    const res = await invite(COLLAB_ID, 'someone@example.com');
    expect(res.status).toBe(403);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('requires an email', async () => {
    Deck.findById.mockResolvedValue(makeDeck());
    expect((await invite(OWNER_ID, '  ')).status).toBe(400);
  });

  it('404s for an email with no account', async () => {
    Deck.findById.mockResolvedValue(makeDeck());
    User.findOne.mockResolvedValue(null);
    const res = await invite(OWNER_ID, ' Nobody@Example.com ');
    expect(res.status).toBe(404);
    expect(User.findOne).toHaveBeenCalledWith({ email: 'nobody@example.com' });
  });

  it('refuses to add the owner or an existing collaborator', async () => {
    Deck.findById.mockResolvedValue(makeDeck());
    User.findOne.mockResolvedValueOnce(users[OWNER_ID]);
    expect((await invite(OWNER_ID, 'owner@example.com')).body.error).toBe(
      "That's already the deck owner"
    );

    User.findOne.mockResolvedValueOnce(users[COLLAB_ID]);
    expect((await invite(OWNER_ID, 'collab@example.com')).body.error).toBe(
      'Already a collaborator on this deck'
    );
  });

  it('adds a new collaborator', async () => {
    const deck = makeDeck({ collaboratorIds: [] });
    Deck.findById.mockResolvedValue(deck);
    User.findOne.mockResolvedValue(users[COLLAB_ID]);
    const res = await invite(OWNER_ID, 'collab@example.com');
    expect(res.status).toBe(201);
    expect(deck.collaboratorIds).toEqual([COLLAB_ID]);
    expect(deck.save).toHaveBeenCalled();
    expect(res.body.collaborators).toEqual([
      { id: COLLAB_ID, email: 'collab@example.com', name: 'Collab' }
    ]);
  });
});

describe('DELETE /api/decks/:deckId/collaborators/:userId', () => {
  it('only lets the owner remove collaborators', async () => {
    const deck = makeDeck();
    Deck.findById.mockResolvedValue(deck);
    const res = await server.request('DELETE', `/api/decks/${DECK_ID}/collaborators/${COLLAB_ID}`, {
      token: tokenFor(COLLAB_ID)
    });
    expect(res.status).toBe(403);
    expect(deck.save).not.toHaveBeenCalled();
  });

  it('removes the collaborator', async () => {
    const deck = makeDeck();
    Deck.findById.mockResolvedValue(deck);
    const res = await server.request('DELETE', `/api/decks/${DECK_ID}/collaborators/${COLLAB_ID}`, {
      token: tokenFor(OWNER_ID)
    });
    expect(res.status).toBe(200);
    expect(deck.collaboratorIds).toEqual([]);
    expect(res.body.collaborators).toEqual([]);
  });
});

describe('DELETE /api/decks/:deckId', () => {
  it('does not let a collaborator delete the deck', async () => {
    const deck = makeDeck();
    Deck.findById.mockResolvedValue(deck);
    const res = await server.request('DELETE', `/api/decks/${DECK_ID}`, { token: tokenFor(COLLAB_ID) });
    expect(res.status).toBe(403);
    expect(deck.deleteOne).not.toHaveBeenCalled();
  });

  it('lets the owner delete the deck', async () => {
    const deck = makeDeck();
    Deck.findById.mockResolvedValue(deck);
    const res = await server.request('DELETE', `/api/decks/${DECK_ID}`, { token: tokenFor(OWNER_ID) });
    expect(res.status).toBe(204);
    expect(deck.deleteOne).toHaveBeenCalled();
  });
});

describe('POST /api/decks/import', () => {
  const pdfForm = (title) => {
    const form = new FormData();
    form.append('pdf', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'Launch Plan.pdf');
    if (title) form.append('title', title);
    return form;
  };

  it('requires a file', async () => {
    const res = await server.request('POST', '/api/decks/import', {
      token: tokenFor(OWNER_ID),
      body: new FormData()
    });
    expect(res.status).toBe(400);
  });

  it('rejects a file that is not a PDF with a 400', async () => {
    const form = new FormData();
    form.append('pdf', new Blob(['hello'], { type: 'text/plain' }), 'notes.txt');
    const res = await server.request('POST', '/api/decks/import', { token: tokenFor(OWNER_ID), body: form });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Only PDF files are accepted (field name "pdf")');
    expect(extractSlidesFromPdf).not.toHaveBeenCalled();
  });

  it('rejects a PDF under the wrong field name with a 400', async () => {
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'deck.pdf');
    const res = await server.request('POST', '/api/decks/import', { token: tokenFor(OWNER_ID), body: form });
    expect(res.status).toBe(400);
  });

  it('reports a PDF that cannot be parsed as 422', async () => {
    extractSlidesFromPdf.mockRejectedValue(new Error('bad xref table'));
    const res = await server.request('POST', '/api/decks/import', {
      token: tokenFor(OWNER_ID),
      body: pdfForm()
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Could not parse PDF: bad xref table');
    expect(Deck.create).not.toHaveBeenCalled();
  });

  it('creates a deck from the extracted slides, titled after the file', async () => {
    const slides = [{ id: 's1', order: 0, blocks: [] }];
    extractSlidesFromPdf.mockResolvedValue(slides);
    Deck.create.mockImplementation(async (doc) => ({ _id: DECK_ID, ...doc }));
    const res = await server.request('POST', '/api/decks/import', {
      token: tokenFor(OWNER_ID),
      body: pdfForm()
    });
    expect(res.status).toBe(201);
    expect(Buffer.isBuffer(extractSlidesFromPdf.mock.calls[0][0])).toBe(true);
    expect(Deck.create).toHaveBeenCalledWith({ title: 'Launch Plan', ownerId: OWNER_ID, slides });
    expect(res.body).toEqual({ id: DECK_ID, title: 'Launch Plan', slideCount: 1, slides });
  });
});
