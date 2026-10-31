import mongoose from 'mongoose';

// A Word document edited in PreSync. Independent of decks: it never
// becomes slides. `content` is the editor's document tree (see
// services/documentContent.js), pictures included.
const documentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Other users who may edit this document (the owner always can).
    collaboratorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    // Page size and margins in px at 96 dpi: { width, height, margins }.
    page: { type: mongoose.Schema.Types.Mixed, required: true },
    wordCount: { type: Number, default: 0 },
    // For imported files: the original name, and what could not be brought in.
    sourceFileName: { type: String, default: null },
    importNotes: { type: [String], default: [] }
  },
  { timestamps: true }
);

documentSchema.index({ ownerId: 1, updatedAt: -1 });
documentSchema.index({ collaboratorIds: 1, updatedAt: -1 });

export default mongoose.model('Document', documentSchema);
