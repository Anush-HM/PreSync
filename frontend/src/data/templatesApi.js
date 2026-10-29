import { apiFetch } from './apiConfig.js';
import { buildTemplateSlides } from './templates.js';

// The signed-in user's saved templates: [{ id, name, description,
// slideCount, thumbnail, createdAt, updatedAt }].
export async function listTemplates() {
  return apiFetch('/api/templates');
}

// Saves a deck the user can edit as one of their templates.
export async function saveDeckAsTemplate(deckId, name, description = '') {
  return apiFetch('/api/templates', {
    method: 'POST',
    body: JSON.stringify({ deckId, name, description })
  });
}

export async function deleteTemplate(templateId) {
  return apiFetch(`/api/templates/${templateId}`, { method: 'DELETE' });
}

// Resolves to { id, title, slideCount } of the new deck.
export async function createDeckFromTemplate(templateId, title) {
  return apiFetch(`/api/templates/${templateId}/decks`, {
    method: 'POST',
    body: JSON.stringify(title ? { title } : {})
  });
}

// A new deck from one of the built-in starter templates.
export async function createDeckFromStarter(template, title) {
  const deck = await apiFetch('/api/decks', {
    method: 'POST',
    body: JSON.stringify({ title: title || template.name, slides: buildTemplateSlides(template) })
  });
  return { id: String(deck._id || deck.id), title: deck.title };
}
