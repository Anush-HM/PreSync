import { createServer } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';

vi.mock('../models/Deck.js', () => ({ default: { findById: vi.fn(), findByIdAndUpdate: vi.fn() } }));
vi.mock('../models/Document.js', () => ({ default: { findById: vi.fn(), findByIdAndUpdate: vi.fn() } }));

const { default: Document } = await import('../models/Document.js');
const { attachYjsServer } = await import('./server.js');
const { disconnectFromDocument, ACCESS_CHANGED } = await import('./rooms.js');
const { FRAGMENT, META, readContent, writeContent } = await import('./documentYjs.js');
const { flushDocumentDoc, applyToLiveDoc, touchComments } = await import('./documentManager.js');

const OWNER_ID = '64b000000000000000000001';
const EDITOR_ID = '64b000000000000000000002';
const VIEWER_ID = '64b000000000000000000003';
const STRANGER_ID = '64b000000000000000000004';
const PAGE = { width: 816, height: 1056, margins: { top: 96, right: 96, bottom: 96, left: 96 } };
const STORED = {
  title: 'Plan',
  page: PAGE,
  layout: null,
  content: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world', marks: [{ type: 'bold' }] }] },
      { type: 'bulletList', attrs: { listStyle: 'square' }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] }
    ]
  }
};

let httpServer;
let baseUrl;
let counter = 0;
const clients = [];
let saved;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  httpServer = createServer();
  attachYjsServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  baseUrl = `ws://localhost:${httpServer.address().port}`;
});

afterAll(() => new Promise((resolve) => httpServer.close(resolve)));

beforeEach(() => {
  saved = [];
  Document.findByIdAndUpdate.mockImplementation((id, fields) => ({ exec: async () => { saved.push(fields); } }));
  Document.findById.mockImplementation(() => ({
    select: () => ({ lean: async () => ({ ownerId: OWNER_ID, collaboratorIds: [EDITOR_ID], viewerIds: [VIEWER_ID] }) }),
    lean: async () => structuredClone(STORED)
  }));
});

afterEach(async () => {
  while (clients.length) clients.pop().close();
  await new Promise((r) => setTimeout(r, 80));
  vi.clearAllMocks();
});

const nextId = () => `64b0000000000000000002${String(++counter).padStart(2, '0')}`;

function connect(documentId, userId) {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET);
  const ws = new WebSocket(`${baseUrl}/yjs/documents/${documentId}?token=${token}`);
  ws.binaryType = 'arraybuffer';
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  let synced;
  const ready = new Promise((resolve) => (synced = resolve));
  const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  const send = (encoder) => ws.readyState === WebSocket.OPEN && ws.send(encoding.toUint8Array(encoder));

  ws.on('open', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(encoder);
    const a = encoding.createEncoder();
    encoding.writeVarUint(a, 1);
    encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]));
    send(a);
  });
  ws.on('message', (data) => {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(decoder);
    if (type === 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      const kind = syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
      if (kind === syncProtocol.messageYjsSyncStep2) synced();
      if (encoding.length(encoder) > 1) send(encoder);
    } else if (type === 1) {
      awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
    }
  });
  doc.on('update', (update, origin) => {
    if (origin === ws) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    send(encoder);
  });
  awareness.setLocalStateField('user', { name: userId, color: '#336699' });
  const client = { ws, doc, awareness, ready, closed, close: () => ws.close() };
  clients.push(client);
  return client;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await wait(10);
  }
}

describe('documentYjs', () => {
  it('round-trips stored content through a Y.Doc like the editor stores it', () => {
    const doc = new Y.Doc();
    writeContent(doc.getXmlFragment(FRAGMENT), STORED.content);
    expect(readContent(doc.getXmlFragment(FRAGMENT))).toEqual(STORED.content);
  });

  it('reads overlapping-mark names the way y-tiptap writes them', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment(FRAGMENT);
    const p = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    text.insert(0, 'hi', { 'comment--abcdEFGH': { commentId: 'a'.repeat(24) }, italic: {} });
    p.insert(0, [text]);
    fragment.insert(0, [p]);
    expect(readContent(fragment).content[0].content[0].marks).toEqual([
      { type: 'comment', attrs: { commentId: 'a'.repeat(24) } },
      { type: 'italic' }
    ]);
  });
});

