import Deck from '../models/Deck.js';
import Room from '../models/Room.js';
import Viewer from '../models/Viewer.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid ambiguity

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

  // Retry on the rare collision against an active room with the same code.
  let code;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateCode();
    const clash = await Room.findOne({ code, active: true });
    if (!clash) break;
  }

  const room = await Room.create({
    code,
    deckId: deck._id,
    presenterId: req.userId,
    currentSlideId: deck.slides[0]?.id
  });

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

// No auth — same unauthenticated viewer path as join. Notes are private
// to the viewer that wrote them, scoped by viewerId + the slide they
// were written on (see Viewer.js), never exposed to the presenter or
// other viewers, and never queried across viewers.
export async function getViewerNotes(req, res) {
  const { code, viewerId } = req.params;

  const room = await Room.findOne({ code: code.toUpperCase() });
  if (!room) return res.status(404).json({ error: 'No session with that code' });

  const viewer = await Viewer.findOne({ viewerId, roomId: room._id });
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

  const room = await Room.findOne({ code: code.toUpperCase() });
  if (!room) return res.status(404).json({ error: 'No session with that code' });

  const viewer = await Viewer.findOne({ viewerId, roomId: room._id });
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
  await room.save();
  res.status(204).end();
}