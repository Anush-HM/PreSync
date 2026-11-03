import mongoose from 'mongoose';

// A saved copy of a Word document at one moment. `kind` says why it was
// made: 'manual' (someone named it), 'auto' (taken on Save when the last
// version was a while ago) or 'restore' (what was there just before an
// older version was brought back, so the restore can be reversed).
const documentVersionSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    label: { type: String, trim: true, maxlength: 120, default: '' },
    kind: { type: String, enum: ['manual', 'auto', 'restore'], default: 'manual' },
    title: { type: String },
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    page: { type: mongoose.Schema.Types.Mixed },
    layout: { type: mongoose.Schema.Types.Mixed, default: null },
    wordCount: { type: Number, default: 0 },
    // Detects a Save that changed nothing, so no duplicate is kept.
    fingerprint: { type: String }
  },
  { timestamps: true }
);

documentVersionSchema.index({ documentId: 1, createdAt: -1 });

export default mongoose.model('DocumentVersion', documentVersionSchema);
