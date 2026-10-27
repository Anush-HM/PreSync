import mongoose from 'mongoose';
import Deck from '../models/Deck.js';
import AiConversation from '../models/AiConversation.js';
import { isEditorOf } from './deckController.js';
import { getAiConfig, publicStatus } from '../ai/config.js';
import { getProvider } from '../ai/providers/index.js';
import { contextLabel, LIMITS, sanitizeContext } from '../ai/context.js';
import { buildMessages, SYSTEM_PROMPT } from '../ai/prompts.js';
import { RESPONSE_SCHEMA, validateResponse } from '../ai/actions.js';
import { AiError, sendAiError } from '../ai/errors.js';

// Copilot routes. Every handler runs after requireAuth; access to a deck
// follows the deck routes (owner or collaborator), and conversations are
// further limited to the user who had them. Nothing here writes to the
// deck itself: proposed changes go back to the editor, which applies
// them through its own collaborative operations once the user agrees.

const MODES = ['chat', 'outline'];
const MAX_STORED_MESSAGES = 200;
const ACTION_STATUSES = ['applied', 'dismissed', 'undone'];

async function editableDeck(req) {
  const { deckId } = req.params;
  if (!mongoose.isValidObjectId(deckId)) throw new AiError('NOT_FOUND', 404, 'Deck not found');
  const deck = await Deck.findById(deckId).select('title ownerId collaboratorIds');
  if (!deck) throw new AiError('NOT_FOUND', 404, 'Deck not found');
  if (!isEditorOf(deck, req.userId)) throw new AiError('FORBIDDEN', 403, 'You do not have access to this deck');
  return deck;
}

// A conversation the requester owns, on a deck they can still edit.
async function ownConversation(req) {
  const { conversationId } = req.params;
  if (!mongoose.isValidObjectId(conversationId)) throw new AiError('NOT_FOUND', 404, 'Conversation not found');
  const convo = await AiConversation.findById(conversationId);
  if (!convo || convo.userId.toString() !== req.userId) throw new AiError('NOT_FOUND', 404, 'Conversation not found');
  const deck = await Deck.findById(convo.deckId).select('ownerId collaboratorIds');
  if (!deck || !isEditorOf(deck, req.userId)) throw new AiError('FORBIDDEN', 403, 'You no longer have access to this deck');
  return convo;
}

function serializeMessage(m) {
  return {
    id: m._id?.toString(),
    role: m.role,
    content: m.content,
    mode: m.mode,
    contextLabel: m.contextLabel,
    grounding: m.grounding,
    slideRefs: m.slideRefs || [],
    actions: (m.actions || []).map((a) => ({ ...(a.payload || {}), type: a.type, summary: a.summary, status: a.status })),
    createdAt: m.createdAt
  };
}

function summarize(convo, { withMessages = false } = {}) {
  return {
    id: convo._id.toString(),
    deckId: convo.deckId.toString(),
    title: convo.title,
    updatedAt: convo.updatedAt,
    messageCount: convo.messages.length,
    ...(withMessages && { messages: convo.messages.map(serializeMessage) })
  };
}

function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof AiError) return sendAiError(res, err);
      next(err);
    }
  };
}

export const getStatus = handle(async (req, res) => {
  res.json(publicStatus(getAiConfig()));
});

export const listConversations = handle(async (req, res) => {
  const deck = await editableDeck(req);
  if (!getAiConfig().storeHistory) return res.json([]);
  const convos = await AiConversation.find({ deckId: deck._id, userId: req.userId }).sort({ updatedAt: -1 }).limit(50);
  res.json(convos.map((c) => summarize(c)));
});

export const createConversation = handle(async (req, res) => {
  const deck = await editableDeck(req);
  if (!getAiConfig().storeHistory) throw new AiError('HISTORY_DISABLED', 409, 'Conversation history is turned off on this server');
  const convo = await AiConversation.create({ deckId: deck._id, userId: req.userId });
  res.status(201).json(summarize(convo, { withMessages: true }));
});

export const clearConversations = handle(async (req, res) => {
  const deck = await editableDeck(req);
  await AiConversation.deleteMany({ deckId: deck._id, userId: req.userId });
  res.status(204).end();
});

export const getConversation = handle(async (req, res) => {
  const convo = await ownConversation(req);
  res.json(summarize(convo, { withMessages: true }));
});

export const deleteConversation = handle(async (req, res) => {
  const convo = await ownConversation(req);
  await convo.deleteOne();
  res.status(204).end();
});

