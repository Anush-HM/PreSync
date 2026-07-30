import mongoose from 'mongoose';

// One document per submitted question during a live session. The AI
// draft is grounded strictly in the deck's extracted text (see
// services/qaService.js) and is never auto-sent — a presenter action
// always mediates delivery to the room.
const questionSchema = new mongoose.Schema(
  {
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    viewerId: { type: String, required: true },
    slideId: { type: String, required: true }, // slide the question was asked from
    text: { type: String, required: true, trim: true, maxlength: 500 },
    draftAnswer: { type: String }, // null until the AI has drafted a response
    status: {
      type: String,
      enum: ['pending', 'drafted', 'sent', 'dismissed'],
      default: 'pending'
    }
  },
  { timestamps: true }
);

questionSchema.index({ roomId: 1, createdAt: 1 });

export default mongoose.model('Question', questionSchema);