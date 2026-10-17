import mongoose from 'mongoose';

// One document per live session, matching the spec's data model:
// { code, deckId, presenterId, createdAt, active }
const roomSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true },
    deckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deck', required: true },
    presenterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    currentSlideId: { type: String },
    active: { type: Boolean, default: true }
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } }
);

// Only one active room per code at a time. Ended rooms keep their code
// for session history, so uniqueness is partial: a code frees up again
// as soon as its room ends. This replaces the old `code_1` unique index,
// which covered ended rooms too; syncRoomIndexes() drops it on startup.
roomSchema.index(
  { code: 1 },
  { name: 'code_active_unique', unique: true, partialFilterExpression: { active: true } }
);
roomSchema.index({ code: 1, active: 1 });

export default mongoose.model('Room', roomSchema);