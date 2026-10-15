# PreSync

Collaborative presentation tool: an Express + MongoDB backend with Socket.IO and Yjs for live sync, and a React (Vite) frontend.

## Prerequisites

- Node.js 18 or newer
- MongoDB running locally (default `mongodb://localhost:27017`), e.g. `brew services start mongodb-community` or `docker run -d -p 27017:27017 --name presync-mongo mongo:7`
- Optional: an Anthropic API key, used to draft answers to audience questions

## Setup

```bash
# Install root, backend and frontend dependencies
npm install
npm run install:all

# Create the backend env file and fill it in
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | no | Backend port, defaults to `4000` |
| `MONGO_URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | Long random string used to sign login tokens |
| `CLIENT_ORIGIN` | yes | Frontend origin(s) allowed by CORS, comma-separated |
| `ANTHROPIC_API_KEY` | no | Enables AI-drafted Q&A answers; without it the drafter returns `NOT_IN_DECK` |

The frontend talks to `http://localhost:4000` by default. To point it elsewhere, set `VITE_API_URL` in `frontend/.env`.

## Run

```bash
npm run dev
```

This starts the backend (`node --watch`, port 4000) and the frontend (Vite, port 5173) together.

## Tests

```bash
npm test --prefix backend
```