// Records what the user did with a proposed action, so history shows
// which suggestions were applied.
export const updateActionStatus = handle(async (req, res) => {
  const convo = await ownConversation(req);
  const { status } = req.body || {};
  if (!ACTION_STATUSES.includes(status)) throw new AiError('INVALID', 400, `status must be one of ${ACTION_STATUSES.join(', ')}`);
  const message = convo.messages.id(req.params.messageId);
  const index = Number.parseInt(req.params.index, 10);
  const action = message?.actions?.[index];
  if (!action) throw new AiError('NOT_FOUND', 404, 'Action not found');
  action.status = status;
  convo.markModified('messages');
  await convo.save();
  res.json(serializeMessage(message));
});

function sanitizeBrief(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const count = Number.parseInt(raw.slideCount, 10);
  return {
    topic: s(raw.topic, 300),
    audience: s(raw.audience, 200),
    purpose: s(raw.purpose, 300),
    slideCount: Number.isFinite(count) ? Math.min(30, Math.max(1, count)) : null,
    tone: s(raw.tone, 60),
    style: s(raw.style, 120)
  };
}

function clientHistory(raw) {
  return (Array.isArray(raw) ? raw : [])
    .slice(-LIMITS.history)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 4000),
      actions: (Array.isArray(m.actions) ? m.actions : []).slice(0, 6).map((a) => ({ type: String(a?.type || ''), summary: String(a?.summary || '').slice(0, 300), status: a?.status }))
    }));
}

export const assist = handle(async (req, res) => {
  const config = getAiConfig();
  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const mode = MODES.includes(body.mode) ? body.mode : 'chat';
  const brief = mode === 'outline' ? sanitizeBrief(body.brief) : null;

  if (mode === 'outline' && !brief?.topic) throw new AiError('INVALID', 400, 'Give the presentation a topic');
  if (!message && mode !== 'outline') throw new AiError('INVALID', 400, 'Type a request for the Copilot');
  if (message.length > LIMITS.message) throw new AiError('INVALID', 400, `Keep requests under ${LIMITS.message} characters`);

  const provider = getProvider(config);
  if (!provider) throw new AiError('AI_NOT_CONFIGURED', 503, publicStatus(config).setup || 'AI Copilot is not configured on this server');
  // Document content only leaves the server after the user has seen
  // which provider receives it (the panel's disclosure).
  if (body.dataConsent !== true) throw new AiError('CONSENT_REQUIRED', 400, 'Confirm that PreSync may send this content to the AI provider');

  const deck = await editableDeck(req);

  let convo = null;
  if (config.storeHistory && body.conversationId) {
    req.params.conversationId = body.conversationId;
    convo = await ownConversation(req);
    if (convo.deckId.toString() !== deck._id.toString()) throw new AiError('NOT_FOUND', 404, 'Conversation not found');
  }

  const context = sanitizeContext(body.context);
  context.deckTitle = context.deckTitle || deck.title;
  const history = convo ? convo.messages.slice(-LIMITS.history) : config.storeHistory ? [] : clientHistory(body.history);
  const userText = message || `Create a presentation outline about: ${brief.topic}`;

  const { json, model } = await provider.generateJson({
    system: SYSTEM_PROMPT,
    messages: buildMessages({ context, history, message: userText, mode, brief }),
    schema: RESPONSE_SCHEMA
  });
  const result = validateResponse(json, context);

  const label = mode === 'outline' ? 'New presentation outline' : contextLabel(context);
  const userMessage = { role: 'user', content: userText, mode, contextLabel: label, createdAt: new Date() };
  const assistantMessage = {
    role: 'assistant',
    content: result.reply,
    grounding: result.grounding,
    slideRefs: result.slideRefs,
    actions: result.actions.map(({ type, summary, ...payload }) => ({ type, summary, payload, status: 'proposed' })),
    model,
    createdAt: new Date()
  };

  if (!config.storeHistory) {
    return res.json({
      conversation: null,
      userMessage: serializeMessage(userMessage),
      assistantMessage: serializeMessage(assistantMessage),
      rejectedActions: result.rejected.length
    });
  }

  if (!convo) convo = new AiConversation({ deckId: deck._id, userId: req.userId, title: userText.replace(/\s+/g, ' ').slice(0, 80) });
  else if (convo.messages.length === 0) convo.title = userText.replace(/\s+/g, ' ').slice(0, 80);
  convo.messages.push(userMessage, assistantMessage);
  if (convo.messages.length > MAX_STORED_MESSAGES) convo.messages.splice(0, convo.messages.length - MAX_STORED_MESSAGES);
  await convo.save();

  const saved = convo.messages.slice(-2);
  res.json({
    conversation: summarize(convo),
    userMessage: serializeMessage(saved[0]),
    assistantMessage: serializeMessage(saved[1]),
    rejectedActions: result.rejected.length
  });
});
