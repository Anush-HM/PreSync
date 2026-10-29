import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Chainable stand-ins for Mongoose queries: every chain step returns the
// same thenable, which resolves to `value`.
const query = (value) => {
  const q = { then: (a, b) => Promise.resolve(value).then(a, b) };
  for (const m of ['sort', 'select', 'populate', 'limit']) q[m] = () => q;
  return q;
};

vi.mock('../models/Deck.js', () => ({ default: { find: vi.fn(), findById: vi.fn(), create: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/AiConversation.js', () => ({ default: { deleteMany: vi.fn() } }));
vi.mock('../models/DeckVersion.js', () => ({ default: { find: vi.fn(), findOne: vi.fn(), findById: vi.fn(), create: vi.fn(), deleteOne: vi.fn(), deleteMany: vi.fn() } }));
vi.mock('../models/Comment.js', () => ({ default: { find: vi.fn(), findById: vi.fn(), create: vi.fn(), deleteMany: vi.fn() } }));
vi.mock('../yjs/docManager.js', () => ({ flushDoc: vi.fn() }));

const { default: Deck } = await import('../models/Deck.js');
const { default: DeckVersion } = await import('../models/DeckVersion.js');
const { default: Comment } = await import('../models/Comment.js');
const { flushDoc } = await import('../yjs/docManager.js');
const { startTestServer, tokenFor } = await import('../test/httpServer.js');
const { autoSnapshot, slidesFingerprint, MAX_VERSIONS_PER_DECK } = await import('../controllers/versionController.js');

const OWNER = '64b000000000000000000001';
const COLLAB = '64b000000000000000000002';
const STRANGER = '64b000000000000000000003';
const DECK = '64b0000000000000000000d1';
const VERSION = '64b0000000000000000000f1';
const COMMENT = '64b0000000000000000000c1';
const SLIDES = [{ id: 's1', order: 0, blocks: [{ id: 'b1', type: 'textbox', x: 1, y: 1, width: 100, text: 'Hi' }] }];
const user = (id, name) => ({ _id: id, name, email: `${name.toLowerCase()}@example.com` });

const deck = (slides = SLIDES) => ({ _id: DECK, title: 'Plan', ownerId: OWNER, collaboratorIds: [COLLAB], slides });

let server;
beforeAll(async () => { server = await startTestServer(); });
afterAll(() => server.close());
afterEach(() => vi.clearAllMocks());
const as = (id) => ({ token: tokenFor(id) });

describe('version history', () => {
  it('lists versions newest first, with author and thumbnail but no slides', async () => {
    Deck.findById.mockResolvedValue(deck());
    DeckVersion.find.mockReturnValue(query([{ _id: VERSION, label: 'Before review', kind: 'manual', title: 'Plan', createdAt: new Date(), slides: SLIDES, authorId: user(OWNER, 'Owner') }]));
    const res = await server.request('GET', `/api/decks/${DECK}/versions`, as(COLLAB));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({ id: VERSION, label: 'Before review', slideCount: 1, author: { id: OWNER, name: 'Owner', email: 'owner@example.com' } })]);
    expect(res.body[0].thumbnail.id).toBe('s1');
    expect(res.body[0].slides).toBeUndefined();
  });

  it('keeps out anyone who is not on the deck', async () => {
    Deck.findById.mockResolvedValue(deck());
    expect((await server.request('GET', `/api/decks/${DECK}/versions`, as(STRANGER))).status).toBe(403);
    expect((await server.request('POST', `/api/decks/${DECK}/comments`, { ...as(STRANGER), body: { slideId: 's1', text: 'x' } })).status).toBe(403);
    expect(DeckVersion.find).not.toHaveBeenCalled();
  });

  it('saves a named version of the latest live edits', async () => {
    Deck.findById.mockResolvedValue(deck());
    flushDoc.mockResolvedValue(true);
    DeckVersion.create.mockImplementation(async (doc) => ({ _id: VERSION, createdAt: new Date(), ...doc }));
    DeckVersion.find.mockReturnValue(query([]));
    const res = await server.request('POST', `/api/decks/${DECK}/versions`, { ...as(COLLAB), body: { label: '  Sent to client ' } });
    expect(res.status).toBe(201);
    expect(flushDoc).toHaveBeenCalledWith(DECK);
    expect(DeckVersion.create).toHaveBeenCalledWith(expect.objectContaining({ deckId: DECK, authorId: COLLAB, label: 'Sent to client', kind: 'manual', slides: SLIDES, fingerprint: slidesFingerprint(SLIDES) }));
  });

  it('returns one version with its slides, only for its own deck', async () => {
    Deck.findById.mockResolvedValue(deck());
    DeckVersion.findById.mockReturnValue(query({ _id: VERSION, deckId: DECK, kind: 'auto', slides: SLIDES, createdAt: new Date() }));
    const res = await server.request('GET', `/api/decks/${DECK}/versions/${VERSION}`, as(OWNER));
    expect(res.status).toBe(200);
    expect(res.body.slides).toEqual(SLIDES);
    DeckVersion.findById.mockReturnValue(query({ _id: VERSION, deckId: '64b0000000000000000000d9', slides: [] }));
    expect((await server.request('GET', `/api/decks/${DECK}/versions/${VERSION}`, as(OWNER))).status).toBe(404);
  });

  it('takes an automatic version on Save only when one is due and something changed', async () => {
    DeckVersion.create.mockImplementation(async (doc) => ({ _id: VERSION, ...doc }));
    DeckVersion.find.mockReturnValue(query([]));
    DeckVersion.findOne.mockReturnValue(query(null));
    expect(await autoSnapshot(deck(), OWNER)).toMatchObject({ kind: 'auto' });
    DeckVersion.findOne.mockReturnValue(query({ createdAt: new Date(), fingerprint: 'x' }));
    expect(await autoSnapshot(deck(), OWNER)).toBeNull();
    DeckVersion.findOne.mockReturnValue(query({ createdAt: new Date(Date.now() - 3600_000), fingerprint: slidesFingerprint(SLIDES) }));
    expect(await autoSnapshot(deck(), OWNER)).toBeNull();
    expect(DeckVersion.create).toHaveBeenCalledTimes(1);
  });

  it('drops the oldest automatic versions first when a deck has too many', async () => {
    const old = Array.from({ length: MAX_VERSIONS_PER_DECK + 2 }, (_, i) => ({ _id: `v${i}`, kind: i === 0 ? 'manual' : 'auto', createdAt: new Date(i) }));
    DeckVersion.find.mockReturnValue(query(old));
    DeckVersion.findOne.mockReturnValue(query(null));
    DeckVersion.create.mockImplementation(async (doc) => ({ _id: VERSION, ...doc }));
    await autoSnapshot(deck(), OWNER);
    expect(DeckVersion.deleteOne.mock.calls.map((c) => c[0]._id)).toEqual(['v1', 'v2']);
  });
});

describe('comments', () => {
  const thread = (over = {}) => {
    const c = {
      _id: COMMENT, deckId: DECK, slideId: 's1', blockId: 'b1', authorId: COLLAB, text: 'Tighten this', replies: [], resolved: false,
      createdAt: new Date(), save: vi.fn().mockResolvedValue(undefined), deleteOne: vi.fn().mockResolvedValue(undefined),
      ...over
    };
    c.populate = vi.fn(async () => {
      c.authorId = user(COLLAB, 'Collab');
      return c;
    });
    return c;
  };

  it('adds a comment pinned to an element and lists the thread', async () => {
    Deck.findById.mockResolvedValue(deck());
    Comment.create.mockImplementation(async (doc) => thread(doc));
    const res = await server.request('POST', `/api/decks/${DECK}/comments`, { ...as(COLLAB), body: { slideId: 's1', blockId: 'b1', text: '  Tighten this ' } });
    expect(res.status).toBe(201);
    expect(Comment.create).toHaveBeenCalledWith({ deckId: DECK, slideId: 's1', blockId: 'b1', authorId: COLLAB, text: 'Tighten this' });
    expect(res.body).toMatchObject({ slideId: 's1', blockId: 'b1', text: 'Tighten this', author: { name: 'Collab' }, resolved: false });

    Comment.find.mockReturnValue(query([thread({ authorId: user(COLLAB, 'Collab') })]));
    const list = await server.request('GET', `/api/decks/${DECK}/comments`, as(OWNER));
    expect(list.body).toHaveLength(1);
  });

  it('refuses empty or oversized text and bad slide ids', async () => {
    Deck.findById.mockResolvedValue(deck());
    for (const body of [{ slideId: 's1', text: '  ' }, { slideId: 's1', text: 'x'.repeat(2001) }, { slideId: '<script>', text: 'x' }]) {
      expect((await server.request('POST', `/api/decks/${DECK}/comments`, { ...as(OWNER), body })).status).toBe(400);
    }
    expect(Comment.create).not.toHaveBeenCalled();
  });

  it('replies, which reopens a resolved thread, and resolves', async () => {
    Deck.findById.mockResolvedValue(deck());
    const c = thread({ resolved: true, resolvedBy: OWNER });
    Comment.findById.mockResolvedValue(c);
    const res = await server.request('POST', `/api/decks/${DECK}/comments/${COMMENT}/replies`, { ...as(OWNER), body: { text: 'Done' } });
    expect(res.status).toBe(201);
    expect(c.replies).toHaveLength(1);
    expect(c.resolved).toBe(false);
    const r2 = await server.request('PATCH', `/api/decks/${DECK}/comments/${COMMENT}`, { ...as(OWNER), body: { resolved: true } });
    expect(r2.status).toBe(200);
    expect(c.resolved).toBe(true);
    expect(c.resolvedBy).toBe(OWNER);
  });

  it('lets only the author edit text, and the author or owner delete', async () => {
    Deck.findById.mockResolvedValue(deck());
    Comment.findById.mockResolvedValue(thread());
    expect((await server.request('PATCH', `/api/decks/${DECK}/comments/${COMMENT}`, { ...as(OWNER), body: { text: 'Mine now' } })).status).toBe(403);
    expect((await server.request('PATCH', `/api/decks/${DECK}/comments/${COMMENT}`, { ...as(COLLAB), body: { text: 'Better' } })).status).toBe(200);
    const theirs = thread({ authorId: COLLAB });
    Comment.findById.mockResolvedValue(theirs);
    Deck.findById.mockResolvedValue({ ...deck(), collaboratorIds: [COLLAB, STRANGER] });
    expect((await server.request('DELETE', `/api/decks/${DECK}/comments/${COMMENT}`, as(STRANGER))).status).toBe(403);
    expect((await server.request('DELETE', `/api/decks/${DECK}/comments/${COMMENT}`, as(OWNER))).status).toBe(204);
    expect(theirs.deleteOne).toHaveBeenCalled();
  });

  it('treats a comment from another deck as missing', async () => {
    Deck.findById.mockResolvedValue(deck());
    Comment.findById.mockResolvedValue(thread({ deckId: '64b0000000000000000000d9' }));
    expect((await server.request('PATCH', `/api/decks/${DECK}/comments/${COMMENT}`, { ...as(OWNER), body: { resolved: true } })).status).toBe(404);
  });
});
