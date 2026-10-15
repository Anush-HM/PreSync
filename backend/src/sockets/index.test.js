import { createServer } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Server } from 'socket.io';
import { io as connectClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';

vi.mock('../models/Room.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/Deck.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../models/Question.js', () => ({
  default: { create: vi.fn(), findById: vi.fn(), findByIdAndUpdate: vi.fn() }
}));
vi.mock('../services/qaService.js', () => ({ draftAnswer: vi.fn() }));

const { default: Room } = await import('../models/Room.js');
const { default: Question } = await import('../models/Question.js');
const { registerSocketHandlers } = await import('./index.js');

const PRESENTER_ID = '64b000000000000000000001';
const QUESTION_ID = '64b000000000000000000002';

let httpServer;
let url;
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
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Room.findOne.mockResolvedValue({
    _id: 'room1',
    code: 'ABC123',
    deckId: 'deck1',
    presenterId: PRESENTER_ID,
    currentSlideId: null
  });
});

afterEach(() => {
  while (clients.length) clients.pop().disconnect();
  vi.clearAllMocks();
  vi.restoreAllMocks();
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

async function emitExpectingError(socket, event, ...args) {
  const error = nextEvent(socket, 'error');
  socket.emit(event, ...args);
  return (await error).message;
}

async function joinAsViewer() {
  const socket = await connect();
  const joined = nextEvent(socket, 'viewer:joined');
  socket.emit('viewer:join', { code: 'abc123', viewerId: 'viewer-1' });
  await joined;
  return socket;
}

async function joinAsPresenter() {
  const socket = await connect();
  const token = jwt.sign({ sub: PRESENTER_ID }, process.env.JWT_SECRET);
  const joined = nextEvent(socket, 'presenter:joined');
  socket.emit('presenter:join', { token, code: 'abc123' });
  await joined;
  return socket;
}

describe('viewer:join', () => {
  it('rejects a join with no payload', async () => {
    const socket = await connect();
    expect(await emitExpectingError(socket, 'viewer:join')).toBe('Invalid request');
    expect(Room.findOne).not.toHaveBeenCalled();
  });

  it('rejects a join without a code', async () => {
    const socket = await connect();
    expect(await emitExpectingError(socket, 'viewer:join', { viewerId: 'v1' })).toBe(
      'Session code is required'
    );
  });

  it('rejects a code that is not a string, so it never reaches the query', async () => {
    const socket = await connect();
    const message = await emitExpectingError(socket, 'viewer:join', {
      code: { $ne: null },
      viewerId: 'v1'
    });
    expect(message).toBe('Session code is required');
    expect(Room.findOne).not.toHaveBeenCalled();
  });

  it('rejects a join without a viewer id', async () => {
    const socket = await connect();
    expect(await emitExpectingError(socket, 'viewer:join', { code: 'ABC123' })).toBe(
      'Viewer id is required'
    );
  });

  it('joins with a valid code and viewer id', async () => {
    const socket = await joinAsViewer();
    expect(socket.connected).toBe(true);
    expect(Room.findOne).toHaveBeenCalledWith({ code: 'ABC123', active: true });
  });

  it('reports a database failure instead of crashing', async () => {
    Room.findOne.mockRejectedValueOnce(new Error('connection lost'));
    const socket = await connect();
    const message = await emitExpectingError(socket, 'viewer:join', {
      code: 'ABC123',
      viewerId: 'v1'
    });
    expect(message).toBe('Something went wrong');
  });
});

describe('presenter:join', () => {
  it('rejects a join without a code', async () => {
    const socket = await connect();
    const token = jwt.sign({ sub: PRESENTER_ID }, process.env.JWT_SECRET);
    expect(await emitExpectingError(socket, 'presenter:join', { token })).toBe(
      'Session code is required'
    );
  });

  it('rejects a missing or bad token', async () => {
    const socket = await connect();
    expect(await emitExpectingError(socket, 'presenter:join', { code: 'ABC123' })).toBe(
      'Invalid presenter token'
    );
    expect(
      await emitExpectingError(socket, 'presenter:join', { code: 'ABC123', token: 'nope' })
    ).toBe('Invalid presenter token');
  });

  it('joins with a valid token for the room presenter', async () => {
    const socket = await joinAsPresenter();
    expect(socket.connected).toBe(true);
  });
});

describe('question:submit', () => {
  it('rejects a question over 500 characters without touching the database', async () => {
    const socket = await joinAsViewer();
    const message = await emitExpectingError(socket, 'question:submit', { text: 'x'.repeat(501) });
    expect(message).toBe('Question must be 500 characters or fewer');
    expect(Question.create).not.toHaveBeenCalled();
  });

  it('rejects an empty or missing question', async () => {
    const socket = await joinAsViewer();
    expect(await emitExpectingError(socket, 'question:submit', { text: '   ' })).toBe(
      'Question is required'
    );
    expect(await emitExpectingError(socket, 'question:submit')).toBe('Invalid request');
  });

  it('reports a failed save instead of crashing', async () => {
    Question.create.mockRejectedValueOnce(new Error('validation failed'));
    const socket = await joinAsViewer();
    expect(await emitExpectingError(socket, 'question:submit', { text: 'Why?' })).toBe(
      'Something went wrong'
    );
  });
});

describe('presenter events', () => {
  it('rejects a slide change without a slide id', async () => {
    const socket = await joinAsPresenter();
    expect(await emitExpectingError(socket, 'presenter:slide-change', {})).toBe(
      'Slide id is required'
    );
  });

  it('rejects a malformed question id on send and dismiss', async () => {
    const socket = await joinAsPresenter();
    expect(await emitExpectingError(socket, 'question:send', { questionId: 'bad' })).toBe(
      'Invalid question id'
    );
    expect(await emitExpectingError(socket, 'question:dismiss', { questionId: 42 })).toBe(
      'Invalid question id'
    );
    expect(Question.findById).not.toHaveBeenCalled();
    expect(Question.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a non-text answer', async () => {
    const socket = await joinAsPresenter();
    const message = await emitExpectingError(socket, 'question:send', {
      questionId: QUESTION_ID,
      answer: { text: 'hi' }
    });
    expect(message).toBe('Answer must be text');
  });
});

it('keeps serving the socket after an error', async () => {
  const socket = await connect();
  await emitExpectingError(socket, 'viewer:join');
  const joined = nextEvent(socket, 'viewer:joined');
  socket.emit('viewer:join', { code: 'ABC123', viewerId: 'v1' });
  await joined;
  expect(socket.connected).toBe(true);
});
