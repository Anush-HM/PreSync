import { createServer } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Server } from 'socket.io';
import { io as connectClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';

// End-to-end Q&A draft flow over real sockets with the real qaService.
// Only the database models and the Anthropic HTTP call are faked.
vi.mock('../models/Room.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/Deck.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../models/Question.js', () => ({
  default: { create: vi.fn(), findById: vi.fn(), findOne: vi.fn() }
}));

const { default: Room } = await import('../models/Room.js');
const { default: Deck } = await import('../models/Deck.js');
const { default: Question } = await import('../models/Question.js');
const { registerSocketHandlers } = await import('./index.js');

const PRESENTER_ID = '64b000000000000000000001';
const ROOM_ID = '64b0000000000000000000a1';
const QUESTION_ID = '64b000000000000000000002';

const deck = {
  slides: [{ id: 's1', order: 0, blocks: [{ text: 'Revenue grew 20% in Q3' }] }]
};

let httpServer;
let url;
let fetchMock;
let question;
const clients = [];

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  httpServer = createServer();
  registerSocketHandlers(new Server(httpServer));
  await new Promise((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${httpServer.address().port}`;
});

afterAll(() => new Promise((resolve) => httpServer.close(resolve)));

beforeEach(() => {
  // Only the Anthropic call is stubbed; socket.io-client in Node uses
  // its own transport, not global fetch.
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');

  Room.findOne.mockResolvedValue({
    _id: ROOM_ID,
    code: 'ABC123',
    deckId: 'deck1',
    presenterId: PRESENTER_ID,
    currentSlideId: 's1'
  });
  Deck.findById.mockResolvedValue(deck);
  Question.create.mockImplementation(async (doc) => {
    question = { _id: QUESTION_ID, status: 'pending', ...doc, save: vi.fn().mockResolvedValue(undefined) };
    return question;
  });
  // question:send looks the question up by id today; scoping it to the
  // room (findOne) is in flight, so either lookup finds it here.
  Question.findById.mockImplementation(async () => question);
  Question.findOne.mockImplementation(async () => question);
});

afterEach(() => {
  while (clients.length) clients.pop().disconnect();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  question = undefined;
});

async function connect() {
  const socket = connectClient(url, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

function nextEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for '${event}'`)), 2000);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function joinRoom() {
  const presenter = await connect();
  const presenterJoined = nextEvent(presenter, 'presenter:joined');
  presenter.emit('presenter:join', { token: jwt.sign({ sub: PRESENTER_ID }, 'test-secret'), code: 'ABC123' });
  await presenterJoined;

  const viewer = await connect();
  const viewerJoined = nextEvent(viewer, 'viewer:joined');
  viewer.emit('viewer:join', { code: 'ABC123', viewerId: 'viewer-1' });
  await viewerJoined;

  const bystander = await connect();
  const bystanderJoined = nextEvent(bystander, 'viewer:joined');
  bystander.emit('viewer:join', { code: 'ABC123', viewerId: 'viewer-2' });
  await bystanderJoined;

  return { presenter, viewer, bystander };
}

function anthropicReply(text) {
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) };
}

describe('Q&A draft flow', () => {
  it('drafts an answer from the current slide and shows it only to the presenter', async () => {
    fetchMock.mockResolvedValue(anthropicReply('Revenue grew 20% in Q3.'));
    const { presenter, viewer, bystander } = await joinRoom();
    const leaked = vi.fn();
    viewer.on('question:drafted', leaked);
    bystander.on('question:drafted', leaked);
    bystander.on('question:new', leaked);

    const asked = nextEvent(presenter, 'question:new');
    const drafted = nextEvent(presenter, 'question:drafted');
    viewer.emit('question:submit', { text: 'How much did revenue grow?' });

    expect(await asked).toEqual({ id: QUESTION_ID, text: 'How much did revenue grow?', status: 'pending' });
    expect(await drafted).toEqual({ id: QUESTION_ID, draftAnswer: 'Revenue grew 20% in Q3.' });

    expect(Question.create).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      viewerId: 'viewer-1',
      slideId: 's1',
      text: 'How much did revenue grow?'
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toContain(
      'Revenue grew 20% in Q3'
    );
    expect(question.status).toBe('drafted');
    expect(question.draftAnswer).toBe('Revenue grew 20% in Q3.');
    expect(question.save).toHaveBeenCalled();
    expect(leaked).not.toHaveBeenCalled();
  });

  it('reports a failed draft to the presenter without saving one', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { presenter, viewer } = await joinRoom();

    const failed = nextEvent(presenter, 'question:draft-failed');
    viewer.emit('question:submit', { text: 'How much did revenue grow?' });

    expect(await failed).toEqual({ id: QUESTION_ID, error: 'Anthropic API error: 500' });
    expect(question.status).toBe('pending');
    expect(question.save).not.toHaveBeenCalled();
  });

  it('broadcasts the answer to the room only when the presenter sends it, with their edits', async () => {
    fetchMock.mockResolvedValue(anthropicReply('Revenue grew 20% in Q3.'));
    const { presenter, viewer, bystander } = await joinRoom();

    const drafted = nextEvent(presenter, 'question:drafted');
    viewer.emit('question:submit', { text: 'How much did revenue grow?' });
    await drafted;

    const viewerAnswer = nextEvent(viewer, 'qa:answer');
    const bystanderAnswer = nextEvent(bystander, 'qa:answer');
    presenter.emit('question:send', { questionId: QUESTION_ID, answer: 'About 20%, mostly EMEA.' });

    const expected = { id: QUESTION_ID, question: 'How much did revenue grow?', answer: 'About 20%, mostly EMEA.' };
    expect(await viewerAnswer).toEqual(expected);
    expect(await bystanderAnswer).toEqual(expected);
    expect(question.status).toBe('sent');
  });
});
