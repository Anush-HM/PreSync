import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';

export const TEST_JWT_SECRET = 'test-secret';

// Serves the real Express app on a random port so route tests exercise
// routing, middleware and controllers together. Models are mocked per
// test file, so no database is needed.
export async function startTestServer() {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  const app = createApp();
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${server.address().port}`;

  async function request(method, path, { body, token, headers = {} } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined && !(body instanceof FormData) && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers
      },
      body: body === undefined || body instanceof FormData ? body : JSON.stringify(body)
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, headers: res.headers, body: json };
  }

  return {
    app,
    request,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

export function tokenFor(userId) {
  return jwt.sign({ sub: userId }, TEST_JWT_SECRET);
}
