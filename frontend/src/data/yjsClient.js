import * as Y from 'yjs';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import { WS_BASE, getAuthToken } from './apiConfig.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const RECONNECT_DELAY_MS = 1500;

// Connects a deck's Y.Doc to the backend's Yjs server. Returns
// { doc, awareness, disconnect, onStatus }, where onStatus(cb) reports
// 'connecting' | 'synced' | 'offline' and returns an unsubscribe. Reconnects on drop so background
// editors don't lose the live session over a flaky connection.
export function connectYjsDoc(deckId) {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);

  let ws = null;
  let shouldReconnect = true;
  let reconnectTimer = null;
  let status = 'connecting';
  const statusListeners = new Set();

  function setStatus(next) {
    if (status === next) return;
    status = next;
    statusListeners.forEach((cb) => cb(status));
  }

  function send(encoder) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(encoding.toUint8Array(encoder));
  }

  function open() {
    ws = new WebSocket(`${WS_BASE}/yjs/${deckId}?token=${encodeURIComponent(getAuthToken())}`);
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, doc);
      send(encoder);
    });

    ws.addEventListener('message', (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data));
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncType = syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
        if (syncType === syncProtocol.messageYjsSyncStep2) setStatus('synced');
        if (encoding.length(encoder) > 1) send(encoder);
      } else if (messageType === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
      }
    });

    ws.addEventListener('close', () => {
      if (!shouldReconnect) return;
      setStatus('offline');
      reconnectTimer = setTimeout(open, RECONNECT_DELAY_MS);
    });
  }

  doc.on('update', (update, origin) => {
    if (origin === ws) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    send(encoder);
  });

  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin === ws) return;
    const changed = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    send(encoder);
  });

  open();

  function disconnect() {
    shouldReconnect = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], null);
    ws?.close();
    doc.destroy();
  }

  function onStatus(cb) {
    statusListeners.add(cb);
    cb(status);
    return () => statusListeners.delete(cb);
  }

  return { doc, awareness, disconnect, onStatus };
}

// --- Helpers for reading/writing the shared slide/block shape ---------
// Mirrors the backend's docManager.js plain<->Y.Map mapping so both
// sides agree on what a "slide" and "block" look like inside the doc.

export function getSlidesArray(doc) {
  return doc.getArray('slides');
}

// Optional fields copied verbatim when set. Keep in step with
// BLOCK_OPTIONAL_KEYS / SLIDE_OPTIONAL_KEYS in backend/src/yjs/docManager.js.
export const BLOCK_OPTIONAL_KEYS = [
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'underline',
  'linethrough',
  'fill',
  'textAlign',
  'lineHeight',
  'paragraphSpacing',
  'styles',
  'height',
  'verticalAlign',
  'rotation',
  'flipH',
  'flipV',
  'role',
  'shape',
  'path',
  'radius',
  'background',
  'fillGradient',
  'opacity',
  'stroke',
  'strokeWidth',
  'dash',
  'table',
  'chart',
  'imageUrl',
  'textBackgroundColor',
  'crop',
  'shadow',
  'alt',
  'locked',
  'groupId',
  'layoutSlot',
  'lockAspect'
];
export const SLIDE_OPTIONAL_KEYS = ['backgroundImageUrl', 'backgroundColor', 'backgroundGradient', 'backgroundRepeat', 'name', 'hidden', 'layout', 'theme'];

function copyOptional(keys, read, write) {
  for (const key of keys) {
    const value = read(key);
    if (value !== undefined && value !== null && value !== '') write(key, value);
  }
}

export function slideMapToPlain(slideMap) {
  const plain = {
    id: slideMap.get('id'),
    order: slideMap.get('order'),
    needsImageFallback: !!slideMap.get('needsImageFallback'),
    notes: slideMap.get('notes') ?? '',
    blocks: slideMap.get('blocks').toArray().map(blockMapToPlain)
  };
  copyOptional(SLIDE_OPTIONAL_KEYS, (k) => slideMap.get(k), (k, v) => (plain[k] = v));
  return plain;
}

export function blockMapToPlain(blockMap) {
  const plain = {
    id: blockMap.get('id'),
    type: blockMap.get('type') || 'textbox',
    x: blockMap.get('x'),
    y: blockMap.get('y'),
    width: blockMap.get('width'),
    fontSize: blockMap.get('fontSize') ?? 16,
    text: blockMap.get('text') ?? ''
  };
  copyOptional(BLOCK_OPTIONAL_KEYS, (k) => blockMap.get(k), (k, v) => (plain[k] = v));
  return plain;
}

export function plainToBlockMap(block) {
  const m = new Y.Map();
  m.set('id', block.id);
  m.set('type', block.type || 'textbox');
  m.set('x', block.x);
  m.set('y', block.y);
  m.set('width', block.width);
  m.set('fontSize', block.fontSize ?? 16);
  m.set('text', block.text ?? '');
  copyOptional(BLOCK_OPTIONAL_KEYS, (k) => block[k], (k, v) => m.set(k, v));
  return m;
}

export function plainToSlideMap(slide) {
  const m = new Y.Map();
  m.set('id', slide.id);
  m.set('order', slide.order);
  m.set('needsImageFallback', !!slide.needsImageFallback);
  m.set('notes', slide.notes ?? '');
  copyOptional(SLIDE_OPTIONAL_KEYS, (k) => slide[k], (k, v) => m.set(k, v));
  const blocks = new Y.Array();
  blocks.push((slide.blocks || []).map(plainToBlockMap));
  m.set('blocks', blocks);
  return m;
}
