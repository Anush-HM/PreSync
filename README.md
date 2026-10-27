# PreSync

Collaborative presentation tool: an Express + MongoDB backend with Socket.IO and Yjs for live sync, and a React (Vite) frontend.

## Prerequisites

- Node.js 18 or newer
- MongoDB running locally (default `mongodb://localhost:27017`), e.g. `brew services start mongodb-community` or `docker run -d -p 27017:27017 --name presync-mongo mongo:7`
- Optional: an Anthropic API key, used by AI Copilot in the editor and to draft answers to audience questions

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
| `ANTHROPIC_API_KEY` | no | Enables AI Copilot and AI-drafted Q&A answers; without it Copilot shows a setup message and the drafter returns `NOT_IN_DECK` |
| `AI_PROVIDER` | no | Copilot's model provider adapter, defaults to `anthropic` (the only one implemented) |
| `AI_MODEL` | no | Model Copilot uses, defaults to `claude-opus-5-5` |
| `AI_EFFORT` | no | `low`, `medium` (default), `high`, `xhigh` or `max` |
| `AI_MAX_OUTPUT_TOKENS` | no | Longest Copilot reply, defaults to `8000` |
| `AI_RATE_LIMIT_PER_MINUTE` | no | Copilot requests per user per minute, defaults to `10` |
| `AI_REFUSAL_FALLBACK` | no | `default` (retry a declined request on Anthropic's recommended fallback model) or `off` |
| `AI_STORE_HISTORY` | no | `true` (default) saves Copilot conversations; `false` keeps them in the browser tab only |
| `AI_COPILOT_ENABLED` | no | `false` turns Copilot off even when a key is set |

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

## AI Copilot

*Copilot* in the editor's top bar opens an assistant beside the canvas (an overlay below 1400px). It works on what you are editing: the selected text or objects, the current slide, or the whole deck, shown and switchable above the message box.

- **Assist:** ask in your own words or pick a suggested prompt. It can rewrite, shorten, expand or fix the selected text, convert it to bullets or a table, suggest titles, write speaker notes, introductions and conclusions, summarise slides or the deck, recommend a layout, and suggest stickers, icons and emoji from PreSync's library. Each answer is labelled as coming from your presentation, general knowledge, or both, with links to the slides it used.
- **Proposed changes** arrive as cards with a preview (before and after text, before and after slide thumbnails, a table preview, or asset tiles). Nothing changes until you apply one; *Undo* on the card or Ctrl+Z reverts it. Changes go through the same collaborative operations as manual edits, so co-editors see them live, autosave and *Save* store them, and an action whose text was edited by someone else in the meantime is refused instead of overwriting it.
- **Create deck:** enter a topic, audience, purpose, slide count, tone and optional style. Copilot drafts an outline that you can edit, reorder and trim, then pick colours and where the slides go (after the current slide or at the end; an untouched blank deck can be replaced). Existing slides are never overwritten.
- **Check design** runs the editor's own checks on the current slide, without AI: text running off the slide or out of its box (from measured text heights), overlaps, edges a few pixels out of line, tiny type, too many fonts or words, and low contrast. Fixes that can be computed are offered as an *Apply fixes* card. The same report is sent with AI requests so design advice is based on real geometry.

**Privacy and safety.** The first time, Copilot explains which provider receives the content and asks to continue. Each request sends only what it needs: the active slide in detail, the selection, slide titles, and for deck-wide questions the slides most related to the request (others abridged). The server trims that again, keeps it inside a data block that the model is told never to take instructions from, and validates every proposed change against the editor's supported operations (`backend/src/ai/actions.js`), dropping anything that names blocks, layouts or assets that don't exist. The model never runs code or writes to the database; the browser applies approved changes. Conversations are saved per user and deck without slide content, are private to that user, are deleted with the deck, and can be cleared from the panel. Requests are rate limited per user, and neither prompts nor document text are logged.

**API** (signed-in editors only): `GET /api/ai/status`, `POST /api/ai/decks/:deckId/assist`, `GET|POST|DELETE /api/ai/decks/:deckId/conversations`, `GET|DELETE /api/ai/conversations/:id`, and `PATCH /api/ai/conversations/:id/messages/:messageId/actions/:index` to record whether a suggestion was applied.

**Code map.** Backend: `src/ai/` (config, provider adapter in `providers/`, context limits, prompt, structured response and action validation, rate limiter), `src/controllers/aiController.js`, `src/routes/aiRoutes.js`, `src/models/AiConversation.js`. Frontend: `src/components/copilot/` (panel, action cards, outline builder, editor bridge), `src/data/copilotContext.js` (what is sent), `src/data/copilotActions.js` (previews and edits on the Y.Doc), `src/data/layoutAnalysis.js` (design checks), `src/data/copilotLayouts.js` (layouts and colour themes) and `src/data/assetLibrary.js` (stickers, icons and emoji with licensing). Adding a provider means a new file in `backend/src/ai/providers/` exposing `generateJson()`.

**Limits.** Selection rewrites need the selection from the current session (a suggestion reloaded from history can't replace text blindly). Copilot doesn't see pictures' content, only their size and position, and it doesn't edit inside existing tables. *Undo* on a card reverts the most recent Copilot change.

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
