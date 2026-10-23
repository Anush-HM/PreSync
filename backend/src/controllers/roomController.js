import mongoose from 'mongoose';
import Deck from '../models/Deck.js';
import { isEditorOf } from './deckController.js';
import Room from '../models/Room.js';
import Viewer from '../models/Viewer.js';
import Question from '../models/Question.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid ambiguity

const MAX_CODE_ATTEMPTS = 5;

function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

// Editor-only: click "Go Live" to start broadcasting a deck. Requires
// requireAuth — this is the only way a Room ever gets created.
export async function goLive(req, res) {
  const { deckId } = req.body;
  const deck = await Deck.findById(deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });

  const isEditor =
    deck.ownerId.toString() === req.userId ||
    deck.collaboratorIds.some((id) => id.toString() === req.userId);
  if (!isEditor) return res.status(403).json({ error: 'Not a collaborator on this deck' });

  // Two rooms can draw the same code at the same moment, so a pre-check
  // can't rule out a clash. Let the code_active_unique index decide: on a
  // duplicate-key error, draw a new code and try the insert again.
  let room;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !room; attempt++) {
    try {
      room = await Room.create({
        code: generateCode(),
        deckId: deck._id,
        presenterId: req.userId,
        currentSlideId: deck.slides[0]?.id
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }
  }
  if (!room) {
    return res.status(503).json({ error: 'Could not allocate a room code, please try again' });
  }

  res.status(201).json({ code: room.code, roomId: room._id });
}

// No auth required — this is the join-by-code path. Anyone with a valid,
// active room code can join as a viewer; the response never exposes
// anything beyond what's needed to render the broadcast + take notes.
export async function joinRoom(req, res) {
  const { code } = req.params;
  const { displayName } = req.body;

  if (!displayName?.trim()) {
    return res.status(400).json({ error: 'displayName is required' });
  }

  const room = await Room.findOne({ code: code.toUpperCase(), active: true });
  if (!room) return res.status(404).json({ error: 'No active session with that code' });

  const viewerId = `viewer-${Math.random().toString(36).slice(2, 10)}`;
  await Viewer.create({ viewerId, roomId: room._id, displayName: displayName.trim() });

  res.status(201).json({
    viewerId,
    roomId: room._id,
    currentSlideId: room.currentSlideId
  });
}

// Read-only room status — used by a viewer's client on reconnect, and
// safe to expose without auth since it reveals nothing beyond what
// broadcast already shows the room.
export async function getRoomByCode(req, res) {
  const room = await Room.findOne({ code: req.params.code.toUpperCase(), active: true });
  if (!room) return res.status(404).json({ error: 'No active session with that code' });
  res.json({ code: room.code, active: room.active, currentSlideId: room.currentSlideId });
}

// Codes are reused once a room ends, so a code alone can match several
// rooms. Resolve the viewer first (viewerId is globally unique), then
// confirm their room carries this code. This keeps notes working for the
// right session, including after it ends and its code is handed out again.
async function findViewerInRoom(code, viewerId) {
  const viewer = await Viewer.findOne({ viewerId });
  if (!viewer) return null;
  const room = await Room.findById(viewer.roomId);
  if (!room || room.code !== code.toUpperCase()) return null;
  return viewer;
}

// No auth — same unauthenticated viewer path as join. Notes are private
// to the viewer that wrote them, scoped by viewerId + the slide they
// were written on (see Viewer.js), never exposed to the presenter or
// other viewers, and never queried across viewers.
export async function getViewerNotes(req, res) {
  const { code, viewerId } = req.params;

  const viewer = await findViewerInRoom(code, viewerId);
  if (!viewer) return res.status(404).json({ error: 'Viewer not found in this room' });

  res.json({ notes: viewer.notes });
}

// Upsert-by-slideId: one note per (viewer, slide) pair, matching the
// per-slide private notes described in the spec. Called on a debounce
// from the client as the viewer types, tied to whichever slide is
// currently pinned on their screen — not necessarily the presenter's
// live slide.
export async function saveViewerNote(req, res) {
  const { code, viewerId } = req.params;
  const { slideId, text } = req.body;
  if (!slideId) return res.status(400).json({ error: 'slideId is required' });

  const viewer = await findViewerInRoom(code, viewerId);
  if (!viewer) return res.status(404).json({ error: 'Viewer not found in this room' });

  const existing = viewer.notes.find((n) => n.slideId === slideId);
  if (existing) {
    existing.text = text ?? '';
    existing.updatedAt = new Date();
  } else {
    viewer.notes.push({ slideId, text: text ?? '', updatedAt: new Date() });
  }
  await viewer.save();

  res.json({ notes: viewer.notes });
}

// Editor-only: ends the live session.
export async function endRoom(req, res) {
  const room = await Room.findById(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.presenterId.toString() !== req.userId) {
    return res.status(403).json({ error: 'Only the presenter can end this session' });
  }
  room.active = false;
  room.endedAt = new Date();
  await room.save();

  // Ending a session is a REST action (not a socket event), but anyone
  // still connected to the broadcast — viewers watching, or the
  // presenter in a second tab — needs to hear about it in real time,
  // not just discover it next time they poll.
  const io = req.app.get('io');
  io?.to(`room:${room.code}`).emit('room:ended');

  res.status(204).end();
}

// Editor-only: returns past session history for a deck.
// Includes viewer names (from issue #19) and Q&A log per session.
export async function getSessionHistory(req, res) {
  const { deckId } = req.params;
  if (!mongoose.isValidObjectId(deckId)) return res.status(400).json({ error: 'Invalid deck id' });

  const deck = await Deck.findById(deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (!isEditorOf(deck, req.userId)) {
    return res.status(403).json({ error: 'Not a collaborator on this deck' });
  }

  const rooms = await Room.find({ deckId, active: false }).sort({ createdAt: -1 }).lean();

  const sessions = await Promise.all(
    rooms.map(async (room) => {
      const [viewers, questions] = await Promise.all([
        Viewer.find({ roomId: room._id })
          .select('displayName joinedAt')
          .sort({ joinedAt: 1 })
          .lean(),
        Question.find({ roomId: room._id })
          .select('text draftAnswer status createdAt')
          .sort({ createdAt: 1 })
          .lean()
      ]);

      // Rooms ended before endedAt existed fall back to the last question.
      const endedAt = room.endedAt ?? questions.at(-1)?.createdAt ?? room.createdAt;
      const durationMs = new Date(endedAt) - new Date(room.createdAt);
      const durationMin = Math.max(0, Math.round(durationMs / 60000));

      return {
        roomId: room._id,
        code: room.code,
        createdAt: room.createdAt,
        durationMin,
        viewerCount: viewers.length,
        viewers: viewers.map((v) => ({ name: v.displayName, joinedAt: v.joinedAt })),
        questions: questions.map((q) => ({
          id: q._id,
          text: q.text,
          // Only answers the presenter actually sent; unsent AI drafts stay private.
          answer: q.status === 'sent' ? q.draftAnswer : null,
          status: q.status
        }))
      };
    })
  );

  res.json({ sessions });
}