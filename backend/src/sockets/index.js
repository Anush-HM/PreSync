import jwt from 'jsonwebtoken';
import Deck from '../models/Deck.js';
import Room from '../models/Room.js';
import Question from '../models/Question.js';
import { draftAnswer } from '../services/qaService.js';

// Two socket.io rooms per session code:
//   `room:${code}`      — presenter + all viewers, one-way broadcast traffic
//   `presenter:${code}` — presenter's socket only, for private Q&A drafts
// Viewers are never joined to the presenter channel — there is no event
// name a viewer socket could emit that reaches it, which is what keeps
// this boundary architectural rather than a permissions check.

// Counts sockets currently in a room's broadcast channel that joined as
// viewers (excludes the presenter's own socket, which shares the same
// channel for slide:sync/qa:answer delivery).
function countViewers(io, code) {
  const room = io.sockets.adapter.rooms.get(`room:${code}`);
  if (!room) return 0;
  let count = 0;
  for (const socketId of room) {
    if (io.sockets.sockets.get(socketId)?.data.role === 'viewer') count++;
  }
  return count;
}

function broadcastViewerCount(io, code) {
  io.to(`presenter:${code}`).emit('viewer:count', { count: countViewers(io, code) });
}

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('presenter:join', async ({ token, code }) => {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const room = await Room.findOne({ code: code.toUpperCase(), active: true });
        if (!room || room.presenterId.toString() !== payload.sub) {
          return socket.emit('error', { message: 'Not authorized to present this room' });
        }
        socket.data.role = 'presenter';
        socket.data.roomCode = code.toUpperCase();
        socket.join(`room:${socket.data.roomCode}`);
        socket.join(`presenter:${socket.data.roomCode}`);
        socket.emit('presenter:joined', { code: socket.data.roomCode });
        broadcastViewerCount(io, socket.data.roomCode);
      } catch {
        socket.emit('error', { message: 'Invalid presenter token' });
      }
    });

    socket.on('viewer:join', async ({ code, viewerId }) => {
      const room = await Room.findOne({ code: code.toUpperCase(), active: true });
      if (!room) return socket.emit('error', { message: 'No active session with that code' });

      socket.data.role = 'viewer';
      socket.data.viewerId = viewerId;
      socket.data.roomCode = code.toUpperCase();
      socket.join(`room:${socket.data.roomCode}`);
      socket.emit('viewer:joined', { currentSlideId: room.currentSlideId });
      broadcastViewerCount(io, socket.data.roomCode);

      // Send this viewer an immediate snapshot of whatever slide is
      // already live, since slide:sync is otherwise only broadcast on
      // the *next* presenter navigation — without this, a viewer who
      // joins mid-session sees nothing until the presenter moves.
      if (room.currentSlideId) {
        const deck = await Deck.findById(room.deckId);
        const slide = deck?.slides.find((s) => s.id === room.currentSlideId);
        if (slide) {
          socket.emit('slide:sync', {
            slideId: slide.id,
            blocks: slide.blocks,
            backgroundImageUrl: slide.backgroundImageUrl
          });
        }
      }
    });

    socket.on('disconnect', () => {
      if (socket.data.role === 'viewer' && socket.data.roomCode) {
        broadcastViewerCount(io, socket.data.roomCode);
      }
    });

    // Presenter navigates to a slide. The slide is snapshotted here — we
    // read the deck's current persisted content for that slide id and
    // push exactly that snapshot, so a background edit that lands a
    // moment later doesn't leak into the broadcast until the presenter
    // (re)visits the slide.
    socket.on('presenter:slide-change', async ({ slideId }) => {
      if (socket.data.role !== 'presenter') return;

      const room = await Room.findOne({ code: socket.data.roomCode, active: true });
      if (!room) return;

      const deck = await Deck.findById(room.deckId);
      const slide = deck?.slides.find((s) => s.id === slideId);
      if (!slide) return;

      room.currentSlideId = slideId;
      await room.save();

      io.to(`room:${socket.data.roomCode}`).emit('slide:sync', {
        slideId: slide.id,
        blocks: slide.blocks,
        backgroundImageUrl: slide.backgroundImageUrl
      });
    });

    // Viewer submits a question. We draft an answer server-side (grounded
    // in the deck, see qaService) and route the draft ONLY to the
    // presenter channel — it never reaches other viewers until the
    // presenter explicitly sends it.
    socket.on('question:submit', async ({ text }) => {
      if (socket.data.role !== 'viewer') return;

      const room = await Room.findOne({ code: socket.data.roomCode, active: true });
      if (!room) return;

      const question = await Question.create({
        roomId: room._id,
        viewerId: socket.data.viewerId,
        slideId: room.currentSlideId,
        text
      });

      io.to(`presenter:${socket.data.roomCode}`).emit('question:new', {
        id: question._id,
        text: question.text,
        status: 'pending'
      });

      try {
        const deck = await Deck.findById(room.deckId);
        const draft = await draftAnswer({ deck, slideId: room.currentSlideId, question: text });
        question.draftAnswer = draft;
        question.status = 'drafted';
        await question.save();

        io.to(`presenter:${socket.data.roomCode}`).emit('question:drafted', {
          id: question._id,
          draftAnswer: draft
        });
      } catch (err) {
        io.to(`presenter:${socket.data.roomCode}`).emit('question:draft-failed', {
          id: question._id,
          error: err.message
        });
      }
    });

    // Presenter approves — this is the only path by which an answer ever
    // reaches the room. Drafts are never auto-sent.
    socket.on('question:send', async ({ questionId, answer }) => {
      if (socket.data.role !== 'presenter') return;

      const question = await Question.findById(questionId);
      if (!question) return;

      question.status = 'sent';
      if (answer) question.draftAnswer = answer;
      await question.save();

      io.to(`room:${socket.data.roomCode}`).emit('qa:answer', {
        id: question._id,
        question: question.text,
        answer: question.draftAnswer
      });
    });

    socket.on('question:dismiss', async ({ questionId }) => {
      if (socket.data.role !== 'presenter') return;
      const question = await Question.findByIdAndUpdate(
        questionId,
        { status: 'dismissed' },
        { new: true }
      );
      if (!question) return;

      // Notify only the viewer who submitted this question, not the whole room.
      // We scan the broadcast channel for the socket whose viewerId matches.
      const roomSockets = io.sockets.adapter.rooms.get(`room:${socket.data.roomCode}`);
      if (roomSockets) {
        for (const socketId of roomSockets) {
          const s = io.sockets.sockets.get(socketId);
          if (s?.data.viewerId === question.viewerId) {
            s.emit('question:dismissed', { questionId, text: question.text });
            break;
          }
        }
      }
    });
  });
}