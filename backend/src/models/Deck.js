import mongoose from 'mongoose';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// A single extracted/editable text object on a slide. This mirrors the
// shape produced by the PDF ingestion pipeline: { id, type, x, y, width,
// fontSize, text, slideId }. Mongo is the source of truth at rest; while
// a deck is being actively co-edited, Yjs owns the live in-memory state
// and periodically persists snapshots back here.
const blockSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, enum: ['textbox', 'image', 'shape', 'table', 'chart'], default: 'textbox' },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    fontSize: { type: Number, default: 16 },
    text: { type: String, default: '' },
    // Text formatting. All optional so decks saved before these existed
    // still load; the editor and renderers fall back to the defaults.
    fontFamily: { type: String },
    fontWeight: { type: String, enum: ['normal', 'bold'] },
    fontStyle: { type: String, enum: ['normal', 'italic'] },
    underline: { type: Boolean },
    linethrough: { type: Boolean },
    fill: { type: String, match: HEX_COLOR },
    textAlign: { type: String, enum: ['left', 'center', 'right', 'justify'] },
    lineHeight: { type: Number, min: 0.5, max: 4 },
    paragraphSpacing: { type: Number, min: 0 }, // extra px between paragraphs
    // Mixed formatting inside one text box: the ranges that differ from
    // the block's own formatting, in Fabric.js's serialised form
    // ([{ start, end, style }], indices not counting line breaks).
    styles: { type: mongoose.Schema.Types.Mixed },
    // Rendered height on the 960×540 canvas. Images, shapes and tables
    // always have one; a text box has one when its text is anchored to
    // the middle or bottom of a fixed-height area (verticalAlign).
    height: { type: Number },
    verticalAlign: { type: String, enum: ['top', 'middle', 'bottom'] },
    rotation: { type: Number }, // degrees clockwise, about the block's centre
    flipH: { type: Boolean },
    flipV: { type: Boolean },
    // What the block is on its slide: the slide title (names the slide in
    // lists), a subtitle, decoration from the source's master/layout, or
    // a placeholder for content that couldn't be imported, or the preview
    // picture of an embedded object (an Excel sheet…).
    role: { type: String, enum: ['title', 'subtitle', 'decor', 'placeholder', 'object'] },
    // Shape blocks: outline geometry and paint. `path` is SVG path data
    // in a 0–1000 box stretched over the block.
    shape: { type: String, enum: ['rect', 'roundRect', 'ellipse', 'line', 'path'] },
    path: { type: String },
    radius: { type: Number, min: 0 },
    background: { type: String, match: HEX_COLOR },
    fillGradient: { type: mongoose.Schema.Types.Mixed }, // { angle, stops: [{ pos, color }] }
    opacity: { type: Number, min: 0, max: 1 },
    stroke: { type: String, match: HEX_COLOR },
    strokeWidth: { type: Number, min: 0 },
    dash: { type: Boolean },
    // Table blocks: { columns: [width], rows: [{ height, cells: [cell] }] },
    // each cell carrying its own text, formatting, fill, borders and merges.
    table: { type: mongoose.Schema.Types.Mixed },
    // Chart blocks: { kind, grouping, title, categories, series: [{ name,
    // values, color }], legend, dataLabels, … } (see services/chartLayout.js).
    chart: { type: mongoose.Schema.Types.Mixed },
    // Only set when a slide/region falls back to a flattened image
    // because it didn't extract cleanly (tables, complex layouts).
    imageUrl: { type: String },
    // Highlight behind a text box's text (per-character highlights ride in `styles`).
    textBackgroundColor: { type: String, match: HEX_COLOR },
    // Image blocks: the part of the picture shown, as fractions of its
    // natural size ({ x, y, w, h }), a drop shadow ({ color, blur, x, y,
    // opacity }) and alternative text for screen readers and exports.
    crop: { type: mongoose.Schema.Types.Mixed },
    shadow: { type: mongoose.Schema.Types.Mixed },
    alt: { type: String, maxlength: 1000 },
    locked: { type: Boolean }, // can't be moved, resized or deleted until unlocked
    groupId: { type: String }, // blocks sharing one select and move together
    lockAspect: { type: Boolean }, // keep proportions while resizing (images do unless false)
    layoutSlot: { type: String } // the layout slot a block was made for (title, body, image…)
  },
  { _id: false }
);

const slideSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    order: { type: Number, required: true },
    backgroundImageUrl: { type: String }, // fallback flattened background, if any
    backgroundColor: { type: String, match: HEX_COLOR },
    backgroundGradient: { type: mongoose.Schema.Types.Mixed }, // { angle, stops: [{ pos, color }] }
    backgroundRepeat: { type: Boolean }, // tile backgroundImageUrl instead of stretching it
    notes: { type: String, default: '' }, // speaker notes, never shown to viewers
    needsImageFallback: { type: Boolean, default: false }, // true until a fallback image is rendered
    blocks: { type: [blockSchema], default: [] },
    name: { type: String, maxlength: 200 }, // shown in the slide list instead of the title
    hidden: { type: Boolean }, // skipped when presenting and in exports
    layout: { type: String }, // id of the layout last applied (frontend/src/data/layouts.js)
    theme: { type: String } // id of the theme last applied (frontend/src/data/themes.js)
  },
  { _id: false }
);

const deckSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Any authenticated user who can co-edit this deck (owner is implicitly one).
    collaboratorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    sourcePdfUrl: { type: String },
    slides: { type: [slideSchema], default: [] }
  },
  { timestamps: true }
);

deckSchema.index({ ownerId: 1, updatedAt: -1 });

export default mongoose.model('Deck', deckSchema);