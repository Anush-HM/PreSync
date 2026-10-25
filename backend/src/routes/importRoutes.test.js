import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildDocx, p } from '../test/buildDocx.js';

vi.mock('../models/Deck.js', () => ({ default: { create: vi.fn(), find: vi.fn(), findById: vi.fn() } }));
vi.mock('../models/ImportedDocument.js', () => ({ default: { create: vi.fn(), find: vi.fn(), findById: vi.fn() } }));

const { default: Deck } = await import('../models/Deck.js');
const { default: ImportedDocument } = await import('../models/ImportedDocument.js');
const { startTestServer, tokenFor } = await import('../test/httpServer.js');

const OWNER_ID = '64b000000000000000000001';
const STRANGER_ID = '64b000000000000000000003';
const IMPORT_ID = '64b0000000000000000000f1';

function makeImport(overrides = {}) {
  const doc = {
    _id: IMPORT_ID,
    ownerId: OWNER_ID,
    fileName: 'plan.docx',
    fileSize: 1234,
    format: 'docx',
    title: 'Plan',
    createdAt: '2026-05-01T00:00:00.000Z',
    analysis: { pageCount: 3, slideCount: null, suggestedSlides: 2, warnings: ['w'] },
    outline: [
      { id: 'o1', layout: 'title', title: 'Plan', subtitle: '', bullets: [], notes: '', imageId: null },
      { id: 'o2', layout: 'content', title: 'Goals', subtitle: '', bullets: [{ text: 'Grow', level: 0 }], notes: '', imageId: null }
    ],
    blocks: [],
    images: [],
    slides: [],
    deckIds: [],
    save: vi.fn().mockResolvedValue(undefined),
    deleteOne: vi.fn().mockResolvedValue(undefined),
    markModified: vi.fn(),
    ...overrides
  };
  return doc;
}

function upload(name, buffer) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), name);
  return form;
}

let server;
beforeAll(async () => { server = await startTestServer(); });
afterAll(() => server.close());
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe('POST /api/imports', () => {
  const post = (body, userId = OWNER_ID) => server.request('POST', '/api/imports', { token: tokenFor(userId), body });

  it('requires a login', async () => {
    const res = await server.request('POST', '/api/imports', { body: upload('a.docx', Buffer.from('x')) });
    expect(res.status).toBe(401);
  });

  it('requires a file', async () => {
    const res = await post(new FormData());
    expect(res.status).toBe(400);
  });

  it('explains that legacy .doc must be re-saved as .docx', async () => {
    const res = await post(upload('old.doc', Buffer.from('x')));
    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/save it as \.docx/);
  });

  it('rejects other file types with a 400', async () => {
    const res = await post(upload('notes.txt', Buffer.from('x')));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Word \(\.docx\), PowerPoint \(\.pptx\) and PDF/);
  });

  it('reports a damaged Word file as 422 without saving anything', async () => {
    const res = await post(upload('broken.docx', Buffer.from('not a zip')));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/^Could not read this Word document/);
    expect(ImportedDocument.create).not.toHaveBeenCalled();
  });

  it('analyses a Word file and stores the result, without creating a deck', async () => {
    ImportedDocument.create.mockImplementation(async (doc) => ({ _id: IMPORT_ID, createdAt: '2026-05-01', deckIds: [], ...doc }));
    const buf = await buildDocx([p('Plan', 'Title'), p('Goals', 'Heading1'), p('Grow.'), p('Risks', 'Heading1'), p('Few.')].join(''));

    const res = await post(upload('plan.docx', buf));

    expect(res.status).toBe(201);
    expect(Deck.create).not.toHaveBeenCalled();
    const saved = ImportedDocument.create.mock.calls[0][0];
    expect(saved).toMatchObject({ ownerId: OWNER_ID, fileName: 'plan.docx', format: 'docx', title: 'Plan' });
    expect(res.body.id).toBe(IMPORT_ID);
    expect(res.body.analysis.majorTopics).toEqual(['Goals', 'Risks']);
    expect(res.body.outline.map((o) => o.title)).toEqual(['Plan', 'Goals', 'Risks']);
  });
});

describe('GET /api/imports', () => {
  it("lists the caller's imports as summaries", async () => {
    const limit = vi.fn().mockResolvedValue([makeImport()]);
    ImportedDocument.find.mockReturnValue({ select: () => ({ sort: () => ({ limit }) }) });
    const res = await server.request('GET', '/api/imports', { token: tokenFor(OWNER_ID) });
    expect(res.status).toBe(200);
    expect(ImportedDocument.find).toHaveBeenCalledWith({ ownerId: OWNER_ID });
    expect(res.body).toEqual([{
      id: IMPORT_ID, fileName: 'plan.docx', fileSize: 1234, format: 'docx', title: 'Plan', createdAt: '2026-05-01T00:00:00.000Z',
      pageCount: 3, slideCount: null, suggestedSlides: 2, warningCount: 1, deckIds: []
    }]);
  });
});