describe('Word document co-editing over /yjs/documents/:id', () => {
  it('gives the stored document to an editor and shares edits with others', async () => {
    const id = nextId();
    const a = connect(id, OWNER_ID);
    const b = connect(id, EDITOR_ID);
    await Promise.all([a.ready, b.ready]);
    expect(readContent(a.doc.getXmlFragment(FRAGMENT))).toEqual(STORED.content);
    expect(a.doc.getMap(META).get('title')).toBe('Plan');

    const para = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    text.insert(0, 'typed by A');
    para.insert(0, [text]);
    a.doc.getXmlFragment(FRAGMENT).push([para]);
    await until(() => b.doc.getXmlFragment(FRAGMENT).length === 3);
    expect(readContent(b.doc.getXmlFragment(FRAGMENT)).content[2].content[0].text).toBe('typed by A');

    // Presence: B sees A.
    await until(() => [...b.awareness.getStates().values()].some((s) => s.user?.name === OWNER_ID));
  });

  it('lets a viewer follow along but drops their changes', async () => {
    const id = nextId();
    const editor = connect(id, OWNER_ID);
    const viewer = connect(id, VIEWER_ID);
    await Promise.all([editor.ready, viewer.ready]);

    viewer.doc.getMap(META).set('layout', { junk: true });
    viewer.doc.getXmlFragment(FRAGMENT).delete(0, 1);
    await wait(150);
    expect(editor.doc.getMap(META).get('layout')).not.toHaveProperty('junk');
    expect(editor.doc.getXmlFragment(FRAGMENT).length).toBe(2);

    editor.doc.getMap(META).set('title', 'Renamed');
    await until(() => viewer.doc.getMap(META).get('title') === 'Renamed');

    // The viewer is still shown as present to editors.
    await until(() => [...editor.awareness.getStates().values()].some((s) => s.user?.name === VIEWER_ID));
  });

  it('refuses people without access', async () => {
    const stranger = connect(nextId(), STRANGER_ID);
    expect(await stranger.closed).toBe(4003);
  });

  it('saves the live copy to Mongo, cleaned, on flush and when the last person leaves', async () => {
    const id = nextId();
    const a = connect(id, OWNER_ID);
    await a.ready;
    a.doc.getMap(META).set('title', '  New title  ');
    const para = new Y.XmlElement('paragraph');
    para.setAttribute('onclick', 'alert(1)');
    const text = new Y.XmlText();
    text.insert(0, 'three more words', { bold: {} });
    para.insert(0, [text]);
    a.doc.getXmlFragment(FRAGMENT).push([para]);
    await wait(50);

    expect(await flushDocumentDoc(id)).toBe(true);
    const fields = saved.at(-1);
    expect(fields.title).toBe('New title');
    expect(fields.wordCount).toBe(6);
    expect(fields.content.content[2]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'three more words', marks: [{ type: 'bold' }] }] });
    expect(fields.page).toEqual(PAGE);

    const before = saved.length;
    a.close();
    await until(() => saved.length > before);
    expect(await flushDocumentDoc(id)).toBe(false);
  });

  it('puts restored content into the live copy and tells editors about comment changes', async () => {
    const id = nextId();
    const a = connect(id, EDITOR_ID);
    await a.ready;
    const restored = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old version' }] }] };
    expect(await applyToLiveDoc(id, { content: restored })).toBe(true);
    await until(() => readContent(a.doc.getXmlFragment(FRAGMENT)).content[0]?.content?.[0]?.text === 'Old version');
    expect(a.doc.getXmlFragment(FRAGMENT).length).toBe(1);

    await touchComments(id);
    await until(() => a.doc.getMap(META).get('commentsRev') === 1);
    expect(await applyToLiveDoc(nextId(), { content: restored })).toBe(false);
  });

  it('closes one person’s connections when the owner changes their access', async () => {
    const id = nextId();
    const owner = connect(id, OWNER_ID);
    const editor = connect(id, EDITOR_ID);
    await Promise.all([owner.ready, editor.ready]);
    disconnectFromDocument(id, EDITOR_ID);
    expect(await editor.closed).toBe(ACCESS_CHANGED);
    expect(owner.ws.readyState).toBe(WebSocket.OPEN);
  });
});
