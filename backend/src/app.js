import express from 'express';
import cors from 'cors';

import authRoutes from './routes/authRoutes.js';
import deckRoutes from './routes/deckRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import importRoutes from './routes/importRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import templateRoutes from './routes/templateRoutes.js';

// Builds the Express app without opening a port or a DB connection, so
// server.js can wire it to the HTTP/Socket.io/Yjs servers and tests can
// mount the real routes directly.
export function createApp({ corsOptions } = {}) {
  const app = express();

  app.use(cors(corsOptions));
  // Edited import outlines (with speaker notes) can exceed the default 100kb.
  app.use('/api/imports', express.json({ limit: '2mb' }));
  // Copilot requests carry trimmed editor context (see ai/context.js).
  app.use('/api/ai', express.json({ limit: '512kb' }));
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/decks', deckRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/imports', importRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/templates', templateRoutes);

  // Centralized error handler — controllers can throw/reject freely.
  app.use((err, req, res, next) => {
    // Content that doesn't fit the schema is the client's mistake.
    if (err?.name === 'ValidationError' || err?.name === 'CastError') {
      return res.status(400).json({ error: 'Some of that content is not valid' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
