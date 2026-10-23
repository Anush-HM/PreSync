// Shared defaults and option lists for slide/block formatting, used by
// the editor toolbar and by every read-only slide renderer so a block
// looks the same in the editor, presenter view and viewer view.

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 540;

export const DEFAULT_TEXT_COLOR = '#1a1a2e';
export const DEFAULT_SLIDE_BACKGROUND = '#ffffff';
export const DEFAULT_FONT_FAMILY = 'Public Sans, sans-serif';
export const DEFAULT_LINE_HEIGHT = 1.16; // Fabric's Textbox default

export const FONT_FAMILIES = [
  { label: 'Public Sans', value: DEFAULT_FONT_FAMILY },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' }
];

export const TEXT_ALIGNMENTS = ['left', 'center', 'right', 'justify'];

export const TEXT_COLORS = ['#1a1a2e', '#e74c3c', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ffffff'];

export const SLIDE_BACKGROUNDS = ['#ffffff', '#f5f5f0', '#1a1a2e', '#0f3460', '#fdf2e9', '#eafaf1'];

// Decks imported before PDF coordinates were normalized can have blocks
// outside the 960×540 canvas. Returns the uniform scale that fits them.
export function legacyFitScale(blocks) {
  if (!blocks?.length) return 1;
  let maxX = 0;
  let maxY = 0;
  blocks.forEach((b) => {
    maxX = Math.max(maxX, (b.x || 0) + (b.width || 300));
    maxY = Math.max(maxY, (b.y || 0) + (b.fontSize || 16) * 2);
  });
  if (maxX <= CANVAS_WIDTH && maxY <= CANVAS_HEIGHT) return 1;
  const sx = maxX > CANVAS_WIDTH ? (CANVAS_WIDTH - 20) / maxX : 1;
  const sy = maxY > CANVAS_HEIGHT ? (CANVAS_HEIGHT - 20) / maxY : 1;
  return Math.min(sx, sy);
}

// CSS for a text block in the read-only renderers.
export function blockTextStyle(block, scale = 1) {
  return {
    position: 'absolute',
    left: (block.x || 0) * scale,
    top: (block.y || 0) * scale,
    width: (block.width || 300) * scale,
    fontSize: Math.round((block.fontSize || 16) * scale),
    whiteSpace: 'pre-wrap',
    color: block.fill || DEFAULT_TEXT_COLOR,
    fontFamily: block.fontFamily || DEFAULT_FONT_FAMILY,
    fontWeight: block.fontWeight || 'normal',
    fontStyle: block.fontStyle || 'normal',
    textDecoration: block.underline ? 'underline' : 'none',
    textAlign: block.textAlign || 'left',
    lineHeight: block.lineHeight || DEFAULT_LINE_HEIGHT
  };
}

// CSS for a slide's background (flattened image fallback wins over colour).
export function slideBackgroundStyle(slide) {
  if (slide?.backgroundImageUrl) {
    return { backgroundImage: `url(${slide.backgroundImageUrl})`, backgroundSize: 'cover' };
  }
  if (slide?.backgroundColor) return { background: slide.backgroundColor };
  return undefined;
}
