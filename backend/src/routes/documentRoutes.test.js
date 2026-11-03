import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildDocx, p } from '../test/buildDocx.js';

vi.mock('../models/Document.js', () => ({ default: { create: vi.fn(), find: vi.fn(), findById: vi.fn() } }));
vi.mock('../models/ImportedDocument.js', () => ({ default: { create: vi.fn(), find: vi.fn(), findById: vi.fn() } }));
vi.mock('../models/DocumentComment.js', () => ({ default: { create: vi.fn(), find: vi.fn(), findById: vi.fn(), deleteMany: vi.fn().mockResolvedValue({}) } }));
vi.mock('../models/DocumentVersion.js', () => ({ default: { create: vi.fn(), find: vi.fn(), findOne: vi.fn(), findById: vi.fn(), deleteMany: vi.fn().mockResolvedValue({}), deleteOne: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findOne: vi.fn() } }));

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
    populate: vi.fn().mockResolvedValue(undefined),
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
    const populate = vi.fn().mockResolvedValue([makeDoc()]);
    Document.find.mockReturnValue({ select: () => ({ sort: () => ({ limit: () => ({ populate }) }) }) });
    const res = await call('GET', '');
    expect(res.status).toBe(200);
    expect(Document.find).toHaveBeenCalledWith({ $or: [{ ownerId: OWNER_ID }, { collaboratorIds: OWNER_ID }, { viewerIds: OWNER_ID }] });
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

const VIEWER_ID = '64b000000000000000000004';
const COMMENT_ID = '64b0000000000000000000c1';
const VERSION_ID = '64b0000000000000000000e1';
const { default: User } = await import('../models/User.js');
const { default: DocumentComment } = await import('../models/DocumentComment.js');
const { default: DocumentVersion } = await import('../models/DocumentVersion.js');

describe('sharing a document', () => {
  it('lets the owner share by email to edit or to view, and change it later', async () => {
    const doc = makeDoc({ collaboratorIds: [], viewerIds: [] });
    Document.findById.mockResolvedValue(doc);
    User.findOne.mockResolvedValue({ _id: VIEWER_ID });
    const res = await call('POST', `/${DOC_ID}/share`, { body: { email: ' Pat@Example.com ', role: 'viewer' } });
    expect(res.status).toBe(201);
    expect(User.findOne).toHaveBeenCalledWith({ email: 'pat@example.com' });
    expect(doc.viewerIds).toEqual([VIEWER_ID]);
    expect(doc.collaboratorIds).toEqual([]);

    expect((await call('PATCH', `/${DOC_ID}/share/${VIEWER_ID}`, { body: { role: 'editor' } })).status).toBe(200);
    expect(doc.viewerIds).toEqual([]);
    expect(doc.collaboratorIds).toEqual([VIEWER_ID]);
  });

  it('refuses unknown emails, the owner, and anyone but the owner', async () => {
    Document.findById.mockResolvedValue(makeDoc());
    User.findOne.mockResolvedValue(null);
    expect((await call('POST', `/${DOC_ID}/share`, { body: { email: 'nobody@example.com' } })).status).toBe(404);
    User.findOne.mockResolvedValue({ _id: OWNER_ID });
    expect((await call('POST', `/${DOC_ID}/share`, { body: { email: 'me@example.com' } })).status).toBe(400);
    expect((await call('POST', `/${DOC_ID}/share`, { userId: COLLAB_ID, body: { email: 'x@example.com' } })).status).toBe(403);
  });

  it('lets someone leave a document shared with them', async () => {
    const doc = makeDoc({ viewerIds: [VIEWER_ID] });
    Document.findById.mockResolvedValue(doc);
    expect((await call('DELETE', `/${DOC_ID}/share/${COLLAB_ID}`, { userId: VIEWER_ID })).status).toBe(403);
    expect((await call('DELETE', `/${DOC_ID}/share/${VIEWER_ID}`, { userId: VIEWER_ID })).status).toBe(200);
    expect(doc.viewerIds).toEqual([]);
  });
});

describe('view-only access', () => {
  it('can read and download but not change, save or delete', async () => {
    const doc = makeDoc({ viewerIds: [VIEWER_ID] });
    Document.findById.mockResolvedValue(doc);
    const res = await call('GET', `/${DOC_ID}`, { userId: VIEWER_ID });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'viewer', isOwner: false });
    expect((await call('GET', `/${DOC_ID}/export/docx`, { userId: VIEWER_ID })).status).toBe(200);
    expect((await call('PUT', `/${DOC_ID}`, { userId: VIEWER_ID, body: { title: 'Mine now' } })).status).toBe(403);
    expect((await call('POST', `/${DOC_ID}/save`, { userId: VIEWER_ID })).status).toBe(403);
    expect((await call('DELETE', `/${DOC_ID}`, { userId: VIEWER_ID })).status).toBe(403);
    expect(doc.save).not.toHaveBeenCalled();
    expect(doc.title).toBe('Plan');
  });
});

