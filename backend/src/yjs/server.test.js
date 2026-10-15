import { createServer } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';

vi.mock('../models/Deck.js', () => ({
  default: { findById: vi.fn(), findByIdAndUpdate: vi.fn() }
}));

const { default: Deck } = await import('../models/Deck.js');
const { attachYjsServer } = await import('./server.js');

const OWNER_ID = '64b000000000000000000001';
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

let httpServer;
let baseUrl;
let deckCounter = 0;
let slideLoads;
let releaseSlideLoads;
const clients = [];

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  httpServer = createServer();
  attachYjsServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  baseUrl = `ws://localhost:${httpServer.address().port}`;
});

afterAll(() => new Promise((resolve) => httpServer.close(resolve)));

beforeEach(() => {
  slideLoads = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  releaseSlideLoads = release;

  Deck.findByIdAndUpdate.mockReturnValue({ exec: () => Promise.resolve() });
  Deck.findById.mockImplementation(() => ({
    // Permission check in server.js, with a real DB round-trip's delay.
    select: () => ({
      lean: () =>
        new Promise((resolve) => setTimeout(() => resolve({ ownerId: OWNER_ID, collaboratorIds: [] }), 20))
    }),
    // Hydration in docManager.js; held until the test releases it so
    // several editors can pile up on the same deck mid-load.
    lean: async () => {
      slideLoads += 1;
      await gate;
      return {
        slides: [{ id: 's1', order: 0, blocks: [{ id: 'b1', x: 0, y: 0, width: 100, text: 'hello' }] }]
      };
    }
  }));
});

afterEach(async () => {
  while (clients.length) clients.pop().close();
  // Let close handlers run before mocks are reset.
  await new Promise((r) => setTimeout(r, 50));
  vi.clearAllMocks();
});

function nextDeckId() {
  deckCounter += 1;
  return `64b0000000000000000001${String(deckCounter).padStart(2, '0')}`;
}

// Minimal editor client mirroring frontend/src/data/yjsClient.js.
function connectEditor(deckId) {
  const token = jwt.sign({ sub: OWNER_ID }, process.env.JWT_SECRET);
  const ws = new WebSocket(`${baseUrl}/yjs/${deckId}?token=${token}`);
  ws.binaryType = 'arraybuffer';
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);

  function send(encoder) {
    if (ws.readyState === WebSocket.OPEN) ws.send(encoding.toUint8Array(encoder));
  }

  ws.on('open', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(encoder);
  });

  ws.on('message', (data) => {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
      if (encoding.length(encoder) > 1) send(encoder);
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
    }
  });

  doc.on('update', (update, origin) => {
    if (origin === ws) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    send(encoder);
  });

  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin === ws) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, added.concat(updated, removed))
    );
    send(encoder);
  });

  const client = {
    ws,
    doc,
    awareness,
    close: () => ws.close(),
    // Simulates a dropped connection: no goodbye awareness update.
    kill: () => ws.terminate()
  };
  clients.push(client);
  return client;
}

function waitFor(check, timeout = 2000) {
  return vi.waitFor(() => {
    if (!check()) throw new Error('condition not met yet');
  }, { timeout, interval: 10 });
}

function slideText(doc) {
  const slides = doc.getArray('slides');
  if (slides.length === 0) return undefined;
  return slides.get(0).get('blocks').get(0).get('text');
}

describe('Yjs co-editing server', () => {
  it('gives editors who join while the deck is loading the same document', async () => {
    const deckId = nextDeckId();
    const a = connectEditor(deckId);
    const b = connectEditor(deckId);
    await waitFor(() => a.ws.readyState === WebSocket.OPEN && b.ws.readyState === WebSocket.OPEN);
    // Give both connections time to reach getDoc while hydration is blocked.
    await new Promise((r) => setTimeout(r, 50));
    releaseSlideLoads();

    await waitFor(() => slideText(a.doc) === 'hello' && slideText(b.doc) === 'hello');
    expect(slideLoads).toBe(1);
    expect(a.doc.getArray('slides').length).toBe(1);

    a.doc.getArray('slides').get(0).get('blocks').get(0).set('text', 'edited by A');
    await waitFor(() => slideText(b.doc) === 'edited by A');
  });

  it('sends the full deck to an editor who joins after it is loaded', async () => {
    releaseSlideLoads();
    const deckId = nextDeckId();
    const a = connectEditor(deckId);
    await waitFor(() => slideText(a.doc) === 'hello');

    const b = connectEditor(deckId);
    await waitFor(() => slideText(b.doc) === 'hello');
  });

  it("clears a dropped editor's cursor for everyone still connected", async () => {
    releaseSlideLoads();
    const deckId = nextDeckId();
    const a = connectEditor(deckId);
    const b = connectEditor(deckId);
    await waitFor(() => slideText(a.doc) === 'hello' && slideText(b.doc) === 'hello');

    a.awareness.setLocalState({ user: 'A', cursor: { slide: 's1' } });
    await waitFor(() => b.awareness.getStates().has(a.doc.clientID));

    a.kill();
    await waitFor(() => !b.awareness.getStates().has(a.doc.clientID));
  });
});
