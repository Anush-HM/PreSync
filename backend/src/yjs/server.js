import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import Deck from '../models/Deck.js';
import { getDoc, releaseDoc } from './docManager.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// This is the Yjs concurrent-editing layer: fully independent of
// presenter/viewer broadcast (see sockets/index.js), which is Socket.io
// only and never touches this server. Only authenticated editors ever
// reach this path — viewers have no token and never connect here.
const awarenessByDeck = new Map(); // deckId -> Awareness

function getAwareness(deckId, doc) {
  let awareness = awarenessByDeck.get(deckId);
  if (!awareness) {
    awareness = new awarenessProtocol.Awareness(doc);
    awarenessByDeck.set(deckId, awareness);
  }
  return awareness;
}

async function isEditorOf(deckId, userId) {
  const deck = await Deck.findById(deckId).select('ownerId collaboratorIds').lean();
  if (!deck) return false;
  return (
    deck.ownerId.toString() === userId ||
    deck.collaboratorIds.some((id) => id.toString() === userId)
  );
}

export function attachYjsServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (!pathname.startsWith('/yjs/')) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, pathname);
    });
  });

  wss.on('connection', async (ws, req, pathname) => {
    const deckId = pathname.slice('/yjs/'.length);
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    let userId;
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      userId = payload.sub;
    } catch {
      ws.close(4001, 'Invalid or missing token');
      return;
    }

    const allowed = await isEditorOf(deckId, userId).catch(() => false);
    if (!allowed) {
      ws.close(4003, 'Not a collaborator on this deck');
      return;
    }

    const doc = await getDoc(deckId);
    const awareness = getAwareness(deckId, doc);
    ws.binaryType = 'arraybuffer';

    function send(encoder) {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(encoding.toUint8Array(encoder));
    }

    // Step 1 of the sync handshake, plus whatever awareness (presence)
    // state already exists for this deck from other connected editors.
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    send(syncEncoder);

    const states = awareness.getStates();
    if (states.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(states.keys()))
      );
      send(awarenessEncoder);
    }

    function onDocUpdate(update, origin) {
      if (origin === ws) return; // don't echo a client's own update back to it
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      send(encoder);
    }
    doc.on('update', onDocUpdate);

    function onAwarenessUpdate({ added, updated, removed }, origin) {
      if (origin === ws) return;
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      send(encoder);
    }
    awareness.on('update', onAwarenessUpdate);

    ws.on('message', (data) => {
      try {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const messageType = decoding.readVarUint(decoder);

        if (messageType === MESSAGE_SYNC) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
          if (encoding.length(encoder) > 1) send(encoder);
        } else if (messageType === MESSAGE_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
        }
      } catch (err) {
        console.error('Yjs message handling error:', err);
      }
    });

    ws.on('close', () => {
      doc.off('update', onDocUpdate);
      awareness.off('update', onAwarenessUpdate);
      awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], null);
      releaseDoc(deckId);
      if (awareness.getStates().size === 0) awarenessByDeck.delete(deckId);
    });
  });

  return wss;
}