describe('document comments', () => {
  const populated = (c) => ({ ...c, populate: vi.fn().mockResolvedValue(undefined) });

  it('lets editors start a thread on quoted text, and viewers only read', async () => {
    Document.findById.mockResolvedValue(makeDoc({ viewerIds: [VIEWER_ID] }));
    DocumentComment.create.mockImplementation(async (c) => populated({ _id: COMMENT_ID, ...c, replies: [], createdAt: new Date() }));
    const res = await call('POST', `/${DOC_ID}/comments`, { userId: COLLAB_ID, body: { text: ' Check this ', quote: 'Hello there' } });
    expect(res.status).toBe(201);
    expect(DocumentComment.create).toHaveBeenCalledWith(expect.objectContaining({ documentId: DOC_ID, authorId: COLLAB_ID, text: 'Check this', quote: 'Hello there' }));
    expect(res.body).toMatchObject({ id: COMMENT_ID, text: 'Check this', quote: 'Hello there', resolved: false });

    expect((await call('POST', `/${DOC_ID}/comments`, { userId: VIEWER_ID, body: { text: 'hi' } })).status).toBe(403);
    DocumentComment.find.mockReturnValue({ sort: () => ({ populate: async () => [populated({ _id: COMMENT_ID, text: 'Check this', replies: [] })] }) });
    const list = await call('GET', `/${DOC_ID}/comments`, { userId: VIEWER_ID });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it('only lets the author or the owner delete a thread', async () => {
    Document.findById.mockResolvedValue(makeDoc({ collaboratorIds: [COLLAB_ID, VIEWER_ID] }));
    const thread = { _id: COMMENT_ID, documentId: DOC_ID, authorId: COLLAB_ID, deleteOne: vi.fn() };
    DocumentComment.findById.mockResolvedValue(thread);
    expect((await call('DELETE', `/${DOC_ID}/comments/${COMMENT_ID}`, { userId: VIEWER_ID })).status).toBe(403);
    expect((await call('DELETE', `/${DOC_ID}/comments/${COMMENT_ID}`, { userId: OWNER_ID })).status).toBe(204);
    expect(thread.deleteOne).toHaveBeenCalled();
  });
});

describe('document versions', () => {
  it('saves a named version of the current document', async () => {
    Document.findById.mockResolvedValue(makeDoc());
    DocumentVersion.create.mockImplementation(async (v) => ({ _id: VERSION_ID, ...v, createdAt: new Date(), populate: vi.fn() }));
    DocumentVersion.find.mockReturnValue({ select: () => ({ sort: async () => [] }) });
    const res = await call('POST', `/${DOC_ID}/versions`, { body: { label: 'Draft 1' } });
    expect(res.status).toBe(201);
    expect(DocumentVersion.create).toHaveBeenCalledWith(expect.objectContaining({ documentId: DOC_ID, label: 'Draft 1', kind: 'manual', content: CONTENT }));
    expect(res.body).toMatchObject({ id: VERSION_ID, label: 'Draft 1' });
  });

  it('restores a version after keeping what was there', async () => {
    const doc = makeDoc();
    Document.findById.mockResolvedValue(doc);
    const old = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Older words here' }] }] };
    DocumentVersion.findById.mockReturnValue({ populate: async () => ({ _id: VERSION_ID, documentId: DOC_ID, kind: 'manual', content: old, page: PAGE, layout: null, wordCount: 3 }) });
    DocumentVersion.create.mockImplementation(async (v) => ({ _id: '64b0000000000000000000e2', ...v }));
    DocumentVersion.find.mockReturnValue({ select: () => ({ sort: async () => [] }) });
    const res = await call('POST', `/${DOC_ID}/versions/${VERSION_ID}/restore`);
    expect(res.status).toBe(200);
    expect(DocumentVersion.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'restore', content: CONTENT }));
    expect(doc.content).toEqual(old);
    expect(doc.title).toBe('Plan');
    expect(doc.save).toHaveBeenCalled();

    expect((await call('POST', `/${DOC_ID}/versions/${VERSION_ID}/restore`, { userId: STRANGER_ID })).status).toBe(403);
  });
});

describe('Save', () => {
  it('keeps an automatic version when the last one is old', async () => {
    Document.findById.mockResolvedValue(makeDoc());
    DocumentVersion.findOne.mockReturnValue({ sort: () => ({ select: async () => ({ createdAt: new Date(Date.now() - 3600e3), fingerprint: 'other' }) }) });
    DocumentVersion.create.mockImplementation(async (v) => ({ _id: VERSION_ID, ...v }));
    DocumentVersion.find.mockReturnValue({ select: () => ({ sort: async () => [] }) });
    const res = await call('POST', `/${DOC_ID}/save`);
    expect(res.status).toBe(200);
    expect(res.body.versionId).toBe(VERSION_ID);
    expect(DocumentVersion.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'auto' }));
  });
});
