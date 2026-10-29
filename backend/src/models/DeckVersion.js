import mongoose from 'mongoose';
import { slideSchema } from './slideSchema.js';

// A saved copy of a deck's slides at one moment. `kind` says why it was
// made: 'manual' (an editor named it), 'auto' (taken on Save when the
// last version was a while ago) or 'restore' (taken just before an older
// version was brought back, so the restore can be undone).
const deckVersionSchema = new mongoose.Schema(
  {
    deckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deck', required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    label: { type: String, trim: true, maxlength: 120, default: '' },
    kind: { type: String, enum: ['manual', 'auto', 'restore'], default: 'manual' },
    title: { type: String },
    slides: { type: [slideSchema], default: [] },
    // Detects a Save that changed nothing, so no duplicate is kept.
    fingerprint: { type: String }
  },
  { timestamps: true }
);

deckVersionSchema.index({ deckId: 1, createdAt: -1 });

export default mongoose.model('DeckVersion', deckVersionSchema);
