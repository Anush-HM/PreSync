import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';

import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { registerSocketHandlers } from './sockets/index.js';
import { attachYjsServer } from './yjs/server.js';

// Comma-separated in production (e.g. "https://app.example.com,https://presync.example.com").
// A single localhost origin is fine for local dev and is what ships by default.
const allowedOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
const corsOptions = { origin: allowedOrigins.length > 1 ? allowedOrigins : allowedOrigins[0] };

const app = createApp({ corsOptions });

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: corsOptions });
registerSocketHandlers(io);

// Exposed to REST controllers via req.app.get('io') — e.g. roomController's
// endRoom needs to broadcast `room:ended` to the Socket.io room, but ending
// a session is an authenticated REST action, not a socket event itself.
app.set('io', io);

// Yjs concurrent-editing layer. Fully separate from the Socket.io
// broadcast above — different upgrade path (/yjs/:deckId), different
// auth (JWT-gated to editors), different protocol.
attachYjsServer(httpServer);

const PORT = process.env.PORT || 4000;

async function start() {
  await connectDB();
  httpServer.listen(PORT, () => {
    console.log(`PreSync backend listening on :${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});