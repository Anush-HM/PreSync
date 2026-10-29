import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../models/Deck.js', () => ({ default: { find: vi.fn(), findById: vi.fn(), create: vi.fn() } }));
vi.mock('../models/Template.js', () => ({ default: { find: vi.fn(), findById: vi.fn(), create: vi.fn(), countDocuments: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../yjs/docManager.js', () => ({ flushDoc: vi.fn() }));

const { default: Deck } = await import('../models/Deck.js');
const { default: Template } = await import('../models/Template.js');
const { flushDoc } = await import('../yjs/docManager.js');
const { startTestServer, tokenFor } = await import('../test/httpServer.js');

const OWNER_ID = '64b000000000000000000001';
const COLLAB_ID = '64b000000000000000000002';
const STRANGER_ID = '64b000000000000000000003';
const DECK_ID = '64b0000000000000000000d1';
const TEMPLATE_ID = '64b0000000000000000000e1';

const SLIDES = [
  { id: 's1', order: 0, blocks: [{ id: 'b1', type: 'textbox', x: 60, y: 40, width: 800, text: 'Title' }] },
  { id: 's2', order: 1, blocks: [] }
];

const deck = (slides = SLIDES) => ({ _id: DECK_ID, title: 'Pitch', ownerId: OWNER_ID, collaboratorIds: [COLLAB_ID], slides });
const template = (ownerId = OWNER_ID) => ({
  _id: TEMPLATE_ID, ownerId, name: 'My pitch', description: '', slides: SLIDES,
  createdAt: new Date(), updatedAt: new Date(), deleteOne: vi.fn().mockResolvedValue(undefined)
});

let server;
beforeAll(async () => { server = await startTestServer(); });
afterAll(() => server.close());
afterEach(() => vi.clearAllMocks());

describe('template routes', () => {
  it('need a signed-in user', async () => {
    expect((await server.request('GET', '/api/templates')).status).toBe(401);
  });

  it('list only the caller’s templates, with a thumbnail', async () => {
    Template.find.mockReturnValue({ sort: vi.fn().mockResolvedValue([template()]) });
    const res = await server.request('GET', '/api/templates', { token: tokenFor(OWNER_ID) });
    expect(res.status).toBe(200);
    expect(Template.find).toHaveBeenCalledWith({ ownerId: OWNER_ID });
    expect(res.body[0]).toMatchObject({ id: TEMPLATE_ID, name: 'My pitch', slideCount: 2, thumbnail: { id: 's1' } });
    expect(res.body[0].slides).toBeUndefined();
  });

  it('save a collaborator’s deck as their own template, after flushing live edits', async () => {
    Deck.findById.mockResolvedValue(deck());
    Template.countDocuments.mockResolvedValue(0);
    flushDoc.mockResolvedValue(true);
    Template.create.mockImplementation(async (doc) => ({ _id: TEMPLATE_ID, createdAt: new Date(), updatedAt: new Date(), ...doc }));
    const res = await server.request('POST', '/api/templates', { token: tokenFor(COLLAB_ID), body: { deckId: DECK_ID, name: ' Team pitch ', description: 'For sales' } });
    expect(res.status).toBe(201);
    expect(flushDoc).toHaveBeenCalledWith(DECK_ID);
    expect(Deck.findById).toHaveBeenCalledTimes(2);
    expect(Template.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: COLLAB_ID, name: 'Team pitch', description: 'For sales', slides: SLIDES }));
    expect(res.body).toMatchObject({ name: 'Team pitch', slideCount: 2 });
  });

  it('refuse a deck the caller cannot edit, a missing name, an empty deck and a full shelf', async () => {
    Deck.findById.mockResolvedValue(deck());
    Template.countDocuments.mockResolvedValue(0);
    expect((await server.request('POST', '/api/templates', { token: tokenFor(STRANGER_ID), body: { deckId: DECK_ID, name: 'x' } })).status).toBe(403);
    expect((await server.request('POST', '/api/templates', { token: tokenFor(OWNER_ID), body: { deckId: DECK_ID, name: '  ' } })).status).toBe(400);
    expect((await server.request('POST', '/api/templates', { token: tokenFor(OWNER_ID), body: { deckId: 'not-an-id', name: 'x' } })).status).toBe(400);
    Deck.findById.mockResolvedValue(deck([]));
    flushDoc.mockResolvedValue(false);
    expect((await server.request('POST', '/api/templates', { token: tokenFor(OWNER_ID), body: { deckId: DECK_ID, name: 'x' } })).status).toBe(400);
    Deck.findById.mockResolvedValue(deck());
    Template.countDocuments.mockResolvedValue(50);
    expect((await server.request('POST', '/api/templates', { token: tokenFor(OWNER_ID), body: { deckId: DECK_ID, name: 'x' } })).status).toBe(409);
    expect(Template.create).not.toHaveBeenCalled();
  });

  it('start a new deck from a template, owned by the caller', async () => {
    Template.findById.mockResolvedValue(template());
    Deck.create.mockImplementation(async (doc) => ({ _id: DECK_ID, ...doc }));
    const res = await server.request('POST', `/api/templates/${TEMPLATE_ID}/decks`, { token: tokenFor(OWNER_ID), body: {} });
    expect(res.status).toBe(201);
    expect(Deck.create).toHaveBeenCalledWith({ title: 'My pitch', ownerId: OWNER_ID, slides: SLIDES });
    expect(res.body).toEqual({ id: DECK_ID, title: 'My pitch', slideCount: 2 });
  });

  it('hide someone else’s template, and let the owner delete theirs', async () => {
    Template.findById.mockResolvedValue(template(COLLAB_ID));
    expect((await server.request('POST', `/api/templates/${TEMPLATE_ID}/decks`, { token: tokenFor(OWNER_ID), body: {} })).status).toBe(404);
    expect((await server.request('DELETE', `/api/templates/${TEMPLATE_ID}`, { token: tokenFor(OWNER_ID) })).status).toBe(404);
    const own = template();
    Template.findById.mockResolvedValue(own);
    expect((await server.request('DELETE', `/api/templates/${TEMPLATE_ID}`, { token: tokenFor(OWNER_ID) })).status).toBe(204);
    expect(own.deleteOne).toHaveBeenCalled();
  });
});
