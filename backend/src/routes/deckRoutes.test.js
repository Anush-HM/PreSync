import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../models/Deck.js', () => ({
  default: { find: vi.fn(), findById: vi.fn(), create: vi.fn() }
}));
vi.mock('../models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/AiConversation.js', () => ({ default: { deleteMany: vi.fn().mockResolvedValue({}) } }));
vi.mock('../models/DeckVersion.js', () => ({ default: { deleteMany: vi.fn().mockResolvedValue({}), findOne: vi.fn(), find: vi.fn(), create: vi.fn(), deleteOne: vi.fn() } }));
vi.mock('../models/Comment.js', () => ({ default: { deleteMany: vi.fn().mockResolvedValue({}) } }));
vi.mock('../services/pdfIngestService.js', () => ({ extractSlidesFromPdf: vi.fn() }));
vi.mock('../services/pptxIngestService.js', () => ({ extractSlidesFromPptx: vi.fn() }));
vi.mock('../services/deckExportService.js', () => ({
  exportDeckToPdf: vi.fn(),
  exportDeckToPptx: vi.fn(),
  exportFileName: (title, ext) => `${title}.${ext}`
}));
vi.mock('../services/docxExportService.js', () => ({ exportDeckToDocx: vi.fn(), exportDocumentToDocx: vi.fn() }));
vi.mock('../yjs/docManager.js', () => ({ flushDoc: vi.fn() }));

const { default: Deck } = await import('../models/Deck.js');
const { default: User } = await import('../models/User.js');
const { default: AiConversation } = await import('../models/AiConversation.js');
const { extractSlidesFromPdf } = await import('../services/pdfIngestService.js');
const { flushDoc } = await import('../yjs/docManager.js');
const { extractSlidesFromPptx } = await import('../services/pptxIngestService.js');
const { exportDeckToPdf, exportDeckToPptx } = await import('../services/deckExportService.js');
const { exportDeckToDocx } = await import('../services/docxExportService.js');
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
  function mockFind(decks) {
    const populate = vi.fn().mockResolvedValue(decks);
    Deck.find.mockReturnValue({ select: () => ({ sort: () => ({ populate }) }) });
    return populate;
  }

  it('lists only decks the user owns or co-edits', async () => {
    mockFind([
      { _id: 'd1', title: 'Mine', updatedAt: '2026-01-01', slides: [{}, {}], ownerId: users[OWNER_ID], collaboratorIds: [] },
      { _id: 'd2', title: 'Shared', updatedAt: '2026-01-02', slides: [], ownerId: users[COLLAB_ID], collaboratorIds: [users[OWNER_ID]] }
    ]);

    const res = await server.request('GET', '/api/decks', { token: tokenFor(OWNER_ID) });

    expect(res.status).toBe(200);
    expect(Deck.find).toHaveBeenCalledWith({
      $or: [{ ownerId: OWNER_ID }, { collaboratorIds: OWNER_ID }]
    });
    expect(res.body).toMatchObject([
      { id: 'd1', title: 'Mine', updatedAt: '2026-01-01', slideCount: 2, isOwner: true, collaborators: [] },
      {
        id: 'd2',
        title: 'Shared',
        updatedAt: '2026-01-02',
        slideCount: 0,
        isOwner: false,
        owner: { id: COLLAB_ID, name: 'Collab', email: 'collab@example.com' },
        collaborators: [{ id: OWNER_ID, name: 'Owner' }],
        thumbnail: null
      }
    ]);
  });

  it('returns the first slide as a thumbnail, leaving out oversized images', async () => {
    const big = `data:image/png;base64,${'A'.repeat(250_000)}`;
    mockFind([
      {
        _id: 'd1',
        title: 'Pictures',
        slides: [
          { id: 's2', order: 1, blocks: [] },
          {
            id: 's1',
            order: 0,
            backgroundColor: '#101010',
            blocks: [
              { id: 'b1', type: 'textbox', text: 'Hello', x: 0, y: 0, width: 100 },
              { id: 'b2', type: 'image', imageUrl: big, x: 0, y: 0, width: 100, height: 50 },
              { id: 'b3', type: 'image', imageUrl: 'data:image/png;base64,AAAA', x: 0, y: 0, width: 10, height: 10 }
            ]
          }
        ],
        ownerId: users[OWNER_ID],
        collaboratorIds: []
      }
    ]);

    const res = await server.request('GET', '/api/decks', { token: tokenFor(OWNER_ID) });

    const thumb = res.body[0].thumbnail;
    expect(thumb.id).toBe('s1');
    expect(thumb.backgroundColor).toBe('#101010');
    expect(thumb.blocks[0].text).toBe('Hello');
    expect(thumb.blocks[1]).toMatchObject({ id: 'b2', imageOmitted: true });
    expect(thumb.blocks[1].imageUrl).toBeUndefined();
    expect(thumb.blocks[2].imageUrl).toBe('data:image/png;base64,AAAA');
  });
});

