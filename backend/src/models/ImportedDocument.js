import mongoose from 'mongoose';

// A file a user imported, kept after analysis so they can review the
// extracted structure, edit the outline and create presentations from
// it without uploading the file again. The original bytes are not
// stored; what is kept is what PreSync extracted from them.
const importedDocumentSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, required: true },
    format: { type: String, enum: ['docx', 'pptx', 'pdf'], required: true },
    title: { type: String, required: true },
    // Structure analysis: stats, headings, topics, key points, warnings.
    analysis: { type: mongoose.Schema.Types.Mixed, required: true },
    // Suggested slide outline, as last saved by the user.
    outline: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Word: ordered content blocks for the document preview.
    blocks: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Word: page size and margins in px ({ width, height, margins }), and
    // the default header and footer paragraphs, for a paginated preview.
    page: { type: mongoose.Schema.Types.Mixed, default: null },
    header: { type: [mongoose.Schema.Types.Mixed], default: [] },
    footer: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Word: extracted pictures ({ id, mime, dataUrl, widthPx, heightPx }).
    images: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // PowerPoint / PDF: slides exactly as extracted, ready for a Deck.
    slides: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Slide canvas dimensions detected from the source file.
    canvasWidth:  { type: Number, default: 960 },
    canvasHeight: { type: Number, default: 540 },
    // Presentations created from this import.
    deckIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Deck' }]
  },
  { timestamps: true }
);

importedDocumentSchema.index({ ownerId: 1, createdAt: -1 });

export default mongoose.model('ImportedDocument', importedDocumentSchema);
