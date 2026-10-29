import mongoose from 'mongoose';

const replySchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

// A comment thread on a slide, optionally pinned to one element on it.
// Editors only; viewers of a live session never see comments.
const commentSchema = new mongoose.Schema(
  {
    deckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deck', required: true },
    slideId: { type: String, required: true },
    blockId: { type: String },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    replies: { type: [replySchema], default: [] },
    resolved: { type: Boolean, default: false },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date }
  },
  { timestamps: true }
);

commentSchema.index({ deckId: 1, createdAt: 1 });

export default mongoose.model('Comment', commentSchema);