describe('POST /api/decks/:deckId/duplicate', () => {
  it('403s for a user who is not on the deck', async () => {
    Deck.findById.mockResolvedValue(makeDeck());
    const res = await server.request('POST', `/api/decks/${DECK_ID}/duplicate`, { token: tokenFor(STRANGER_ID) });
    expect(res.status).toBe(403);
    expect(Deck.create).not.toHaveBeenCalled();
  });

  it('copies the slides into a new deck owned by the caller', async () => {
    const slides = [{ id: 's1', order: 0, blocks: [{ id: 'b1', type: 'textbox', text: 'Hi', x: 0, y: 0, width: 10 }] }];
    Deck.findById.mockResolvedValue({ ...makeDeck({ slides }), canvasWidth: 960, canvasHeight: 720 });
    flushDoc.mockResolvedValue(false);
    Deck.create.mockImplementation(async (doc) => ({ _id: 'copy-1', ...doc }));

    const res = await server.request('POST', `/api/decks/${DECK_ID}/duplicate`, { token: tokenFor(COLLAB_ID) });

    expect(res.status).toBe(201);
    expect(flushDoc).toHaveBeenCalledWith(DECK_ID);
    expect(Deck.create).toHaveBeenCalledWith({ title: 'Quarterly review (copy)', ownerId: COLLAB_ID, slides, canvasWidth: 960, canvasHeight: 720 });
    expect(res.body).toEqual({ id: 'copy-1', title: 'Quarterly review (copy)', slideCount: 1 });
  });

  it('re-reads the deck when live edits were flushed', async () => {
    const stale = makeDeck({ slides: [] });
    const fresh = makeDeck({ slides: [{ id: 's9', order: 0, blocks: [] }] });
    Deck.findById.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
    flushDoc.mockResolvedValue(true);
    Deck.create.mockImplementation(async (doc) => ({ _id: 'copy-2', ...doc }));

    const res = await server.request('POST', `/api/decks/${DECK_ID}/duplicate`, { token: tokenFor(OWNER_ID) });

    expect(res.status).toBe(201);
    expect(res.body.slideCount).toBe(1);
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
      slides: [],
      canvasWidth: 960,
      canvasHeight: 540
    });
  });

  it('starts the deck with the slides of a starter template', async () => {
    Deck.create.mockImplementation(async (doc) => ({ _id: DECK_ID, ...doc }));
    const slides = [{ id: 's1', order: 0, blocks: [{ id: 'b1', type: 'textbox', x: 10, y: 10, width: 300, text: 'Hello' }] }];
    const res = await server.request('POST', '/api/decks', { token: tokenFor(OWNER_ID), body: { title: '  Pitch  ', slides } });
    expect(res.status).toBe(201);
    expect(Deck.create).toHaveBeenCalledWith({ title: 'Pitch', ownerId: OWNER_ID, slides, canvasWidth: 960, canvasHeight: 540 });
  });

  it('refuses slides that are not a short list of slides', async () => {
    for (const slides of ['nope', [1, 2], Array.from({ length: 61 }, (_, i) => ({ id: `s${i}`, order: i }))]) {
      const res = await server.request('POST', '/api/decks', { token: tokenFor(OWNER_ID), body: { slides } });
      expect(res.status).toBe(400);
    }
    expect(Deck.create).not.toHaveBeenCalled();
  });

  it('answers 400, not 500, when the slides do not fit the schema', async () => {
    Deck.create.mockRejectedValue(Object.assign(new Error('bad'), { name: 'ValidationError' }));
    const res = await server.request('POST', '/api/decks', { token: tokenFor(OWNER_ID), body: { slides: [{ order: 'x' }] } });
    expect(res.status).toBe(400);
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

describe('PATCH /api/decks/:deckId', () => {
  it('lets a collaborator rename the deck, trimming the title', async () => {
    const deck = makeDeck();
    Deck.findById.mockResolvedValue(deck);
    const res = await server.request('PATCH', `/api/decks/${DECK_ID}`, {
      token: tokenFor(COLLAB_ID),
      body: { title: '  Q3 review  ' }
    });
    expect(res.status).toBe(200);
    expect(deck.title).toBe('Q3 review');
    expect(deck.save).toHaveBeenCalled();
    expect(res.body.title).toBe('Q3 review');
  });

  it('rejects an empty or missing title', async () => {
    const deck = makeDeck();
    Deck.findById.mockResolvedValue(deck);
    for (const body of [{}, { title: '   ' }, { title: 42 }]) {
      const res = await server.request('PATCH', `/api/decks/${DECK_ID}`, { token: tokenFor(OWNER_ID), body });
      expect(res.status).toBe(400);
    }
    expect(deck.save).not.toHaveBeenCalled();
  });

  it('403s for a user who is not on the deck', async () => {
    const deck = makeDeck();
    Deck.findById.mockResolvedValue(deck);
    const res = await server.request('PATCH', `/api/decks/${DECK_ID}`, {
      token: tokenFor(STRANGER_ID),
      body: { title: 'Mine now' }
    });
    expect(res.status).toBe(403);
    expect(deck.title).toBe('Quarterly review');
  });
});

describe('POST /api/decks/:deckId/save', () => {
  it('flushes the live document and reports when it saved', async () => {
    Deck.findById.mockResolvedValue(makeDeck());
    flushDoc.mockResolvedValue(true);
    const res = await server.request('POST', `/api/decks/${DECK_ID}/save`, { token: tokenFor(COLLAB_ID) });
    expect(res.status).toBe(200);
    expect(flushDoc).toHaveBeenCalledWith(DECK_ID);
    expect(res.body.flushed).toBe(true);
    expect(Date.parse(res.body.savedAt)).not.toBeNaN();
  });

  it('does not flush for a user who is not on the deck', async () => {
    Deck.findById.mockResolvedValue(makeDeck());
    const res = await server.request('POST', `/api/decks/${DECK_ID}/save`, { token: tokenFor(STRANGER_ID) });
    expect(res.status).toBe(403);
    expect(flushDoc).not.toHaveBeenCalled();
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
    expect(AiConversation.deleteMany).toHaveBeenCalledWith({ deckId: DECK_ID });
  });
});

describe('POST /api/decks/import', () => {
  const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const form = (name, type, { field = 'file', title } = {}) => {
    const f = new FormData();
    f.append(field, new Blob(['x'], { type }), name);
    if (title) f.append('title', title);
    return f;
  };
  const upload = (body) => server.request('POST', '/api/decks/import', { token: tokenFor(OWNER_ID), body });

  it('requires a file', async () => {
    const res = await upload(new FormData());
    expect(res.status).toBe(400);
  });

  it('rejects a file that is neither PDF nor PPTX with a 400', async () => {
    const res = await upload(form('notes.txt', 'text/plain'));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Only Word (.docx), PowerPoint (.pptx) and PDF (.pdf) files can be imported');
    expect(extractSlidesFromPdf).not.toHaveBeenCalled();
    expect(extractSlidesFromPptx).not.toHaveBeenCalled();
  });

  it('explains that legacy .ppt must be re-saved as .pptx', async () => {
    const res = await upload(form('old.ppt', 'application/vnd.ms-powerpoint'));
    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/save it as \.pptx/);
  });

  it('rejects a file under an unknown field name with a 400', async () => {
    const res = await upload(form('deck.pdf', 'application/pdf', { field: 'slides' }));
    expect(res.status).toBe(400);
  });

  it('reports a PDF that cannot be parsed as 422', async () => {
    extractSlidesFromPdf.mockRejectedValue(new Error('bad xref table'));
    const res = await upload(form('Launch Plan.pdf', 'application/pdf'));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Could not parse PDF: bad xref table');
    expect(Deck.create).not.toHaveBeenCalled();
  });

  it('creates a deck from a PDF, titled after the file (legacy "pdf" field)', async () => {
    const slides = [{ id: 's1', order: 0, blocks: [] }];
    extractSlidesFromPdf.mockResolvedValue({ slides, canvasWidth: 960, canvasHeight: 720 });
    Deck.create.mockImplementation(async (doc) => ({ _id: DECK_ID, ...doc }));
    const res = await upload(form('Launch Plan.pdf', 'application/pdf', { field: 'pdf' }));
    expect(res.status).toBe(201);
    expect(Buffer.isBuffer(extractSlidesFromPdf.mock.calls[0][0])).toBe(true);
    expect(Deck.create).toHaveBeenCalledWith({ title: 'Launch Plan', ownerId: OWNER_ID, slides, canvasWidth: 960, canvasHeight: 720 });
    expect(res.body).toEqual({ id: DECK_ID, title: 'Launch Plan', format: 'pdf', slideCount: 1, slides });
  });

  it('creates a deck from a PPTX, even when the browser sends it as octet-stream', async () => {
    const slides = [{ id: 's1', order: 0, blocks: [] }];
    extractSlidesFromPptx.mockResolvedValue({ slides, canvasWidth: 960, canvasHeight: 720 });
    Deck.create.mockImplementation(async (doc) => ({ _id: DECK_ID, ...doc }));
    for (const type of [PPTX_MIME, 'application/octet-stream']) {
      const res = await upload(form('Board Deck.pptx', type));
      expect(res.status).toBe(201);
      expect(res.body.format).toBe('pptx');
    }
    expect(Deck.create).toHaveBeenLastCalledWith({ title: 'Board Deck', ownerId: OWNER_ID, slides, canvasWidth: 960, canvasHeight: 720 });
    expect(extractSlidesFromPdf).not.toHaveBeenCalled();
  });

  it('reports a PPTX that cannot be parsed as 422', async () => {
    extractSlidesFromPptx.mockRejectedValue(new Error('Missing ppt/presentation.xml'));
    const res = await upload(form('broken.pptx', PPTX_MIME));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Could not parse PowerPoint file: Missing ppt/presentation.xml');
  });
});

describe('GET /api/decks/:deckId/export', () => {
  const exportAs = (format, userId = COLLAB_ID) =>
    server.request('GET', `/api/decks/${DECK_ID}/export?format=${format}`, { token: tokenFor(userId) });

  it('rejects an unknown format', async () => {
    const res = await exportAs('odp');
    expect(res.status).toBe(400);
    expect(Deck.findById).not.toHaveBeenCalled();
  });

  it('403s for a user who is not on the deck', async () => {
    Deck.findById.mockResolvedValue(makeDeck());
    const res = await exportAs('pdf', STRANGER_ID);
    expect(res.status).toBe(403);
    expect(exportDeckToPdf).not.toHaveBeenCalled();
  });

  it('flushes live edits, then sends the file as a download', async () => {
    const stale = makeDeck({ slides: [{ id: 'old' }] });
    const fresh = makeDeck({ slides: [{ id: 'new' }] });
    Deck.findById.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
    flushDoc.mockResolvedValue(true);
    exportDeckToPptx.mockResolvedValue(Buffer.from('PK-fake'));

    const res = await exportAs('pptx');
    expect(res.status).toBe(200);
    expect(flushDoc).toHaveBeenCalledWith(DECK_ID);
    expect(exportDeckToPptx.mock.calls[0][0].slides).toEqual([{ id: 'new' }]);
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="Quarterly review.pptx"');
  });

  it('exports a PDF without re-reading when nobody is editing', async () => {
    Deck.findById.mockResolvedValue(makeDeck());
    flushDoc.mockResolvedValue(false);
    exportDeckToPdf.mockResolvedValue(Buffer.from('%PDF-fake'));
    const res = await exportAs('pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(Deck.findById).toHaveBeenCalledTimes(1);
    expect(exportDeckToPdf.mock.calls[0][1]).toEqual({ includeHidden: false, notes: false });
  });

  it('exports Word with notes by default, and passes the hidden and notes options', async () => {
    Deck.findById.mockResolvedValue(makeDeck());
    flushDoc.mockResolvedValue(false);
    exportDeckToDocx.mockResolvedValue(Buffer.from('PK-fake'));
    exportDeckToPdf.mockResolvedValue(Buffer.from('%PDF-fake'));
    const res = await exportAs('docx');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(res.headers.get('content-disposition')).toContain('Quarterly review.docx');
    expect(exportDeckToDocx.mock.calls[0][1]).toEqual({ includeHidden: false, notes: true });
    await server.request('GET', `/api/decks/${DECK_ID}/export?format=pdf&hidden=1&notes=1`, { token: tokenFor(COLLAB_ID) });
    expect(exportDeckToPdf.mock.calls[0][1]).toEqual({ includeHidden: true, notes: true });
  });
});

describe('POST /api/decks/import (Word)', () => {
  it('refuses a .docx: Word documents do not become slides', async () => {
    const { buildDocx, p } = await import('../test/buildDocx.js');
    const buf = await buildDocx([p('Report', 'Title'), p('Findings', 'Heading1'), p('It works.')].join(''));
    const form = new FormData();
    form.append('file', new Blob([buf]), 'Report.docx');

    const res = await server.request('POST', '/api/decks/import', { token: tokenFor(OWNER_ID), body: form });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/document editor/);
    expect(Deck.create).not.toHaveBeenCalled();
  });
});
