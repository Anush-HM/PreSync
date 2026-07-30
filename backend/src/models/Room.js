import mongoose from 'mongoose';

// One document per live session, matching the spec's data model:
// { code, deckId, presenterId, createdAt, active }
const roomSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, index: true },
    deckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deck', required: true },
    presenterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    currentSlideId: { type: String },
    active: { type: Boolean, default: true }
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } }
);

// Only one active room per code at a time; ended rooms can be cleaned up
// or archived on a schedule rather than deleted, for session history.
roomSchema.index({ code: 1, active: 1 });

export default mongoose.model('Room', roomSchema);