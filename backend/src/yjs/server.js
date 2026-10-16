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
const awarenessByDeck = new Map(); // deckId -> { awareness, conns }

// Shares one Awareness per deck across all of its open sockets. It lives
// exactly as long as the deck has a connection, so every socket on a deck
// is always talking to the same instance.
function getAwareness(deckId, doc) {
  let entry = awarenessByDeck.get(deckId);
  if (!entry) {
    const awareness = new awarenessProtocol.Awareness(doc);
    // The server is a relay, not a participant: drop the empty local state
    // the Awareness constructor creates for the server's own clientID.
    awareness.setLocalState(null);
    entry = { awareness, conns: 0 };
    awarenessByDeck.set(deckId, entry);
  }
  entry.conns += 1;
  return entry.awareness;
}

function releaseAwareness(deckId) {
  const entry = awarenessByDeck.get(deckId);
  if (!entry) return;
  entry.conns -= 1;
  if (entry.conns <= 0) {
    awarenessByDeck.delete(deckId);
    entry.awareness.destroy();
  }
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

    // Clients send their sync step 1 the moment the socket opens, which is
    // before we finish auth and loading the deck below. Buffer anything that
    // arrives in the meantime so it isn't dropped.
    const earlyMessages = [];
    let handleMessage = null;
    ws.on('message', (data) => {
      if (handleMessage) handleMessage(data);
      else earlyMessages.push(data);
    });
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

    let doc;
    try {
      doc = await getDoc(deckId);
    } catch (err) {
      console.error(`Yjs failed to load deck ${deckId}:`, err);
      ws.close(1011, 'Failed to load deck');
      return;
    }
    // The socket may have dropped while we were loading the deck; its close
    // event has already fired, so release here or the refcount leaks.
    if (ws.readyState !== ws.OPEN) {
      releaseDoc(deckId);
      return;
    }
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

    // Awareness clientIDs this socket has announced, so we can clear its
    // cursors if it drops without saying goodbye.
    const controlledIds = new Set();

    function onAwarenessUpdate({ added, updated, removed }, origin) {
      if (origin === ws) {
        added.forEach((id) => controlledIds.add(id));
        removed.forEach((id) => controlledIds.delete(id));
        return;
      }
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      send(encoder);
    }
    awareness.on('update', onAwarenessUpdate);

    handleMessage = (data) => {
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
    };
    earlyMessages.splice(0).forEach(handleMessage);

    ws.on('close', () => {
      doc.off('update', onDocUpdate);
      // Clear this socket's cursors; the remaining sockets' listeners relay
      // the removal to their editors.
      awarenessProtocol.removeAwarenessStates(awareness, Array.from(controlledIds), null);
      awareness.off('update', onAwarenessUpdate);
      releaseAwareness(deckId);
      releaseDoc(deckId);
    });
  });

  return wss;
}