describe('GET /api/imports/:id', () => {
  it('404s for a bad id and 403s for someone else', async () => {
    expect((await server.request('GET', '/api/imports/nope', { token: tokenFor(OWNER_ID) })).status).toBe(404);
    ImportedDocument.findById.mockResolvedValue(makeImport());
    expect((await server.request('GET', `/api/imports/${IMPORT_ID}`, { token: tokenFor(STRANGER_ID) })).status).toBe(403);
  });

  it('returns the full import to its owner', async () => {
    ImportedDocument.findById.mockResolvedValue(makeImport());
    const res = await server.request('GET', `/api/imports/${IMPORT_ID}`, { token: tokenFor(OWNER_ID) });
    expect(res.status).toBe(200);
    expect(res.body.outline).toHaveLength(2);
  });
});

describe('PUT /api/imports/:id/outline', () => {
  it('rejects an invalid outline', async () => {
    ImportedDocument.findById.mockResolvedValue(makeImport());
    const res = await server.request('PUT', `/api/imports/${IMPORT_ID}/outline`, { token: tokenFor(OWNER_ID), body: { outline: [] } });
    expect(res.status).toBe(400);
  });

  it('saves the cleaned outline', async () => {
    const doc = makeImport();
    ImportedDocument.findById.mockResolvedValue(doc);
    const res = await server.request('PUT', `/api/imports/${IMPORT_ID}/outline`, {
      token: tokenFor(OWNER_ID),
      body: { outline: [{ id: 'o9', title: ' Edited ', bullets: [{ text: 'New', level: 0 }] }] }
    });
    expect(res.status).toBe(200);
    expect(doc.save).toHaveBeenCalled();
    expect(res.body.outline[0]).toMatchObject({ id: 'o9', title: 'Edited' });
  });
});

describe('POST /api/imports/:id/decks', () => {
  const create = (body, userId = OWNER_ID) =>
    server.request('POST', `/api/imports/${IMPORT_ID}/decks`, { token: tokenFor(userId), body });

  it('generates slides from the stored outline and links the new deck', async () => {
    const doc = makeImport();
    ImportedDocument.findById.mockResolvedValue(doc);
    Deck.create.mockImplementation(async (d) => ({ _id: 'deck-1', ...d }));

    const res = await create({ mode: 'outline' });

    expect(res.status).toBe(201);
    const deck = Deck.create.mock.calls[0][0];
    expect(deck).toMatchObject({ title: 'Plan', ownerId: OWNER_ID });
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[1].blocks[0].text).toBe('Goals');
    expect(doc.deckIds).toEqual(['deck-1']);
    expect(res.body).toEqual({ id: 'deck-1', title: 'Plan', slideCount: 2, mode: 'outline' });
  });

  it('uses an edited outline and title from the request', async () => {
    ImportedDocument.findById.mockResolvedValue(makeImport());
    Deck.create.mockImplementation(async (d) => ({ _id: 'deck-2', ...d }));
    const res = await create({ outline: [{ title: 'Only slide', bullets: [] }], title: 'Custom' });
    expect(res.status).toBe(201);
    expect(Deck.create.mock.calls[0][0].slides).toHaveLength(1);
    expect(res.body.title).toBe('Custom');
  });

  it('keeps PowerPoint slides as extracted in "original" mode, but not for Word', async () => {
    ImportedDocument.findById.mockResolvedValue(makeImport());
    expect((await create({ mode: 'original' })).status).toBe(400);

    const slides = [{ id: 'slide-1', order: 0, blocks: [] }];
    ImportedDocument.findById.mockResolvedValue(makeImport({ format: 'pptx', slides }));
    Deck.create.mockImplementation(async (d) => ({ _id: 'deck-3', ...d }));
    const res = await create({ mode: 'original' });
    expect(res.status).toBe(201);
    expect(Deck.create.mock.calls[0][0].slides).toBe(slides);
  });

  it("refuses someone else's import", async () => {
    ImportedDocument.findById.mockResolvedValue(makeImport());
    expect((await create({}, STRANGER_ID)).status).toBe(403);
    expect(Deck.create).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/imports/:id', () => {
  it('deletes the import', async () => {
    const doc = makeImport();
    ImportedDocument.findById.mockResolvedValue(doc);
    const res = await server.request('DELETE', `/api/imports/${IMPORT_ID}`, { token: tokenFor(OWNER_ID) });
    expect(res.status).toBe(204);
    expect(doc.deleteOne).toHaveBeenCalled();
  });
});
