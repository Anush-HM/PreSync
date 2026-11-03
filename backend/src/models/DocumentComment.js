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

// A comment thread on a Word document. The text it is about carries a
// `comment` mark with this thread's id (see services/documentContent.js);
// `quote` keeps what that text said when the thread was started, for
// when the text has since been deleted.
const documentCommentSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    quote: { type: String, default: '', maxlength: 500 },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    replies: { type: [replySchema], default: [] },
    resolved: { type: Boolean, default: false },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date }
  },
  { timestamps: true }
);

documentCommentSchema.index({ documentId: 1, createdAt: 1 });

export default mongoose.model('DocumentComment', documentCommentSchema);
