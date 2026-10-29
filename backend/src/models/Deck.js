import mongoose from 'mongoose';
import { slideSchema } from './slideSchema.js';

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