import Deck from '../models/Deck.js';
import User from '../models/User.js';
import AiConversation from '../models/AiConversation.js';
import DeckVersion from '../models/DeckVersion.js';
import Comment from '../models/Comment.js';
import { autoSnapshot } from './versionController.js';
import { flushDoc } from '../yjs/docManager.js';

// Every handler here assumes requireAuth has already run — req.userId is
// a real editor. Access is scoped to decks the user owns or collaborates
// on; nothing here is reachable by a viewer, since viewers never carry a
// JWT in the first place.

const MAX_TITLE_LENGTH = 200;

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

// Data URLs above this size are left out of list thumbnails so the
// dashboard payload stays small; the card shows a placeholder instead.
const THUMB_MAX_IMAGE_CHARS = 200_000;

function personOf(ref) {
  if (!ref || !ref._id) return null;
  return { id: ref._id.toString(), name: ref.name, email: ref.email };
}

function idOf(ref) {
  return (ref?._id ?? ref).toString();
}

// The first slide, trimmed for use as a dashboard thumbnail.
export function thumbnailSlide(slides) {
  if (!slides?.length) return null;
  const plain = slides.map((s) => (typeof s.toObject === 'function' ? s.toObject() : s));
  const first = [...plain].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
  const trimImage = (url) => (url && url.length > THUMB_MAX_IMAGE_CHARS ? undefined : url);
  return {
    id: first.id,
    backgroundColor: first.backgroundColor,
    backgroundGradient: first.backgroundGradient,
    backgroundRepeat: first.backgroundRepeat,
    backgroundImageUrl: trimImage(first.backgroundImageUrl),
    blocks: (first.blocks || []).map((b) => {
      if (b.type !== 'image') return b;
      const imageUrl = trimImage(b.imageUrl);
      return imageUrl ? b : { ...b, imageUrl: undefined, imageOmitted: true };
    })
  };
}

export async function listDecks(req, res) {
  const decks = await Deck.find({
    $or: [{ ownerId: req.userId }, { collaboratorIds: req.userId }]
  })
    .select('title createdAt updatedAt slides ownerId collaboratorIds canvasWidth canvasHeight')
    .sort({ updatedAt: -1 })
    .populate([
      { path: 'ownerId', select: 'email name' },
      { path: 'collaboratorIds', select: 'email name' }
    ]);

  res.json(
    decks.map((d) => ({
      id: d._id,
      title: d.title,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      slideCount: d.slides.length,
      isOwner: idOf(d.ownerId) === req.userId,
      owner: personOf(d.ownerId),
      collaborators: (d.collaboratorIds || []).map(personOf).filter(Boolean),
      thumbnail: thumbnailSlide(d.slides),
      canvasWidth: d.canvasWidth,
      canvasHeight: d.canvasHeight
    }))
  );
}

const COPY_SUFFIX = ' (copy)';

// Any editor can duplicate a deck; the copy belongs to whoever made it
// and starts with no collaborators. Live edits are flushed first so the
// copy matches what editors currently see.
export async function duplicateDeck(req, res) {
  let deck = await Deck.findById(req.params.deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (!isEditorOf(deck, req.userId)) return res.status(403).json({ error: 'Not a collaborator on this deck' });

  const flushed = await flushDoc(req.params.deckId);
  if (flushed) deck = (await Deck.findById(req.params.deckId)) || deck;

  const slides = deck.slides.map((s) => (typeof s.toObject === 'function' ? s.toObject() : s));
  const title = `${deck.title.slice(0, MAX_TITLE_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
  const copy = await Deck.create({ title, ownerId: req.userId, slides, canvasWidth: deck.canvasWidth, canvasHeight: deck.canvasHeight });

  res.status(201).json({
    id: copy._id,
    title: copy.title,
    slideCount: copy.slides.length
  });
}

// Starter templates (frontend/src/data/templates.js) send their slides
// with the new deck; anything else starts empty.
export const MAX_CREATE_SLIDES = 60;

export async function createDeck(req, res) {
  const { title, slides, width, height } = req.body;
  if (slides !== undefined && (!Array.isArray(slides) || slides.length > MAX_CREATE_SLIDES || slides.some((s) => !s || typeof s !== 'object'))) {
    return res.status(400).json({ error: `slides must be a list of at most ${MAX_CREATE_SLIDES} slides` });
  }
  const name = typeof title === 'string' ? title.trim().slice(0, MAX_TITLE_LENGTH) : '';
  const canvasWidth  = Number.isFinite(Number(width))  && Number(width)  > 0 ? Number(width)  : 960;
  const canvasHeight = Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : 540;
  const deck = await Deck.create({
    title: name || 'Untitled deck',
    ownerId: req.userId,
    slides: slides || [],
    canvasWidth,
    canvasHeight
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
  // Save also keeps an automatic version now and then.
  const saved = flushed ? (await Deck.findById(req.params.deckId)) || deck : deck;
  const version = await autoSnapshot(saved, req.userId);
  res.json({ savedAt: new Date().toISOString(), flushed, versionId: version ? version._id.toString() : null });
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
  // Copilot conversations, versions and comments go with the deck.
  await Promise.all([
    AiConversation.deleteMany({ deckId: deck._id }),
    DeckVersion.deleteMany({ deckId: deck._id }),
    Comment.deleteMany({ deckId: deck._id })
  ]);
  res.status(204).end();
}
