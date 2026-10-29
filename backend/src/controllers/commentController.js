import { randomUUID } from 'crypto';
import Deck from '../models/Deck.js';
import Comment from '../models/Comment.js';
import { isEditorOf } from './deckController.js';

// Comment threads on a deck's slides. Any editor can read, add, reply
// and resolve; only the author can edit their text; the author or the
// deck's owner can delete a thread.

const MAX_TEXT = 2000;
const MAX_REPLIES = 200;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const PEOPLE = ['authorId', 'replies.authorId', 'resolvedBy'].map((path) => ({ path, select: 'email name' }));

function person(ref) {
  return ref && typeof ref === 'object' && ref._id ? { id: ref._id.toString(), name: ref.name, email: ref.email } : null;
}

function shape(c) {
  return {
    id: c._id.toString(),
    slideId: c.slideId,
    blockId: c.blockId || null,
    text: c.text,
    author: person(c.authorId),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    resolved: !!c.resolved,
    resolvedBy: person(c.resolvedBy),
    resolvedAt: c.resolvedAt || null,
    replies: (c.replies || []).map((r) => ({ id: r.id, text: r.text, author: person(r.authorId), createdAt: r.createdAt }))
  };
}

const cleanText = (v) => (typeof v === 'string' ? v.trim() : '');

async function access(req, res) {
  if (!OBJECT_ID.test(req.params.deckId)) {
    res.status(404).json({ error: 'Deck not found' });
    return null;
  }
  const deck = await Deck.findById(req.params.deckId);
  if (!deck) {
    res.status(404).json({ error: 'Deck not found' });
    return null;
  }
  if (!isEditorOf(deck, req.userId)) {
    res.status(403).json({ error: 'Not a collaborator on this deck' });
    return null;
  }
  return deck;
}

async function thread(req, res, deck) {
  if (!OBJECT_ID.test(req.params.commentId)) {
    res.status(404).json({ error: 'Comment not found' });
    return null;
  }
  const c = await Comment.findById(req.params.commentId);
  if (!c || c.deckId.toString() !== deck._id.toString()) {
    res.status(404).json({ error: 'Comment not found' });
    return null;
  }
  return c;
}

async function send(res, c, status = 200) {
  await c.populate(PEOPLE);
  res.status(status).json(shape(c));
}

export async function listComments(req, res) {
  const deck = await access(req, res);
  if (!deck) return;
  const comments = await Comment.find({ deckId: deck._id }).sort({ createdAt: 1 }).populate(PEOPLE);
  res.json(comments.map(shape));
}

export async function createComment(req, res) {
  const deck = await access(req, res);
  if (!deck) return;
  const text = cleanText(req.body?.text);
  const slideId = typeof req.body?.slideId === 'string' ? req.body.slideId : '';
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > MAX_TEXT) return res.status(400).json({ error: `text must be ${MAX_TEXT} characters or fewer` });
  if (!slideId || !deck.slides.some((s) => s.id === slideId)) {
    // The live document may hold a slide that isn't saved yet; accept any
    // reasonable id rather than racing the autosave.
    if (!/^[\w-]{1,80}$/.test(slideId)) return res.status(400).json({ error: 'slideId is required' });
  }
  const blockId = typeof req.body?.blockId === 'string' && /^[\w-]{1,80}$/.test(req.body.blockId) ? req.body.blockId : undefined;
  const c = await Comment.create({ deckId: deck._id, slideId, blockId, authorId: req.userId, text });
  await send(res, c, 201);
}

export async function replyToComment(req, res) {
  const deck = await access(req, res);
  if (!deck) return;
  const c = await thread(req, res, deck);
  if (!c) return;
  const text = cleanText(req.body?.text);
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > MAX_TEXT) return res.status(400).json({ error: `text must be ${MAX_TEXT} characters or fewer` });
  if (c.replies.length >= MAX_REPLIES) return res.status(409).json({ error: 'This thread has too many replies' });
  c.replies.push({ id: randomUUID(), authorId: req.userId, text, createdAt: new Date() });
  // Replying to a resolved thread opens it again.
  if (c.resolved) {
    c.resolved = false;
    c.resolvedBy = undefined;
    c.resolvedAt = undefined;
  }
  await c.save();
  await send(res, c, 201);
}

// { resolved } from any editor; { text } from the author only.
export async function updateComment(req, res) {
  const deck = await access(req, res);
  if (!deck) return;
  const c = await thread(req, res, deck);
  if (!c) return;
  if (req.body?.text !== undefined) {
    if (c.authorId.toString() !== req.userId) return res.status(403).json({ error: 'Only the author can edit a comment' });
    const text = cleanText(req.body.text);
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: `text must be ${MAX_TEXT} characters or fewer` });
    c.text = text;
  }
  if (typeof req.body?.resolved === 'boolean') {
    c.resolved = req.body.resolved;
    c.resolvedBy = req.body.resolved ? req.userId : undefined;
    c.resolvedAt = req.body.resolved ? new Date() : undefined;
  }
  await c.save();
  await send(res, c);
}

export async function deleteComment(req, res) {
  const deck = await access(req, res);
  if (!deck) return;
  const c = await thread(req, res, deck);
  if (!c) return;
  if (c.authorId.toString() !== req.userId && deck.ownerId.toString() !== req.userId) {
    return res.status(403).json({ error: 'Only the author or the owner can delete a comment' });
  }
  await c.deleteOne();
  res.status(204).end();
}
