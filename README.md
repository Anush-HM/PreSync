# PreSync

**PreSync is a real-time collaborative presentation and document workspace.** Teams build slide decks and Word-style documents together, import existing PowerPoint, PDF and Word files, present live to an audience that joins with a code, and get help from an AI Copilot that proposes changes you approve before they apply.

It is a full-stack JavaScript app: an Express + MongoDB backend with Socket.IO and Yjs for live sync, and a React (Vite) frontend built on Fabric.js for slides and TipTap for documents.

---

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Testing](#testing)
- [API overview](#api-overview)
- [Contributing](#contributing)

For the detailed behaviour of every feature (formatting options, import fidelity, export limits, Copilot privacy rules), see **[docs/FEATURES.md](docs/FEATURES.md)**.

---

## Features

### Slide editor
- Canvas editor with text, 27 shapes, tables, native charts, pictures, dividers and an elements library (stickers, recolourable icons, emoji).
- Rich text formatting per character, with a searchable font picker, lists, spacing and a format painter.
- 12 layouts, 8 themes, smart alignment guides, grouping, locking, layer order and a command palette (`Ctrl+K`).
- Full undo/redo, autosave through the live session, and six starter templates plus your own saved templates.

### Real-time collaboration
- Co-editing over Yjs (CRDT), with live cursors and each collaborator's selection outlined in their colour.
- Comment threads pinned to slides or elements, with replies and resolve/reopen.
- Named and automatic version history with slide-by-slide preview and restore.
- Share decks and documents with other PreSync users as editor or viewer.

### Import and export
- **Import** `.pptx` and `.pdf` (up to 25MB): text, formatting, tables, shapes, charts, SmartArt, pictures, backgrounds and speaker notes are reconstructed as editable slides. You review the analysis before anything is created. Import is deterministic and uses no AI.
- **Export** decks to `.pdf`, `.pptx` (editable text, tables and native charts) or a Word outline `.docx`, and the current slide to PNG or JPEG.

### Word documents
- A paginated TipTap editor with headings, lists, tables, pictures, shapes, headers/footers, page numbers and borders.
- Import `.docx`, export `.docx` and `.pdf`, live co-editing, comments on text ranges, sharing and version history.

### Live presenting
- *Present* opens a presenter view with the current and next slide, speaker notes, viewer count and an audience Q&A queue.
- The audience joins with a room code, link or QR code, with no account needed, and follows along on any screen with private per-slide notes.
- Presenters can have AI draft answers to audience questions, grounded only in the current slide and its neighbours.

### AI Copilot
- An assistant beside the canvas that works on your selection, slide or whole deck: rewrite, shorten, summarise, write speaker notes, suggest layouts and more.
- Every change arrives as a preview card and applies only when you approve it, through the same collaborative operations as manual edits.
- Generates new decks from a topic and an editable outline, and runs a local design check (overflow, overlaps, contrast, tiny type) without AI.
- Context is trimmed server-side, proposed actions are validated against a whitelist, and requests are rate limited per user.

---

## Tech stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 18, Vite, React Router, Fabric.js (slide canvas), TipTap (document editor), Yjs + y-protocols, Socket.IO client, lucide-react |
| Backend | Node.js (ES modules), Express 4, Mongoose 8 / MongoDB, Socket.IO, `ws` (Yjs WebSocket server), JWT + bcrypt auth, Multer uploads |
| Documents | JSZip + `@xmldom/xmldom` (OOXML parsing), PDF.js (PDF import), `@napi-rs/canvas` (optional, page rendering), PDFKit (PDF export), PptxGenJS (PPTX export) |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) behind a provider adapter |
| Testing and CI | Vitest, Testing Library, jsdom, ESLint, GitHub Actions |

---

## Architecture

```
                      ┌───────────────────────────────────────────┐
                      │            React frontend (Vite)          │
                      │  Fabric slide editor · TipTap doc editor  │
                      └──────┬──────────────┬──────────────┬──────┘
                    REST/JSON│   WebSocket  │   Socket.IO  │
                             │  (Yjs sync)  │  (live rooms)│
                      ┌──────▼──────────────▼──────────────▼──────┐
                      │        Node.js HTTP server (:4000)        │
                      │  Express API │ Yjs server │ Socket.IO     │
                      │  /api/*      │ /yjs/...   │ presenter/    │
                      │              │            │ viewer events │
                      └──────┬──────────────┬──────────────┬──────┘
                             │              │              │
                       ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼──────┐
                       │  MongoDB  │  │ Import/   │  │ Anthropic  │
                       │ (Mongoose)│  │ export    │  │ API        │
                       └───────────┘  │ services  │  │ (optional) │
                                      └───────────┘  └────────────┘
```

One HTTP server (`backend/src/server.js`) hosts three independent layers:

1. **REST API (Express).** Auth, decks, documents, imports, templates, rooms and AI routes under `/api/*`, built in `backend/src/app.js`. Controllers throw freely and a central error handler maps validation errors to `400` and oversized bodies to `413`.
2. **Yjs co-editing server (`ws`).** Handles WebSocket upgrades on `/yjs/:deckId` and `/yjs/documents/:id`. Connections need a valid JWT and edit access, and viewers never connect here. The server keeps one shared Y.Doc and awareness per deck or document, and writes it back to MongoDB shortly after changes and when the last editor leaves.
3. **Socket.IO live sessions.** Presenter and viewer traffic for live rooms: slide changes, viewer counts and audience Q&A. Each session code has a broadcast channel for everyone and a presenter-only channel for private Q&A drafts, so viewers have no way to reach presenter data. All socket input is validated in `sockets/validation.js`.

**Data model.** MongoDB collections cover `User`, `Deck` (slides embedded via `slideSchema`), `DeckVersion`, `Comment`, `Document`, `DocumentVersion`, `DocumentComment`, `ImportedDocument`, `Template`, `Room`, `Viewer`, `Question` and `AiConversation`.

**AI boundary.** The model never writes to the database or runs code. The backend trims the editor context, wraps it in a data block the model is told never to take instructions from, and validates every proposed action (`backend/src/ai/actions.js`). The browser applies only the actions the user approves.

---

## Project structure

```
presync/
├── package.json              # Root scripts: run both apps, install all
├── backend/
│   ├── .env.example          # Copy to .env and fill in
│   └── src/
│       ├── server.js         # Entry point: HTTP + Socket.IO + Yjs
│       ├── app.js            # Express app factory (used by tests too)
│       ├── config/db.js      # MongoDB connection
│       ├── routes/           # Express routers (+ route tests)
│       ├── controllers/      # Request handlers
│       ├── models/           # Mongoose schemas
│       ├── middleware/       # Auth (JWT), uploads, async wrapper
│       ├── services/         # PPTX/PDF/DOCX import, PDF/PPTX/DOCX export, Q&A
│       ├── sockets/          # Socket.IO live-session events
│       ├── yjs/              # Yjs WebSocket server and doc managers
│       ├── ai/               # Copilot config, prompts, context, validation, providers
│       └── test/             # Test helpers and fixture files
├── frontend/
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx           # Routes
│       ├── pages/            # Landing, decks, editor, documents, presenter, viewer…
│       ├── components/
│       │   ├── editor/       # Slide editor UI (toolbar, panels, Fabric blocks)
│       │   ├── documents/    # Word editor UI (TipTap extensions, pagination)
│       │   ├── copilot/      # AI Copilot panel and action cards
│       │   ├── collab/       # Comments, version history, export dialog
│       │   ├── imports/      # Import dialog and review
│       │   ├── live/         # Invite, QR code, connection state
│       │   ├── templates/    # Template gallery
│       │   ├── layout/       # App shell / sidebar
│       │   └── ui/           # Shared primitives (dialog, menu, toast…)
│       ├── data/             # API clients, Yjs client, editor operations, layouts, themes, fonts
│       └── styles/           # Theme tokens (theme.css)
├── docs/FEATURES.md          # Detailed feature reference
└── .github/workflows/        # CI: backend and frontend tests
```

---

## Getting started

### Prerequisites

- **Node.js 18+** (CI uses Node 22)
- **MongoDB**, local or hosted. For a quick local instance:
  ```bash
  docker run -d -p 27017:27017 --name presync-mongo mongo:7
  ```
- *Optional:* an **Anthropic API key** for AI Copilot and AI-drafted Q&A answers.
- *Optional, for better PDF export fonts on Linux:* `fonts-crosextra-carlito`, `fonts-crosextra-caladea`, `fonts-liberation`.

### Install

```bash
git clone https://github.com/Yashwanthdot7/PreSync.git
cd PreSync

# Root tooling, then backend and frontend dependencies
npm install
npm run install:all
```

You can also install each app on its own with `npm install` inside `backend/` and `frontend/`.

### Configure

```bash
cp backend/.env.example backend/.env
```

At minimum, set `MONGO_URI`, `JWT_SECRET` and `CLIENT_ORIGIN` (see [Configuration](#configuration)). To generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Run

```bash
npm run dev
```

This starts the backend on **http://localhost:4000** (with `node --watch`) and the frontend on **http://localhost:5173** (Vite, opens in your browser). Register an account on the login page to get started. `GET /health` returns `{ "ok": true }` when the backend is up.

---

## Configuration

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | no | `4000` | Port for the API, Socket.IO and Yjs servers |
| `MONGO_URI` | **yes** | | MongoDB connection string, e.g. `mongodb://localhost:27017/presync` |
| `JWT_SECRET` | **yes** | | Long random string used to sign login tokens |
| `CLIENT_ORIGIN` | **yes** | | Frontend origin(s) allowed by CORS, comma-separated |
| `ANTHROPIC_API_KEY` | no | | Enables AI Copilot and AI-drafted Q&A. Without it, Copilot shows a setup message and the Q&A drafter returns `NOT_IN_DECK` |
| `AI_PROVIDER` | no | `anthropic` | Copilot provider adapter (only `anthropic` is implemented) |
| `AI_MODEL` | no | `claude-opus-5-5` | Model Copilot uses |
| `AI_EFFORT` | no | `medium` | `low`, `medium`, `high`, `xhigh` or `max` |
| `AI_MAX_OUTPUT_TOKENS` | no | `8000` | Longest Copilot reply (1000 to 32000) |
| `AI_RATE_LIMIT_PER_MINUTE` | no | `10` | Copilot requests per user per minute |
| `AI_REFUSAL_FALLBACK` | no | `default` | `default` retries a declined request on the recommended fallback model; `off` disables it |
| `AI_STORE_HISTORY` | no | `true` | Save Copilot conversations (without slide content) |
| `AI_COPILOT_ENABLED` | no | `true` | `false` turns Copilot off even when a key is set |
| `PDF_FONT_DIRS` | no | | Extra font folders for PDF export |

The API key stays on the server and is never sent to the browser. `backend/.env` is gitignored, so never commit real secrets.

### Frontend (`frontend/.env`, optional)

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:4000` | Backend origin. WebSocket URLs are derived from it |

---

## Scripts

| Location | Command | What it does |
| --- | --- | --- |
| root | `npm run dev` | Runs backend and frontend together (via `concurrently`) |
| root | `npm run install:all` | Installs backend and frontend dependencies |
| `backend/` | `npm run dev` | Starts the API with file watching |
| `backend/` | `npm start` | Starts the API (production) |
| `backend/` | `npm test` | Runs backend tests (Vitest) |
| `frontend/` | `npm run dev` | Starts the Vite dev server |
| `frontend/` | `npm run build` | Builds the production bundle into `frontend/dist` |
| `frontend/` | `npm run preview` | Serves the production build locally |
| `frontend/` | `npm run lint` | Runs ESLint with zero warnings allowed |
| `frontend/` | `npm test` | Runs frontend tests (Vitest + jsdom + Testing Library) |

---

## Testing

```bash
npm test --prefix backend
npm test --prefix frontend
npm run lint --prefix frontend
```

- **Backend** tests serve the real Express app on a random port (`backend/src/test/httpServer.js`) and mock the Mongoose models, so **no database is needed**. They cover routes, sockets, the Yjs servers, the AI layer, and import/export fidelity against fixture files in `backend/src/test/fixtures/`.
- **Frontend** tests run in jsdom with Testing Library and cover pages, editor UI, collaboration panels, Copilot and the pure editor operations in `src/data/`.
- **CI** (`.github/workflows/backend-tests.yml`) runs on every pull request and on pushes to `main`. It runs the backend tests, then the frontend lint, tests and production build, on Node 22.

---

## API overview

All routes are under `/api` and, apart from auth and joining a live room, need an `Authorization: Bearer <token>` header.

| Area | Base path | Highlights |
| --- | --- | --- |
| Auth | `/api/auth` | `POST /register`, `POST /login` |
| Decks | `/api/decks` | CRUD, `/save`, `/duplicate`, `/export?format=pdf\|pptx\|docx`, `/collaborators`, `/versions`, `/comments` |
| Imports | `/api/imports` | Upload and analyse a file, edit its outline, create a deck from it |
| Documents | `/api/documents` | CRUD, `/import-docx`, `/export/docx\|pdf`, `/share`, `/comments`, `/versions` |
| Templates | `/api/templates` | List, save, delete, create a deck from a template |
| Rooms | `/api/rooms` | `/go-live`, `/:roomId/end`, `/mine`, public `/:code`, `/:code/join`, viewer notes |
| AI | `/api/ai` | `/status`, `/decks/:deckId/assist`, conversations |

Real-time endpoints: Yjs WebSockets at `/yjs/:deckId` and `/yjs/documents/:id`, and Socket.IO events `presenter:join`, `viewer:join`, `presenter:slide-change`, `question:submit`, `question:send` and `question:dismiss`.

---

## Contributing

Contributions are welcome. To propose a change:

1. **Fork** the repository and create a branch from `main`, e.g. `feature/slide-transitions` or `fix/pdf-export-fonts`.
2. **Install and run** the app locally as described in [Getting started](#getting-started).
3. **Make your change** and follow the existing conventions:
   - ES modules throughout, with backend code split into routes → controllers → services/models.
   - Keep editor operations in `frontend/src/data/` pure and tested; UI lives in `components/` and `pages/`.
   - Use the CSS custom properties in `frontend/src/styles/theme.css` rather than hard-coded colours.
   - Validate any new socket input in `backend/src/sockets/validation.js`, and any new Copilot action in `backend/src/ai/actions.js`.
4. **Add or update tests** next to the code you change (`*.test.js` / `*.test.jsx`).
5. **Check everything passes** before opening a PR:
   ```bash
   npm test --prefix backend
   npm run lint --prefix frontend
   npm test --prefix frontend
   npm run build --prefix frontend
   ```
6. **Open a pull request** against `main` that describes what changed and why, with screenshots for UI changes. CI must be green before merge.

Please report bugs and feature requests through GitHub Issues, with steps to reproduce and your browser and Node versions.

---

## Licensing notes

The web fonts offered in the editor are open-licence families loaded from Google Fonts, not bundled. Layouts, themes, templates, stickers and icons are PreSync originals. Licences for each are recorded in `frontend/src/data/fonts.js` and `frontend/src/data/assetLibrary.js`. The repository doesn't include a project licence file yet.
