import { CANVAS_HEIGHT, CANVAS_WIDTH } from './slideFormat.js';

// Aligning and distributing elements. Works on boxes { id, x, y, w, h }
// (the editor measures them on the canvas, since a text box's height
// depends on its text) and returns { id: { x, y } } moves.

const round1 = (v) => Math.round(v * 10) / 10;

function bounds(boxes) {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y
  };
}

export const SLIDE_BOX = { x: 0, y: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT };

// mode: left | centre | right | top | middle | bottom. A single element
// aligns to the slide; several align to the box around them (or to the
// slide when `toSlide`).
export function alignBoxes(boxes, mode, toSlide = boxes.length < 2) {
  if (!boxes.length) return {};
  const ref = toSlide ? SLIDE_BOX : bounds(boxes);
  const out = {};
  for (const b of boxes) {
    let { x, y } = b;
    if (mode === 'left') x = ref.x;
    else if (mode === 'centre') x = ref.x + (ref.w - b.w) / 2;
    else if (mode === 'right') x = ref.x + ref.w - b.w;
    else if (mode === 'top') y = ref.y;
    else if (mode === 'middle') y = ref.y + (ref.h - b.h) / 2;
    else if (mode === 'bottom') y = ref.y + ref.h - b.h;
    out[b.id] = { x: round1(x), y: round1(y) };
  }
  return out;
}

// Spaces three or more elements evenly between the outermost two,
// horizontally ('horizontal') or vertically ('vertical'), keeping equal
// gaps between their edges.
export function distributeBoxes(boxes, axis) {
  if (boxes.length < 3) return {};
  const horizontal = axis === 'horizontal';
  const pos = horizontal ? 'x' : 'y';
  const size = horizontal ? 'w' : 'h';
  const sorted = [...boxes].sort((a, b) => a[pos] - b[pos]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last[pos] + last[size] - first[pos];
  const total = sorted.reduce((a, b) => a + b[size], 0);
  const gap = (span - total) / (sorted.length - 1);
  const out = {};
  let at = first[pos];
  for (const b of sorted) {
    out[b.id] = horizontal ? { x: round1(at), y: b.y } : { x: b.x, y: round1(at) };
    at += b[size] + gap;
  }
  return out;
}

// Moves the listed boxes by (dx, dy), kept on the slide.
export function nudgeBoxes(boxes, dx, dy) {
  const out = {};
  for (const b of boxes) {
    out[b.id] = {
      x: round1(Math.max(-b.w + 10, Math.min(CANVAS_WIDTH - 10, b.x + dx))),
      y: round1(Math.max(-b.h + 10, Math.min(CANVAS_HEIGHT - 10, b.y + dy)))
    };
  }
  return out;
}

// Every block that shares a group with one of `ids`.
export function expandToGroups(blocks, ids) {
  const groups = new Set(blocks.filter((b) => ids.includes(b.id) && b.groupId).map((b) => b.groupId));
  if (!groups.size) return ids;
  return blocks.filter((b) => ids.includes(b.id) || (b.groupId && groups.has(b.groupId))).map((b) => b.id);
}
