// Pure edits on image blocks. Crops are fractions of the picture's
// natural size ({ x, y, w, h }); the block's own box is what shows.

const MIN_VISIBLE = 0.05;
const r4 = (v) => Math.round(v * 10000) / 10000;
const r1 = (v) => Math.round(v * 10) / 10;

export function cropInsets(block) {
  const c = block.crop && block.crop.w > 0 && block.crop.h > 0 ? block.crop : { x: 0, y: 0, w: 1, h: 1 };
  return { left: c.x, top: c.y, right: 1 - c.x - c.w, bottom: 1 - c.y - c.h };
}

// The block patch for new crop insets (each 0–1 of the picture). The
// picture stays where it is on the slide: trimming the left edge moves
// the box's left edge in, rather than sliding the picture.
export function cropPatch(block, insets) {
  const old = cropInsets(block);
  const next = { ...old, ...insets };
  for (const k of ['left', 'top', 'right', 'bottom']) next[k] = Math.max(0, Math.min(1 - MIN_VISIBLE, next[k] || 0));
  if (next.left + next.right > 1 - MIN_VISIBLE) next.right = 1 - MIN_VISIBLE - next.left;
  if (next.top + next.bottom > 1 - MIN_VISIBLE) next.bottom = 1 - MIN_VISIBLE - next.top;
  const oldW = 1 - old.left - old.right;
  const oldH = 1 - old.top - old.bottom;
  const height = block.height || block.width;
  const fullW = block.width / oldW;
  const fullH = height / oldH;
  const w = 1 - next.left - next.right;
  const h = 1 - next.top - next.bottom;
  const whole = next.left === 0 && next.top === 0 && w === 1 && h === 1;
  return {
    x: r1((block.x || 0) + (next.left - old.left) * fullW),
    y: r1((block.y || 0) + (next.top - old.top) * fullH),
    width: r1(w * fullW),
    height: r1(h * fullH),
    crop: whole ? null : { x: r4(next.left), y: r4(next.top), w: r4(w), h: r4(h) }
  };
}

// Swapping the picture keeps the box's width and centre, takes the new
// picture's proportions and drops the old crop.
export function replaceImagePatch(block, { dataUrl, width, height }) {
  const w = block.width || width;
  const h = Math.max(1, Math.round((w * height) / width));
  const cy = (block.y || 0) + (block.height || h) / 2;
  return { imageUrl: dataUrl, height: h, y: r1(cy - h / 2), crop: null };
}

// The picture at its natural proportions (undoing any stretching),
// keeping the box's width.
export function resetAspectPatch(block, natural) {
  const c = block.crop && block.crop.w > 0 ? block.crop : { w: 1, h: 1 };
  const ratio = (natural.height * c.h) / (natural.width * c.w);
  return { height: r1(block.width * ratio) };
}

// Images keep their proportions while resized unless the author turned
// that off.
export function keepsAspect(block) {
  return block.type === 'image' ? block.lockAspect !== false : !!block.lockAspect;
}
