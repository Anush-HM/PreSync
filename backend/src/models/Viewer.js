import mongoose from 'mongoose';

// One document per viewer who joins a room, matching the spec's data
// model: { viewerId, roomId, displayName }. Notes are embedded here since
// they're always looked up per-viewer, never queried across viewers.
const noteSchema = new mongoose.Schema(
  {
    slideId: { type: String, required: true },
    text: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const viewerSchema = new mongoose.Schema(
  {
    viewerId: { type: String, required: true, unique: true, index: true },
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    notes: { type: [noteSchema], default: [] }
  },
  { timestamps: { createdAt: 'joinedAt', updatedAt: false } }
);

viewerSchema.index({ roomId: 1 });

export default mongoose.model('Viewer', viewerSchema);