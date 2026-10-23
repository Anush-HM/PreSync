import mongoose from 'mongoose';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// A single extracted/editable text object on a slide. This mirrors the
// shape produced by the PDF ingestion pipeline: { id, type, x, y, width,
// fontSize, text, slideId }. Mongo is the source of truth at rest; while
// a deck is being actively co-edited, Yjs owns the live in-memory state
// and periodically persists snapshots back here.
const blockSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, enum: ['textbox', 'image'], default: 'textbox' },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    fontSize: { type: Number, default: 16 },
    text: { type: String, default: '' },
    // Text formatting. All optional so decks saved before these existed
    // still load; the editor and renderers fall back to the defaults.
    fontFamily: { type: String },
    fontWeight: { type: String, enum: ['normal', 'bold'] },
    fontStyle: { type: String, enum: ['normal', 'italic'] },
    underline: { type: Boolean },
    fill: { type: String, match: HEX_COLOR },
    textAlign: { type: String, enum: ['left', 'center', 'right', 'justify'] },
    lineHeight: { type: Number, min: 0.5, max: 4 },
    // Image blocks only: rendered height on the 960×540 canvas.
    height: { type: Number },
    // Only set when a slide/region falls back to a flattened image
    // because it didn't extract cleanly (tables, complex layouts).
    imageUrl: { type: String }
  },
  { _id: false }
);

const slideSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    order: { type: Number, required: true },
    backgroundImageUrl: { type: String }, // fallback flattened background, if any
    backgroundColor: { type: String, match: HEX_COLOR },
    notes: { type: String, default: '' }, // speaker notes, never shown to viewers
    needsImageFallback: { type: Boolean, default: false }, // true until a fallback image is rendered
    blocks: { type: [blockSchema], default: [] }
  },
  { _id: false }
);

const deckSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Any authenticated user who can co-edit this deck (owner is implicitly one).
    collaboratorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    sourcePdfUrl: { type: String },
    slides: { type: [slideSchema], default: [] }
  },
  { timestamps: true }
);

deckSchema.index({ ownerId: 1, updatedAt: -1 });

export default mongoose.model('Deck', deckSchema);