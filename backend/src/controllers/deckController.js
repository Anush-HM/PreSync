import Deck from '../models/Deck.js';

// Every handler here assumes requireAuth has already run — req.userId is
// a real editor. Access is scoped to decks the user owns or collaborates
// on; nothing here is reachable by a viewer, since viewers never carry a
// JWT in the first place.

function isEditorOf(deck, userId) {
  return (
    deck.ownerId.toString() === userId ||
    deck.collaboratorIds.some((id) => id.toString() === userId)
  );
}

export async function listDecks(req, res) {
  const decks = await Deck.find({
    $or: [{ ownerId: req.userId }, { collaboratorIds: req.userId }]
  })
    .select('title updatedAt slides')
    .sort({ updatedAt: -1 });

  res.json(
    decks.map((d) => ({
      id: d._id,
      title: d.title,
      updatedAt: d.updatedAt,
      slideCount: d.slides.length
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
  res.json(deck);
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

export async function deleteDeck(req, res) {
  const deck = await Deck.findById(req.params.deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (deck.ownerId.toString() !== req.userId) {
    return res.status(403).json({ error: 'Only the owner can delete this deck' });
  }
  await deck.deleteOne();
  res.status(204).end();
}