// Smart guides: while an element is dragged, its edges and centre snap
// to the slide's edges and centre and to the other elements' edges and
// centres. Boxes are { left, top, width, height } in canvas pixels.

export const SNAP_THRESHOLD = 6;

const lines = (b, start, size) => [b[start], b[start] + b[size] / 2, b[start] + b[size]];

// The closest line (of `targets`) to any of the moving box's lines on one
// axis, within `threshold`. Returns { delta, at, hits } or null.
function nearest(box, targets, start, size, threshold) {
  const own = lines(box, start, size);
  let best = null;
  for (const t of targets) {
    for (const line of lines(t, start, size)) {
      for (const edge of own) {
        const d = line - edge;
        if (Math.abs(d) > threshold) continue;
        if (!best || Math.abs(d) < Math.abs(best.delta) - 0.01) best = { delta: d, at: line, hits: [t] };
        else if (Math.abs(d - best.delta) < 0.01 && Math.abs(line - best.at) < 0.01) best.hits.push(t);
      }
    }
  }
  return best;
}

// How far to move `box` so it lines up, and the guide lines to draw.
// `frame` is the slide; `others` are the elements not being dragged.
export function snapBox(box, others, frame, threshold = SNAP_THRESHOLD) {
  const targets = [frame, ...others];
  const x = nearest(box, targets, 'left', 'width', threshold);
  const y = nearest(box, targets, 'top', 'height', threshold);
  const dx = x ? x.delta : 0;
  const dy = y ? y.delta : 0;
  const moved = { ...box, left: box.left + dx, top: box.top + dy };
  const guides = [];
  // A guide runs the length of everything it lines up, or the whole
  // slide when it is one of the slide's own lines.
  if (x) {
    const span = x.hits.includes(frame) ? [frame] : [moved, ...x.hits];
    guides.push({ axis: 'x', at: x.at, from: Math.min(...span.map((b) => b.top)), to: Math.max(...span.map((b) => b.top + b.height)) });
  }
  if (y) {
    const span = y.hits.includes(frame) ? [frame] : [moved, ...y.hits];
    guides.push({ axis: 'y', at: y.at, from: Math.min(...span.map((b) => b.left)), to: Math.max(...span.map((b) => b.left + b.width)) });
  }
  return { dx, dy, guides };
}
