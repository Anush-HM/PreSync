// Shared defaults and option lists for slide/block formatting, used by
// the editor toolbar and by every read-only slide renderer so a block
// looks the same in the editor, presenter view and viewer view.

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 540;

// Common presentation aspect ratios. width/height are in the same
// logical-pixel space as CANVAS_WIDTH / CANVAS_HEIGHT (960x540 baseline).
export const ASPECT_RATIOS = [
  { label: 'Widescreen 16:9 (Default)', width: 960,  height: 540 },
  { label: 'Standard 4:3',              width: 960,  height: 720 },
  { label: 'A4 Landscape',              width: 960,  height: 680 },
];

export const DEFAULT_TEXT_COLOR = '#1a1a2e';
export const DEFAULT_SLIDE_BACKGROUND = '#ffffff';
export const DEFAULT_FONT_FAMILY = 'Public Sans, sans-serif';
export const DEFAULT_LINE_HEIGHT = 1.16; // Fabric's Textbox default
// Fabric spaces lines at fontSize × 1.13 × lineHeight; CSS at fontSize ×
// line-height. Renderers multiply by this so both wrap and stack alike.
export const FABRIC_LINE_MULT = 1.13;

// Office fonts list a metric-compatible open font (loaded in index.html)
// second, so imported text wraps where it did in the source on machines
// without the Microsoft font. Keep in step with backend drawingml.js.
export const FONT_FAMILIES = [
  { label: 'Public Sans', value: DEFAULT_FONT_FAMILY },
  { label: 'Arial', value: 'Arial, Arimo, Helvetica, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif' },
  { label: 'Cambria', value: 'Cambria, Caladea, Georgia, serif' },
  { label: 'Georgia', value: 'Georgia, Gelasio, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Tinos, Times, serif' },
  { label: 'Courier New', value: '"Courier New", Cousine, Courier, monospace' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' }
];

// The first family of a CSS font stack, unquoted ("Times New Roman").
export function primaryFont(stack) {
  return (stack || '').split(',')[0].replace(/["']/g, '').trim();
}

// The FONT_FAMILIES entry a stack belongs to, matching on the first
// family so older stacks ("Georgia, serif") still find theirs.
export function fontOption(stack) {
  const first = primaryFont(stack).toLowerCase();
  return FONT_FAMILIES.find((f) => primaryFont(f.value).toLowerCase() === first) || null;
}

export const TEXT_ALIGNMENTS = ['left', 'center', 'right', 'justify'];

export const TEXT_COLORS = ['#1a1a2e', '#e74c3c', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ffffff'];

export const SLIDE_BACKGROUNDS = ['#ffffff', '#f5f5f0', '#1a1a2e', '#0f3460', '#fdf2e9', '#eafaf1'];

// Decks imported before PDF coordinates were normalized can have blocks
// that start outside the canvas. Returns the uniform scale that fits
// them. A box merely running past the edge is no sign of that (imported
// text boxes leave room to spare), and scaling it would pull the text
// off the slide's background picture.
export function legacyFitScale(blocks, canvasWidth = CANVAS_WIDTH, canvasHeight = CANVAS_HEIGHT) {
  if (!blocks?.some((b) => (b.x || 0) >= canvasWidth || (b.y || 0) >= canvasHeight)) return 1;
  let maxX = 0;
  let maxY = 0;
  blocks.forEach((b) => {
    maxX = Math.max(maxX, (b.x || 0) + (b.width || 300));
    maxY = Math.max(maxY, (b.y || 0) + (b.fontSize || 16) * 2);
  });
  const sx = maxX > canvasWidth ? (canvasWidth - 20) / maxX : 1;
  const sy = maxY > canvasHeight ? (canvasHeight - 20) / maxY : 1;
  return Math.min(sx, sy);
}

function textDecoration(style) {
  const parts = [];
  if (style.underline) parts.push('underline');
  if (style.linethrough) parts.push('line-through');
  return parts.length ? parts.join(' ') : 'none';
}

// CSS for a block's (or table cell's) own text formatting.
export function textFormatCss(block, scale = 1) {
  return {
    fontSize: (block.fontSize || 16) * scale,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    color: block.fill || DEFAULT_TEXT_COLOR,
    fontFamily: block.fontFamily || DEFAULT_FONT_FAMILY,
    fontWeight: block.fontWeight || 'normal',
    fontStyle: block.fontStyle || 'normal',
    textDecoration: textDecoration(block),
    textAlign: block.textAlign || 'left',
    lineHeight: (block.lineHeight || DEFAULT_LINE_HEIGHT) * FABRIC_LINE_MULT
  };
}

// CSS for one styled run inside a block (only the keys it overrides).
export function runCss(style, scale = 1) {
  const css = {};
  if (style.fontSize) css.fontSize = style.fontSize * scale;
  if (style.fontFamily) css.fontFamily = style.fontFamily;
  if (style.fontWeight) css.fontWeight = style.fontWeight;
  if (style.fontStyle) css.fontStyle = style.fontStyle;
  if (style.fill) css.color = style.fill;
  if (style.underline !== undefined || style.linethrough !== undefined) css.textDecoration = textDecoration(style);
  if (style.textBackgroundColor) css.backgroundColor = style.textBackgroundColor;
  // Superscript/subscript: Fabric shifts the run by deltaY px (negative is up).
  if (style.deltaY) {
    css.position = 'relative';
    css.top = style.deltaY * scale;
  }
  return css;
}

// CSS for an image block in the read-only renderers: its box, opacity,
// border and shadow. Cropping is drawn by imageCropCss on the picture.
export function imageBoxCss(b, s) {
  const css = {
    position: 'absolute',
    left: (b.x || 0) * s,
    top: (b.y || 0) * s,
    width: (b.width || 300) * s,
    height: b.height ? b.height * s : 'auto',
    transform: blockTransform(b),
    overflow: 'hidden'
  };
  if (b.opacity !== undefined && b.opacity < 1) css.opacity = b.opacity;
  if (b.stroke && b.strokeWidth) {
    css.outline = `${b.strokeWidth * s}px solid ${b.stroke}`;
    css.outlineOffset = `${-b.strokeWidth * s}px`;
  }
  if (b.shadow?.color) css.filter = `drop-shadow(${(b.shadow.x ?? 0) * s}px ${(b.shadow.y ?? 4) * s}px ${(b.shadow.blur ?? 8) * s}px ${shadowColor(b.shadow)})`;
  return css;
}

export function shadowColor(shadow) {
  const c = shadow?.color || '#000000';
  const a = shadow?.opacity ?? 0.35;
  if (!/^#[0-9a-f]{6}$/i.test(c)) return c;
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// The picture inside a cropped image block: drawn at its full size and
// shifted so only the crop shows through the box.
export function imageCropCss(b, s) {
  const c = b.crop;
  if (!c || !(c.w > 0) || !(c.h > 0) || !b.height) return { width: '100%', height: '100%', objectFit: 'fill', display: 'block' };
  const fullW = ((b.width || 300) * s) / c.w;
  const fullH = (b.height * s) / c.h;
  return { position: 'absolute', left: -c.x * fullW, top: -c.y * fullH, width: fullW, height: fullH, maxWidth: 'none', display: 'block' };
}

// Splits text into runs by its `styles` ranges ([{ start, end, style }],
// indices counting characters but not line breaks — Fabric's format).
// Returns [{ text, style }] where style is null for unstyled text and
// line breaks stay inside the run text.
export function styledRuns(text, styles) {
  const chars = Array.from(text || '');
  if (!Array.isArray(styles) || styles.length === 0) return [{ text: text || '', style: null }];
  const sorted = [...styles].filter((r) => r && r.end > r.start).sort((a, b) => a.start - b.start);
  const runs = [];
  let index = 0; // character index, not counting line breaks
  let r = 0;
  let current = null;
  for (const ch of chars) {
    let style = null;
    if (ch !== '\n') {
      while (r < sorted.length && sorted[r].end <= index) r += 1;
      if (sorted[r] && sorted[r].start <= index && index < sorted[r].end) style = sorted[r].style;
      index += 1;
    } else {
      style = current ? current.style : null; // keep line breaks with the run they end
    }
    if (current && current.style === style) current.text += ch;
    else {
      current = { text: ch, style };
      runs.push(current);
    }
  }
  return runs;
}

// A list marker at the start of a paragraph, as imported: optional
// indent, a bullet or number, then non-breaking spaces up to the text.
// Wrapped lines of such a paragraph hang under the text, not the marker.
export const LIST_PREFIX = /^\u00a0*(?:[\u2022\u25aa\u25ab\u27a4\u279c\u2713\u25a0\u25a1\u25cf\u25cb\u25c6\u25c7\u2666\u2013\-*]|\(?(?:\d{1,3}|[a-zA-Z]|[ivxlcdmIVXLCDM]{1,6})[.)])\u00a0+/u;

// Runs split into hard lines (paragraphs), each [{ text, style }].
export function paragraphRuns(text, styles) {
  const lines = [[]];
  for (const run of styledRuns(text, styles)) {
    run.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, style: run.style });
    });
  }
  return lines;
}

// Splits a line's runs after its first `n` characters.
export function splitRuns(runs, n) {
  const head = [];
  const tail = [];
  let left = n;
  for (const run of runs) {
    const chars = Array.from(run.text);
    if (left >= chars.length) {
      head.push(run);
      left -= chars.length;
    } else if (left > 0) {
      head.push({ text: chars.slice(0, left).join(''), style: run.style });
      tail.push({ text: chars.slice(left).join(''), style: run.style });
      left = 0;
    } else tail.push(run);
  }
  return [head, tail];
}

// CSS rotate/flip for a block, about its centre (the editor's convention).
export function blockTransform(block) {
  const parts = [];
  if (block.rotation) parts.push(`rotate(${block.rotation}deg)`);
  if (block.flipH) parts.push('scaleX(-1)');
  if (block.flipV) parts.push('scaleY(-1)');
  return parts.length ? parts.join(' ') : undefined;
}

// CSS for a text block in the read-only renderers.
export function blockTextStyle(block, scale = 1) {
  const css = {
    position: 'absolute',
    left: (block.x || 0) * scale,
    top: (block.y || 0) * scale,
    width: (block.width || 300) * scale,
    ...textFormatCss(block, scale),
    transform: blockTransform({ rotation: block.rotation })
  };
  if (block.verticalAlign && block.verticalAlign !== 'top' && block.height) {
    css.height = block.height * scale;
    css.display = 'flex';
    css.flexDirection = 'column';
    css.justifyContent = block.verticalAlign === 'middle' ? 'center' : 'flex-end';
  }
  return css;
}

export function gradientCss(gradient) {
  if (!gradient?.stops?.length) return null;
  const stops = gradient.stops.map((s) => `${s.color} ${Math.round((s.pos || 0) * 1000) / 10}%`).join(', ');
  return `linear-gradient(${gradient.angle ?? 180}deg, ${stops})`;
}

// CSS for a slide's background: a picture (stretched over the slide, as
// in PowerPoint, or tiled), else a gradient, else a colour.
export function slideBackgroundStyle(slide) {
  // Longhand properties only, so switching between kinds never leaves a
  // stale shorthand behind.
  const css = { backgroundColor: slide?.backgroundColor || undefined, backgroundImage: 'none' };
  if (slide?.backgroundImageUrl) {
    css.backgroundImage = `url(${slide.backgroundImageUrl})`;
    css.backgroundSize = slide.backgroundRepeat ? 'auto' : '100% 100%';
    css.backgroundRepeat = slide.backgroundRepeat ? 'repeat' : 'no-repeat';
    return css;
  }
  const gradient = gradientCss(slide?.backgroundGradient);
  if (gradient) css.backgroundImage = gradient;
  if (!css.backgroundColor && !gradient) return undefined;
  return css;
}

// The name a slide goes by in lists: the name given to it, else its
// title block's first line, or "Slide N" when it has none.
export function slideTitle(slide, index) {
  if (typeof slide?.name === 'string' && slide.name.trim()) return slide.name.trim();
  const title = (slide?.blocks || []).find((b) => b.role === 'title' && b.text?.trim());
  const line = title?.text.split('\n').map((l) => l.replace(/\u00a0/g, ' ').trim()).find(Boolean);
  return line || `Slide ${index + 1}`;
}
