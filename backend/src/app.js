import express from 'express';
import cors from 'cors';

import authRoutes from './routes/authRoutes.js';
import deckRoutes from './routes/deckRoutes.js';
import roomRoutes from './routes/roomRoutes.js';

// Builds the Express app without opening a port or a DB connection, so
// server.js can wire it to the HTTP/Socket.io/Yjs servers and tests can
// mount the real routes directly.
export function createApp({ corsOptions } = {}) {
  const app = express();

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

  return app;
}
