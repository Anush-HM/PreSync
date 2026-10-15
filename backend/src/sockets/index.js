import jwt from 'jsonwebtoken';
import Deck from '../models/Deck.js';
import Room from '../models/Room.js';
import Question from '../models/Question.js';
import { draftAnswer } from '../services/qaService.js';
import {
  SocketInputError,
  asPayload,
  parseOptionalAnswer,
  parseQuestionId,
  parseQuestionText,
  parseRoomCode,
  parseSlideId,
  parseToken,
  parseViewerId
} from './validation.js';

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

// Wraps an async handler so nothing it throws can escape as an unhandled
// rejection (which would take the whole process down). Bad input is
// reported back to the sender with its own message; anything else is
// logged and reported generically so internals don't leak to clients.
function guard(socket, event, handler) {
  return async (payload) => {
    try {
      await handler(asPayload(payload));
    } catch (err) {
      if (err instanceof SocketInputError) {
        socket.emit('error', { message: err.message });
        return;
      }
      console.error(`Socket handler '${event}' failed:`, err);
      socket.emit('error', { message: 'Something went wrong' });
    }
  };
}

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    const on = (event, handler) => socket.on(event, guard(socket, event, handler));

    on('presenter:join', async ({ token, code }) => {
      const roomCode = parseRoomCode(code);
      let payload;
      try {
        payload = jwt.verify(parseToken(token), process.env.JWT_SECRET);
      } catch {
        return socket.emit('error', { message: 'Invalid presenter token' });
      }

      const room = await Room.findOne({ code: roomCode, active: true });
      if (!room || room.presenterId.toString() !== payload.sub) {
        return socket.emit('error', { message: 'Not authorized to present this room' });
      }
      socket.data.role = 'presenter';
      socket.data.roomCode = roomCode;
      socket.join(`room:${socket.data.roomCode}`);
      socket.join(`presenter:${socket.data.roomCode}`);
      socket.emit('presenter:joined', { code: socket.data.roomCode });
      broadcastViewerCount(io, socket.data.roomCode);
    });

    on('viewer:join', async ({ code, viewerId }) => {
      const roomCode = parseRoomCode(code);
      const validViewerId = parseViewerId(viewerId);

      const room = await Room.findOne({ code: roomCode, active: true });
      if (!room) return socket.emit('error', { message: 'No active session with that code' });

      socket.data.role = 'viewer';
      socket.data.viewerId = validViewerId;
      socket.data.roomCode = roomCode;
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
    on('presenter:slide-change', async ({ slideId: rawSlideId }) => {
      if (socket.data.role !== 'presenter') return;
      const slideId = parseSlideId(rawSlideId);

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
    on('question:submit', async ({ text: rawText }) => {
      if (socket.data.role !== 'viewer') return;
      const text = parseQuestionText(rawText);

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
    on('question:send', async ({ questionId: rawQuestionId, answer: rawAnswer }) => {
      if (socket.data.role !== 'presenter') return;
      const questionId = parseQuestionId(rawQuestionId);
      const answer = parseOptionalAnswer(rawAnswer);

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

    on('question:dismiss', async ({ questionId }) => {
      if (socket.data.role !== 'presenter') return;
      await Question.findByIdAndUpdate(parseQuestionId(questionId), { status: 'dismissed' });
    });
  });
}