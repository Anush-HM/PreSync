// Image work shared by the importers: cropping (PowerPoint's srcRect),
// downscaling oversized pictures to what the 960×540 canvas can show,
// and rendering PDF pages. Uses @napi-rs/canvas when it is installed;
// without it, pictures are kept as they are and page renders are
// skipped, and callers report that rather than failing.

let canvasModule;

export async function loadCanvas() {
  if (canvasModule === undefined) {
    try {
      canvasModule = await import('@napi-rs/canvas');
    } catch {
      canvasModule = null;
    }
  }
  return canvasModule;
}

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp'
};

// Formats a browser can draw directly.
export const WEB_IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
// Formats we can decode and re-encode as PNG when the canvas module is present.
const DECODABLE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

export function mimeForExt(ext) {
  return MIME[ext] || null;
}

export function toDataUrl(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function hasTransparency(ctx, width, height) {
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 16) if (data[i] < 250) return true;
  return false;
}

// Crops (fractions 0–1 of each edge) and scales a picture so its longest
// side is at most `maxSide` pixels, then re-encodes it. Returns
// { buffer, mime, cropped } or null when it can't (no canvas module,
// undecodable data); callers then fall back to the original bytes.
export async function processImage(buffer, ext, { crop = null, maxSide = 1600, maxBytes = 1.5 * 1024 * 1024 } = {}) {
  const needsCrop = crop && (crop.l || crop.t || crop.r || crop.b);
  const isWeb = WEB_IMAGE_EXT.has(ext);
  if (ext === 'svg') return null; // vector: never needs it
  if (!needsCrop && isWeb && buffer.length <= maxBytes / 3) return null; // small enough as is
  if (!DECODABLE_EXT.has(ext)) return null;
  const mod = await loadCanvas();
  if (!mod) return null;
  let img;
  try {
    img = new mod.Image();
    img.src = buffer;
  } catch {
    return null;
  }
  if (!img.width || !img.height) return null;
  const c = crop || { l: 0, t: 0, r: 0, b: 0 };
  // Negative crop values extend the picture with empty space.
  const sx = Math.max(0, c.l) * img.width;
  const sy = Math.max(0, c.t) * img.height;
  const sw = Math.max(1, img.width * (1 - Math.max(0, c.l) - Math.max(0, c.r)));
  const sh = Math.max(1, img.height * (1 - Math.max(0, c.t) - Math.max(0, c.b)));
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = mod.createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const alpha = hasTransparency(ctx, w, h);
  let out = alpha ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', 88);
  let mime = alpha ? 'image/png' : 'image/jpeg';
  if (alpha && out.length > maxBytes) {
    // Large transparent picture: halve until it fits.
    let s = 0.7;
    while (out.length > maxBytes && s > 0.1) {
      const small = mod.createCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
      small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
      out = small.toBuffer('image/png');
      s *= 0.7;
    }
  } else if (!alpha && out.length > maxBytes) {
    out = canvas.toBuffer('image/jpeg', 70);
    mime = 'image/jpeg';
  }
  return { buffer: out, mime, cropped: !!needsCrop };
}
