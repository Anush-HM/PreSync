import { io } from 'socket.io-client';
import { WS_BASE } from './apiConfig.js';

// The backend expects plain ws(s):// upgrade via socket.io's own
// transport, not the raw WebSocket URL shape yjsClient.js uses — so this
// connects against the http(s) origin and lets socket.io negotiate.
const HTTP_BASE = WS_BASE.replace(/^ws/, 'http');

// One socket per mount (Presenter/ViewerLive pages each create + tear
// down their own). Autoconnect off so callers can attach listeners
// before the connection opens and race nothing.
export function createSocket() {
  return io(HTTP_BASE, { autoConnect: false, transports: ['websocket', 'polling'] });
}