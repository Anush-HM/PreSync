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

## Importing, editing and exporting decks

- **Import:** Word (`.docx`), PowerPoint (`.pptx`) and PDF (`.pdf`), up to 25MB, from the dashboard. The file is analysed first (`POST /api/imports`) and the user reviews the result before anything is created:
  - *Word:* headings, paragraphs, bullet and numbered lists (including style-based numbering), tables and PNG/JPEG/GIF pictures are read in order. The shallowest heading level used more than once marks slide boundaries; long sections continue onto extra slides, and the full section text goes into speaker notes. The suggested outline can be edited, reordered and saved before generating slides.
  - *PowerPoint:* text boxes with position, size, font, bold/italic/underline, colour and alignment; pictures (up to 1.5MB each, 8MB per deck); background colours; and speaker notes. The review lists slide titles, plus tables, charts, SmartArt, media, animations and embedded fonts that are not imported. *Open in editor* keeps the slides as extracted; *Generate from outline* rebuilds them as a fresh, consistently laid-out deck.
  - *PDF:* each page becomes a slide of editable text. Pictures and drawings are not extracted.
  - Legacy `.doc` and `.ppt` are refused with a prompt to re-save them. Imports are kept on the **Documents** page, so the same file never has to be uploaded twice. Analysis is deterministic and uses no AI.
- **Edit:** font, size, bold/italic/underline, colour, alignment, line spacing, layer order, slide background, speaker notes, slide reorder/duplicate, undo/redo (Ctrl+Z / Ctrl+Shift+Z). Edits autosave through the live co-editing session; **Save** (Ctrl+S) writes them to the database immediately.
- **Export:** *Export* in the editor downloads the deck as `.pdf` or `.pptx` (`GET /api/decks/:id/export?format=pdf|pptx`). PPTX keeps text editable, with speaker notes. PDF uses the standard PDF fonts (closest match to the chosen family) and covers Latin-1 text only.

## Design system

The UI follows the *Dark Forest Studio* theme: charcoal surfaces, forest green for primary actions and selection, crimson for live and destructive states. All colours, radii, shadows and fonts are CSS custom properties in `frontend/src/styles/theme.css`; shared primitives (dialog, confirm dialog, toast, menu, avatar, logo) live in `frontend/src/components/ui/`. Icons come from [`lucide-react`](https://lucide.dev).

Signed-in pages use the sidebar layout in `frontend/src/components/layout/AppShell.jsx`:

| Route | Page |
| --- | --- |
| `/decks` | Dashboard: recent and shared presentations, search, filter, sort |
| `/decks/mine` | Presentations you own |
| `/decks/shared` | Presentations shared with you |
| `/documents` | Imported files (`GET /api/imports`) |
| `/imports/:id` | Review an import: analysis, outline editor, document or slide preview |
| `/sessions` | Your live and recent sessions (`GET /api/rooms/mine`) |

The editor (`/editor/:deckId`) has its own full-screen layout:

- **Left:** slide thumbnails, with keyboard navigation and a per-slide menu for duplicate, move and delete.
- **Centre:** the Fabric canvas, with zoom and *Fit*.
- **Right:** a formatting panel that changes with what is selected.

Below 1100px the formatting panel opens as an overlay. Below 768px the slide list does too.

*Insert → Image* embeds PNG, JPEG or GIF files up to 1.5MB.

## Tests

```bash
npm test --prefix backend
npm test --prefix frontend
npm run lint --prefix frontend
```
