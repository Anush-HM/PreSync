import mongoose from 'mongoose';

// A Copilot conversation: one user's chat about one deck. It is private
// to that user (collaborators don't see each other's conversations) and
// keeps only what was said and proposed, never the document context the
// requests carried.
const actionSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    summary: { type: String, default: '' },
    payload: { type: mongoose.Schema.Types.Mixed }, // the validated action, as proposed
    status: { type: String, enum: ['proposed', 'applied', 'dismissed', 'undone'], default: 'proposed' }
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '', maxlength: 10000 },
    mode: { type: String },
    contextLabel: { type: String }, // "Slide 3: Pricing", never the slide text
    grounding: { type: String },
    slideRefs: [{ type: Number }],
    actions: { type: [actionSchema], default: undefined },
    model: { type: String },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const aiConversationSchema = new mongoose.Schema(
  {
    deckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deck', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: 'New conversation', maxlength: 120 },
    messages: { type: [messageSchema], default: [] }
  },
  { timestamps: true }
);

aiConversationSchema.index({ userId: 1, deckId: 1, updatedAt: -1 });

export default mongoose.model('AiConversation', aiConversationSchema);
