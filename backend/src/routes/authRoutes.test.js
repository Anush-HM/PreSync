import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../models/User.js', () => ({
  default: { findOne: vi.fn(), create: vi.fn(), hashPassword: vi.fn() }
}));

const { default: User } = await import('../models/User.js');
const { startTestServer, TEST_JWT_SECRET } = await import('../test/httpServer.js');

const USER_ID = '64b000000000000000000001';

let server;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(() => server.close());

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('POST /api/auth/register', () => {
  it('requires email and password', async () => {
    const res = await server.request('POST', '/api/auth/register', { body: { email: 'a@b.co' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('email and password are required');
    expect(User.create).not.toHaveBeenCalled();
  });

  it('rejects an email that is already registered, case-insensitively', async () => {
    User.findOne.mockResolvedValue({ _id: USER_ID });
    const res = await server.request('POST', '/api/auth/register', {
      body: { email: 'Ada@Example.com', password: 'pw' }
    });
    expect(res.status).toBe(409);
    expect(User.findOne).toHaveBeenCalledWith({ email: 'ada@example.com' });
    expect(User.create).not.toHaveBeenCalled();
  });

  it('stores a hashed password and returns a token for the new user', async () => {
    User.findOne.mockResolvedValue(null);
    User.hashPassword.mockResolvedValue('hashed');
    User.create.mockResolvedValue({ _id: USER_ID, email: 'ada@example.com', name: 'Ada' });

    const res = await server.request('POST', '/api/auth/register', {
      body: { email: 'ada@example.com', password: 'pw', name: 'Ada' }
    });

    expect(res.status).toBe(201);
    expect(User.hashPassword).toHaveBeenCalledWith('pw');
    expect(User.create).toHaveBeenCalledWith({
      email: 'ada@example.com',
      passwordHash: 'hashed',
      name: 'Ada'
    });
    expect(res.body.user).toEqual({ id: USER_ID, email: 'ada@example.com', name: 'Ada' });
    expect(jwt.verify(res.body.token, TEST_JWT_SECRET).sub).toBe(USER_ID);
  });

  it('returns a generic 500 when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    User.findOne.mockRejectedValue(new Error('connection lost'));
    const res = await server.request('POST', '/api/auth/register', {
      body: { email: 'ada@example.com', password: 'pw' }
    });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

describe('POST /api/auth/login', () => {
  const user = (passwordOk) => ({
    _id: USER_ID,
    email: 'ada@example.com',
    name: 'Ada',
    verifyPassword: vi.fn().mockResolvedValue(passwordOk)
  });

  it('requires email and password', async () => {
    const res = await server.request('POST', '/api/auth/login', { body: { password: 'pw' } });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown email', async () => {
    User.findOne.mockResolvedValue(null);
    const res = await server.request('POST', '/api/auth/login', {
      body: { email: 'nobody@example.com', password: 'pw' }
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('rejects a wrong password with the same message as an unknown email', async () => {
    const u = user(false);
    User.findOne.mockResolvedValue(u);
    const res = await server.request('POST', '/api/auth/login', {
      body: { email: 'ada@example.com', password: 'wrong' }
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
    expect(u.verifyPassword).toHaveBeenCalledWith('wrong');
  });

  it('returns a token for valid credentials', async () => {
    User.findOne.mockResolvedValue(user(true));
    const res = await server.request('POST', '/api/auth/login', {
      body: { email: 'ADA@example.com', password: 'pw' }
    });
    expect(res.status).toBe(200);
    expect(User.findOne).toHaveBeenCalledWith({ email: 'ada@example.com' });
    expect(res.body.user.email).toBe('ada@example.com');
    expect(jwt.verify(res.body.token, TEST_JWT_SECRET).sub).toBe(USER_ID);
  });
});
