import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildDocx, p } from '../test/buildDocx.js';

vi.mock('../models/Document.js', () => ({ default: { create: vi.fn(), find: vi.fn(), findById: vi.fn() } }));
vi.mock('../models/ImportedDocument.js', () => ({ default: { create: vi.fn(), find: vi.fn(), findById: vi.fn() } }));

const { default: Document } = await import('../models/Document.js');
const { default: ImportedDocument } = await import('../models/ImportedDocument.js');
const { startTestServer, tokenFor } = await import('../test/httpServer.js');

const OWNER_ID = '64b000000000000000000001';
const COLLAB_ID = '64b000000000000000000002';
const STRANGER_ID = '64b000000000000000000003';
const DOC_ID = '64b0000000000000000000d1';

const PAGE = { width: 816, height: 1056, margins: { top: 96, right: 96, bottom: 96, left: 96 } };
const CONTENT = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello there' }] }] };

function makeDoc(overrides = {}) {
  return {
    _id: DOC_ID,
    title: 'Plan',
    ownerId: OWNER_ID,
    collaboratorIds: [COLLAB_ID],
    content: CONTENT,
    page: PAGE,
    wordCount: 2,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z',
    save: vi.fn().mockResolvedValue(undefined),
    deleteOne: vi.fn().mockResolvedValue(undefined),
    markModified: vi.fn(),
    ...overrides
  };
}

let server;
beforeAll(async () => { server = await startTestServer(); });
afterAll(() => server.close());
afterEach(() => { vi.clearAllMocks(); });

const call = (method, path, { userId = OWNER_ID, body } = {}) =>
  server.request(method, `/api/documents${path}`, { token: tokenFor(userId), body });

function upload(name, buffer) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), name);
  return form;
}

describe('POST /api/documents', () => {
  it('requires a login', async () => {
    expect((await server.request('POST', '/api/documents', { body: {} })).status).toBe(401);
  });

  it('creates a blank document', async () => {
    Document.create.mockImplementation(async (d) => makeDoc(d));
    const res = await call('POST', '', { body: {} });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: DOC_ID, title: 'Untitled document', isOwner: true });
    expect(res.body.content).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(res.body.page).toMatchObject({ width: 794, height: 1123 });
    expect(res.body.layout).toMatchObject({ differentFirstPage: false, pageNumbers: null, pageBorder: null });
  });

  it('can start on Letter', async () => {
    Document.create.mockImplementation(async (d) => makeDoc(d));
    const res = await call('POST', '', { body: { pageSize: 'letter' } });
    expect(res.body.page.width).toBe(816);
  });
});

describe('GET /api/documents', () => {
  it('lists what the caller owns or edits, without content', async () => {
    const limit = vi.fn().mockResolvedValue([makeDoc()]);
    Document.find.mockReturnValue({ select: () => ({ sort: () => ({ limit }) }) });
    const res = await call('GET', '');
    expect(res.status).toBe(200);
    expect(Document.find).toHaveBeenCalledWith({ $or: [{ ownerId: OWNER_ID }, { collaboratorIds: OWNER_ID }] });
    expect(res.body[0]).toMatchObject({ id: DOC_ID, title: 'Plan', wordCount: 2 });
    expect(res.body[0].content).toBeUndefined();
  });
});

describe('GET /api/documents/:id', () => {
  it('404s for a bad id and 403s for a stranger', async () => {
    expect((await call('GET', '/nope')).status).toBe(404);
    Document.findById.mockResolvedValue(makeDoc());
    expect((await call('GET', `/${DOC_ID}`, { userId: STRANGER_ID })).status).toBe(403);
  });

  it('gives owners and collaborators the content', async () => {
    Document.findById.mockResolvedValue(makeDoc());
    const res = await call('GET', `/${DOC_ID}`, { userId: COLLAB_ID });
    expect(res.status).toBe(200);
    expect(res.body.content).toEqual(CONTENT);
    expect(res.body.isOwner).toBe(false);
  });
});

