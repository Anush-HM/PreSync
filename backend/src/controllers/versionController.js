import { createHash } from 'crypto';
import Deck from '../models/Deck.js';
import DeckVersion from '../models/DeckVersion.js';
import { flushDoc } from '../yjs/docManager.js';
import { isEditorOf, thumbnailSlide } from './deckController.js';

// Version history: copies of a deck's slides that editors can preview
// and bring back. Restoring happens in the editor, through the live
// document, so it syncs to everyone and Undo can reverse it; the server
// keeps a 'restore' version of what was there first.

export const MAX_VERSIONS_PER_DECK = 100;
// A Save makes an automatic version at most this often.
export const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;
const MAX_LABEL_LENGTH = 120;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const plainSlides = (slides) => (slides || []).map((s) => (typeof s.toObject === 'function' ? s.toObject() : s));

export function slidesFingerprint(slides) {
  return createHash('sha256').update(JSON.stringify(plainSlides(slides))).digest('hex');
}

function summary(v) {
  const author = v.authorId && typeof v.authorId === 'object' && v.authorId._id ? v.authorId : null;
  return {
    id: v._id.toString(),
    label: v.label || '',
    kind: v.kind,
    title: v.title,
    createdAt: v.createdAt,
    slideCount: (v.slides || []).length,
    author: author ? { id: author._id.toString(), name: author.name, email: author.email } : null,
    thumbnail: thumbnailSlide(v.slides)
  };
}

async function editableDeck(req, res) {
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

// Drops the oldest automatic versions once a deck has too many; named
// ones are only dropped when there is nothing else left to drop.
async function prune(deckId) {
  const all = await DeckVersion.find({ deckId }).select('kind createdAt').sort({ createdAt: 1 });
  let extra = all.length - MAX_VERSIONS_PER_DECK;
  if (extra <= 0) return;
  const order = [...all.filter((v) => v.kind !== 'manual'), ...all.filter((v) => v.kind === 'manual')];
  for (const v of order) {
    if (extra <= 0) break;
    await DeckVersion.deleteOne({ _id: v._id });
    extra -= 1;
  }
}

// Saves the deck's current slides as a version. Returns the version, or
// null when `skipIfUnchanged` and the latest version already matches.
export async function snapshotDeck(deck, authorId, { label = '', kind = 'manual', skipIfUnchanged = false } = {}) {
  const fingerprint = slidesFingerprint(deck.slides);
  if (skipIfUnchanged) {
    const latest = await DeckVersion.findOne({ deckId: deck._id }).sort({ createdAt: -1 }).select('fingerprint');
    if (latest?.fingerprint === fingerprint) return null;
  }
  const version = await DeckVersion.create({
    deckId: deck._id, authorId, label, kind, title: deck.title, slides: plainSlides(deck.slides), fingerprint
  });
  await prune(deck._id);
  return version;
}

// Called by Save: a version when the last one is old enough and the
// slides have changed since.
export async function autoSnapshot(deck, authorId) {
  if (!deck.slides?.length) return null;
  const latest = await DeckVersion.findOne({ deckId: deck._id }).sort({ createdAt: -1 }).select('createdAt fingerprint');
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < AUTO_VERSION_INTERVAL_MS) return null;
  if (latest?.fingerprint === slidesFingerprint(deck.slides)) return null;
  return snapshotDeck(deck, authorId, { kind: 'auto' });
}

export async function listVersions(req, res) {
  const deck = await editableDeck(req, res);
  if (!deck) return;
  const versions = await DeckVersion.find({ deckId: deck._id })
    .sort({ createdAt: -1 })
    .populate({ path: 'authorId', select: 'email name' });
  res.json(versions.map(summary));
}

export async function createVersion(req, res) {
  let deck = await editableDeck(req, res);
  if (!deck) return;
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  if (label.length > MAX_LABEL_LENGTH) return res.status(400).json({ error: `label must be ${MAX_LABEL_LENGTH} characters or fewer` });
  const kind = req.body?.kind === 'restore' ? 'restore' : 'manual';
  if (await flushDoc(req.params.deckId)) deck = (await Deck.findById(req.params.deckId)) || deck;
  const version = await snapshotDeck(deck, req.userId, { label, kind });
  res.status(201).json(summary(version));
}

// One version with its slides, for previewing and restoring.
export async function getVersion(req, res) {
  const deck = await editableDeck(req, res);
  if (!deck) return;
  if (!OBJECT_ID.test(req.params.versionId)) return res.status(404).json({ error: 'Version not found' });
  const version = await DeckVersion.findById(req.params.versionId).populate({ path: 'authorId', select: 'email name' });
  if (!version || version.deckId.toString() !== deck._id.toString()) return res.status(404).json({ error: 'Version not found' });
  res.json({ ...summary(version), slides: plainSlides(version.slides) });
}

// Renames a version (or clears its name).
export async function updateVersion(req, res) {
  const deck = await editableDeck(req, res);
  if (!deck) return;
  if (!OBJECT_ID.test(req.params.versionId)) return res.status(404).json({ error: 'Version not found' });
  const version = await DeckVersion.findById(req.params.versionId);
  if (!version || version.deckId.toString() !== deck._id.toString()) return res.status(404).json({ error: 'Version not found' });
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  if (label.length > MAX_LABEL_LENGTH) return res.status(400).json({ error: `label must be ${MAX_LABEL_LENGTH} characters or fewer` });
  version.label = label;
  if (label && version.kind === 'auto') version.kind = 'manual';
  await version.save();
  res.json(summary(version));
}
