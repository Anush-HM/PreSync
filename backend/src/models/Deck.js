import mongoose from 'mongoose';

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