describe('PUT /api/documents/:id', () => {
  it('saves title and content and recounts words', async () => {
    const doc = makeDoc();
    Document.findById.mockResolvedValue(doc);
    const content = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'One two three' }] }] };
    const res = await call('PUT', `/${DOC_ID}`, { body: { title: ' New name ', content } });
    expect(res.status).toBe(200);
    expect(doc.save).toHaveBeenCalled();
    expect(doc.title).toBe('New name');
    expect(doc.wordCount).toBe(3);
    expect(res.body.title).toBe('New name');
  });

  it('saves the page layout, dropping anything unusable', async () => {
    const doc = makeDoc();
    Document.findById.mockResolvedValue(doc);
    const layout = {
      footer: { center: '{title}' },
      pageNumbers: { position: 'nowhere' },
      pageBorder: { sides: { top: true }, style: 'wavy', width: 99, color: 'red', inset: 500 }
    };
    expect((await call('PUT', `/${DOC_ID}`, { body: { layout } })).status).toBe(200);
    expect(doc.layout.footer).toEqual({ left: '', center: '{title}', right: '' });
    expect(doc.layout.pageNumbers).toBeNull();
    expect(doc.layout.pageBorder).toMatchObject({ style: 'solid', width: 1, color: '#000000', inset: 31 });
    expect(doc.markModified).toHaveBeenCalledWith('layout');
  });

  it('rejects unknown content without saving', async () => {
    const doc = makeDoc();
    Document.findById.mockResolvedValue(doc);
    const res = await call('PUT', `/${DOC_ID}`, { body: { content: { type: 'doc', content: [{ type: 'script' }] } } });
    expect(res.status).toBe(400);
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('refuses pictures that are not inline PNG, JPEG or GIF', async () => {
    Document.findById.mockResolvedValue(makeDoc());
    const res = await call('PUT', `/${DOC_ID}`, {
      body: { content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://evil.example/x.png' } }] } }
    });
    expect(res.status).toBe(400);
  });

  it('answers 413 when the body is over the limit', async () => {
    Document.findById.mockResolvedValue(makeDoc());
    const text = 'x'.repeat(21 * 1024 * 1024);
    const res = await call('PUT', `/${DOC_ID}`, { body: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } } });
    expect(res.status).toBe(413);
  });

  it('keeps strangers out', async () => {
    Document.findById.mockResolvedValue(makeDoc());
    expect((await call('PUT', `/${DOC_ID}`, { userId: STRANGER_ID, body: { title: 'x' } })).status).toBe(403);
  });
});

describe('DELETE /api/documents/:id', () => {
  it('lets only the owner delete', async () => {
    const doc = makeDoc();
    Document.findById.mockResolvedValue(doc);
    expect((await call('DELETE', `/${DOC_ID}`, { userId: COLLAB_ID })).status).toBe(403);
    expect(doc.deleteOne).not.toHaveBeenCalled();
    expect((await call('DELETE', `/${DOC_ID}`)).status).toBe(204);
    expect(doc.deleteOne).toHaveBeenCalled();
  });
});

describe('POST /api/documents/import-docx', () => {
  const post = (body) => call('POST', '/import-docx', { body });

  it('requires a file and refuses other formats', async () => {
    expect((await post(new FormData())).status).toBe(400);
    expect((await post(upload('old.doc', Buffer.from('x')))).status).toBe(415);
    expect((await post(upload('deck.pptx', Buffer.from('x')))).status).toBe(400);
  });

  it('reports a damaged file as 422', async () => {
    const res = await post(upload('broken.docx', Buffer.from('not a zip')));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/^Could not read this Word document/);
    expect(Document.create).not.toHaveBeenCalled();
  });

  it('creates an editable document from the file', async () => {
    Document.create.mockImplementation(async (d) => makeDoc(d));
    const buf = await buildDocx([p('Plan', 'Title'), p('Goals', 'Heading1'), p('Grow.')].join(''));
    const res = await post(upload('plan.docx', buf));
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Plan');
    expect(res.body.sourceFileName).toBe('plan.docx');
    expect(res.body.content.content.map((n) => n.type)).toEqual(['paragraph', 'heading', 'paragraph']);
    expect(res.body.content.content[0].attrs.blockStyle).toBe('title');
  });
});

describe('POST /api/documents/from-import/:importId', () => {
  const IMPORT_ID = '64b0000000000000000000f1';

  it('opens a stored Word import as a document, and no other format', async () => {
    Document.create.mockImplementation(async (d) => makeDoc(d));
    ImportedDocument.findById.mockResolvedValue({
      ownerId: OWNER_ID, format: 'docx', title: 'Old', fileName: 'old.docx', page: null, images: [],
      blocks: [{ type: 'paragraph', text: 'Kept' }]
    });
    const res = await call('POST', `/from-import/${IMPORT_ID}`);
    expect(res.status).toBe(201);
    expect(res.body.content.content[0].content[0].text).toBe('Kept');

    ImportedDocument.findById.mockResolvedValue({ ownerId: OWNER_ID, format: 'pptx' });
    expect((await call('POST', `/from-import/${IMPORT_ID}`)).status).toBe(400);
  });

  it("refuses someone else's import", async () => {
    ImportedDocument.findById.mockResolvedValue({ ownerId: OWNER_ID, format: 'docx' });
    expect((await call('POST', `/from-import/${IMPORT_ID}`, { userId: STRANGER_ID })).status).toBe(403);
  });
});

describe('GET /api/documents/:id/export/:format', () => {
  it('downloads .docx and PDF files named after the document', async () => {
    Document.findById.mockResolvedValue(makeDoc());
    const docx = await call('GET', `/${DOC_ID}/export/docx`);
    expect(docx.status).toBe(200);
    expect(docx.headers.get('content-type')).toContain('wordprocessingml');
    expect(docx.headers.get('content-disposition')).toContain('Plan.docx');
    const pdf = await call('GET', `/${DOC_ID}/export/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toContain('application/pdf');
  });

  it('refuses other formats and strangers', async () => {
    Document.findById.mockResolvedValue(makeDoc());
    expect((await call('GET', `/${DOC_ID}/export/rtf`)).status).toBe(400);
    expect((await call('GET', `/${DOC_ID}/export/pdf`, { userId: STRANGER_ID })).status).toBe(403);
  });
});
