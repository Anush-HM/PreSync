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
  - *Word:* headings, paragraphs, bullet and numbered lists (with their own markers and indents), run formatting (font, size, bold/italic/underline/strike, colour), paragraph alignment and spacing, tables (merged cells, shading, borders), pictures, charts (with their data), page breaks, page size and margins, and the default header and footer. The *Document preview* shows it as pages. The shallowest heading level used more than once marks slide boundaries; long sections continue onto extra slides, each table and chart gets a slide of its own (long tables are split, repeating the header row), and the full section text goes into speaker notes. The suggested outline can be edited, reordered and saved before generating slides.
  - *PowerPoint:* text boxes with position, size, rotation, insets and vertical anchoring; fonts, sizes and formatting per run, following the slide → layout → master inheritance; bullets and automatic numbering; tables (merged cells, fills, borders, built-in table styles); shapes (preset and custom geometry, fills, gradients, outlines); cropped pictures; colour, gradient and picture backgrounds; and speaker notes. Charts (column, bar, line, area, pie, doughnut, scatter; clustered or stacked) are read from their cached data and redrawn as chart blocks with their colours, title, legend and labels; 3-D and combo charts are drawn simplified and say so. SmartArt is redrawn as ordinary, editable shapes from the layout PowerPoint saves with it. Embedded objects (spreadsheets, Visio drawings…) show their preview picture. Anything still unreadable becomes a labelled placeholder and is listed in the review. *Open in editor* keeps the slides as extracted; *Generate from outline* rebuilds them as a fresh, consistently laid-out deck.
  - *PDF:* each page's drawing (pictures, shapes, charts) is rendered with PDF.js as the slide background, with the page's text on top as editable, aligned text boxes (fonts, sizes, bold/italic, colours, lists and the page title). Scanned pages without real text keep their full render. Rendering needs the optional `@napi-rs/canvas` package; without it PDFs import as text only.
  - Legacy `.doc` and `.ppt` are refused with a prompt to re-save them. Imports are kept on the **Documents** page, so the same file never has to be uploaded twice. Analysis is deterministic and uses no AI.
- **Edit:** font, size, bold/italic/underline, colour, alignment, line spacing, layer order, slide background, speaker notes, slide reorder/duplicate, undo/redo (Ctrl+Z / Ctrl+Shift+Z). Edits autosave through the live co-editing session; **Save** (Ctrl+S) writes them to the database immediately.
- **Export:** *Export* in the editor downloads the deck as `.pdf` or `.pptx` (`GET /api/decks/:id/export?format=pdf|pptx`). PPTX keeps text editable with its per-run formatting, plus tables, native (editable) charts, shapes, pictures, picture backgrounds and speaker notes (gradients export as their first colour). PDF draws the same content, including gradients. It embeds Carlito, Caladea and Liberation fonts when the server has them installed (`fonts-crosextra-carlito`, `fonts-crosextra-caladea`, `fonts-liberation`; other font folders via `PDF_FONT_DIRS`), so text keeps the widths of Calibri, Cambria, Arial, Times New Roman and Courier New; otherwise it falls back to the standard PDF fonts, which cover Latin-1 text only.

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

**Live sessions**

- *Present* in the editor saves the deck and opens the presenter view (`/presenter/:code`). It shows:
  - The current slide, next-slide preview and speaker notes.
  - Viewer count and connection state.
  - The audience Q&A queue.
  - *Invite*, with the code, a join link (`/join?code=…`) and a QR code.
- *End session* asks for confirmation first.
- The audience view (`/view/:code`) scales the slide to any screen and lets viewers catch up when the presenter moves on. It has private per-slide notes and Q&A.
- Both views show connecting, reconnecting and ended states. socket.io reconnects automatically.

## Tests

```bash
npm test --prefix backend
npm test --prefix frontend
npm run lint --prefix frontend
```
