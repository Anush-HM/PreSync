import mongoose from 'mongoose';
import { slideSchema } from './slideSchema.js';

// A user's own template: a snapshot of a deck's slides that new decks
// can start from. Only its owner can see, use or delete it.
const templateSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    sourceDeckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deck' },
    slides: { type: [slideSchema], default: [] }
  },
  { timestamps: true }
);

templateSchema.index({ ownerId: 1, updatedAt: -1 });

export default mongoose.model('Template', templateSchema);
