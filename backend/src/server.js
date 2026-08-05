import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import deckRoutes from './routes/deckRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import { registerSocketHandlers } from './sockets/index.js';
import { attachYjsServer } from './yjs/server.js';

const app = express();

// Comma-separated in production (e.g. "https://app.example.com,https://presync.example.com").
// A single localhost origin is fine for local dev and is what ships by default.
const allowedOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
const corsOptions = { origin: allowedOrigins.length > 1 ? allowedOrigins : allowedOrigins[0] };

app.use(cors(corsOptions));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/decks', deckRoutes);
app.use('/api/rooms', roomRoutes);

// Centralized error handler — controllers can throw/reject freely.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

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