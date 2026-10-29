import Deck from '../models/Deck.js';
import Template from '../models/Template.js';
import { flushDoc } from '../yjs/docManager.js';
import { isEditorOf, thumbnailSlide } from './deckController.js';

// Saved templates are private to the user who saved them. Every handler
// assumes requireAuth has run.

export const MAX_TEMPLATES_PER_USER = 50;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 300;

const plainSlides = (slides) => slides.map((s) => (typeof s.toObject === 'function' ? s.toObject() : s));

function summary(t) {
  return {
    id: t._id.toString(),
    name: t.name,
    description: t.description || '',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    slideCount: (t.slides || []).length,
    thumbnail: thumbnailSlide(t.slides)
  };
}

export async function listTemplates(req, res) {
  const templates = await Template.find({ ownerId: req.userId }).sort({ updatedAt: -1 });
  res.json(templates.map(summary));
}

// Saves a deck the caller can edit as a new template, including live
// edits not yet written to the database.
export async function createTemplate(req, res) {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (name.length > MAX_NAME_LENGTH) return res.status(400).json({ error: `name must be ${MAX_NAME_LENGTH} characters or fewer` });
  if (description.length > MAX_DESCRIPTION_LENGTH) return res.status(400).json({ error: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` });
  if (typeof req.body.deckId !== 'string' || !/^[0-9a-f]{24}$/i.test(req.body.deckId)) return res.status(400).json({ error: 'deckId is required' });

  let deck = await Deck.findById(req.body.deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (!isEditorOf(deck, req.userId)) return res.status(403).json({ error: 'Not a collaborator on this deck' });

  const count = await Template.countDocuments({ ownerId: req.userId });
  if (count >= MAX_TEMPLATES_PER_USER) {
    return res.status(409).json({ error: `You can keep up to ${MAX_TEMPLATES_PER_USER} templates. Delete one to save another.` });
  }

  const flushed = await flushDoc(req.body.deckId);
  if (flushed) deck = (await Deck.findById(req.body.deckId)) || deck;
  if (!deck.slides.length) return res.status(400).json({ error: 'That presentation has no slides yet' });

  const template = await Template.create({
    ownerId: req.userId,
    name,
    description,
    sourceDeckId: deck._id,
    slides: plainSlides(deck.slides)
  });
  res.status(201).json(summary(template));
}

async function ownTemplate(req, res) {
  if (!/^[0-9a-f]{24}$/i.test(req.params.templateId)) {
    res.status(404).json({ error: 'Template not found' });
    return null;
  }
  const template = await Template.findById(req.params.templateId);
  // Someone else's template is reported as missing, not forbidden.
  if (!template || template.ownerId.toString() !== req.userId) {
    res.status(404).json({ error: 'Template not found' });
    return null;
  }
  return template;
}

export async function deleteTemplate(req, res) {
  const template = await ownTemplate(req, res);
  if (!template) return;
  await template.deleteOne();
  res.status(204).end();
}

// A new deck, owned by the caller, starting from the template's slides.
export async function createDeckFromTemplate(req, res) {
  const template = await ownTemplate(req, res);
  if (!template) return;
  const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 200) : template.name;
  const deck = await Deck.create({ title, ownerId: req.userId, slides: plainSlides(template.slides) });
  res.status(201).json({ id: deck._id.toString(), title: deck.title, slideCount: deck.slides.length });
}
