import Deck from '../models/Deck.js';
import User from '../models/User.js';
import { flushDoc } from '../yjs/docManager.js';

// Every handler here assumes requireAuth has already run — req.userId is
// a real editor. Access is scoped to decks the user owns or collaborates
// on; nothing here is reachable by a viewer, since viewers never carry a
// JWT in the first place.

export function isEditorOf(deck, userId) {
  return (
    deck.ownerId.toString() === userId ||
    deck.collaboratorIds.some((id) => id.toString() === userId)
  );
}

// Shapes a deck for the client with owner/collaborator emails resolved,
// instead of making the frontend guess at bare ObjectIds.
async function serializeDeck(deck, userId) {
  const populated = await deck.populate([
    { path: 'ownerId', select: 'email name' },
    { path: 'collaboratorIds', select: 'email name' }
  ]);
  const plain = populated.toObject();
  return {
    ...plain,
    id: plain._id.toString(),
    isOwner: plain.ownerId._id.toString() === userId,
    owner: { id: plain.ownerId._id, email: plain.ownerId.email, name: plain.ownerId.name },
    collaborators: plain.collaboratorIds.map((c) => ({ id: c._id, email: c.email, name: c.name })),
    // Include slides so the PresenterPage can render content without a
    // separate fetch — the presenter view is read-only so serving the
    // full slide array here is safe and keeps the client simpler.
    slides: plain.slides || [],
    slideCount: (plain.slides || []).length
  };
}

export async function listDecks(req, res) {
  const decks = await Deck.find({
    $or: [{ ownerId: req.userId }, { collaboratorIds: req.userId }]
  })
    .select('title updatedAt slides ownerId')
    .sort({ updatedAt: -1 });

  res.json(
    decks.map((d) => ({
      id: d._id,
      title: d.title,
      updatedAt: d.updatedAt,
      slideCount: d.slides.length,
      isOwner: d.ownerId.toString() === req.userId
    }))
  );
}

export async function createDeck(req, res) {
  const { title } = req.body;
  const deck = await Deck.create({
    title: title || 'Untitled deck',
    ownerId: req.userId,
    slides: []
  });
  res.status(201).json(deck);
}

export async function getDeck(req, res) {
  const deck = await Deck.findById(req.params.deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (!isEditorOf(deck, req.userId)) return res.status(403).json({ error: 'Not a collaborator on this deck' });
  res.json(await serializeDeck(deck, req.userId));
}

// Full-document replace of slides — the REST path for saving a deck.
// Live collaborative edits themselves flow through the Yjs layer, not
// this endpoint; this exists for periodic persistence and for clients
// that aren't holding a live Yjs connection (e.g. initial load).
export async function updateDeckSlides(req, res) {
  const deck = await Deck.findById(req.params.deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (!isEditorOf(deck, req.userId)) return res.status(403).json({ error: 'Not a collaborator on this deck' });

  deck.slides = req.body.slides;
  await deck.save();
  res.json(deck);
}

const MAX_TITLE_LENGTH = 200;

// Any editor can rename a deck.
export async function updateDeckMeta(req, res) {
  const deck = await Deck.findById(req.params.deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (!isEditorOf(deck, req.userId)) return res.status(403).json({ error: 'Not a collaborator on this deck' });

  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (title.length > MAX_TITLE_LENGTH) {
    return res.status(400).json({ error: `title must be ${MAX_TITLE_LENGTH} characters or fewer` });
  }

  deck.title = title;
  await deck.save();
  res.json(await serializeDeck(deck, req.userId));
}

// Explicit "Save now": flushes the live Yjs doc (if anyone is editing)
// to Mongo immediately rather than waiting for the debounced persist.
export async function saveDeck(req, res) {
  const deck = await Deck.findById(req.params.deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (!isEditorOf(deck, req.userId)) return res.status(403).json({ error: 'Not a collaborator on this deck' });

  const flushed = await flushDoc(req.params.deckId);
  res.json({ savedAt: new Date().toISOString(), flushed });
}

// Owner-only: invite another user to co-edit this deck by email. This is
// the piece that was missing — collaboratorIds existed on the model and
// was already checked everywhere, but nothing could ever populate it.
export async function addCollaborator(req, res) {
  const deck = await Deck.findById(req.params.deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (deck.ownerId.toString() !== req.userId) {
    return res.status(403).json({ error: 'Only the owner can invite collaborators' });
  }

  const email = req.body.email?.trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email is required' });

  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'No PreSync account with that email' });

  if (user._id.toString() === deck.ownerId.toString()) {
    return res.status(400).json({ error: "That's already the deck owner" });
  }
  if (deck.collaboratorIds.some((id) => id.toString() === user._id.toString())) {
    return res.status(400).json({ error: 'Already a collaborator on this deck' });
  }

  deck.collaboratorIds.push(user._id);
  await deck.save();
  res.status(201).json(await serializeDeck(deck, req.userId));
}

export async function removeCollaborator(req, res) {
  const deck = await Deck.findById(req.params.deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (deck.ownerId.toString() !== req.userId) {
    return res.status(403).json({ error: 'Only the owner can remove collaborators' });
  }

  deck.collaboratorIds = deck.collaboratorIds.filter(
    (id) => id.toString() !== req.params.userId
  );
  await deck.save();
  res.json(await serializeDeck(deck, req.userId));
}

export async function deleteDeck(req, res) {
  const deck = await Deck.findById(req.params.deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (deck.ownerId.toString() !== req.userId) {
    return res.status(403).json({ error: 'Only the owner can delete this deck' });
  }
  await deck.deleteOne();
  res.status(204).end();
}