import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Extracts real text content (not a flattened image) from a PDF, page by
// page, keeping each fragment's position, font size, and page number —
// then groups nearby fragments into logical text blocks. This is the
// piece that makes an uploaded deck genuinely editable instead of just
// a picture with text drawn on it.

// Heuristic grouping: fragments are folded into the same block when
// they're on the same page, vertically close, and similar in font size.
const VERTICAL_GAP_THRESHOLD = 10; // px, in PDF user-space units
const FONT_SIZE_TOLERANCE = 2; // px difference still considered "similar"

// The editor canvas is 960×540 (16:9). All coordinates are normalized to
// this target so imported content fits without clipping regardless of the
// PDF's original page size (letter 612×792, A4 595×842, widescreen, etc.)
const TARGET_WIDTH = 960;
const TARGET_HEIGHT = 540;

async function extractPageFragments(pdfDocument, pageNumber) {
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  // Compute a uniform scale factor that fits the PDF page inside the
  // 960×540 canvas while preserving aspect ratio. Any leftover space
  // (e.g. a 3:4 page inside a 16:9 canvas) is offset so the content
  // appears centered horizontally and pushed to the top vertically.
  const scaleX = TARGET_WIDTH / viewport.width;
  const scaleY = TARGET_HEIGHT / viewport.height;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (TARGET_WIDTH - viewport.width * scale) / 2;
  const offsetY = 0; // top-aligned; swap to centering with: (TARGET_HEIGHT - viewport.height * scale) / 2

  const fragments = textContent.items
    .filter((item) => item.str.trim().length > 0)
    .map((item) => {
      // item.transform = [scaleX, skewX, skewY, scaleY, x, y] in PDF space,
      // where y is measured from the bottom of the page. Flip to a
      // top-down y so it matches how the frontend positions blocks.
      const [, , , absScaleY, rawX, yFromBottom] = item.transform;
      const fontSize = Math.abs(absScaleY);
      const rawY = viewport.height - yFromBottom - fontSize;

      // Map from PDF space → editor canvas space
      return {
        text: item.str,
        x: rawX * scale + offsetX,
        y: rawY * scale + offsetY,
        fontSize: fontSize * scale,
        width: item.width * scale
      };
    });

  return { fragments, pageWidth: viewport.width, pageHeight: viewport.height };
}

function groupFragmentsIntoBlocks(fragments, pageIndex) {
  // Sort top-to-bottom, then left-to-right, so grouping walks the page
  // in natural reading order.
  const sorted = [...fragments].sort((a, b) => a.y - b.y || a.x - b.x);

  const blocks = [];
  let current = null;

  // Scale-aware gap threshold — since fragment positions are now in
  // 960×540 space, the vertical gap needs to be scaled up proportionally.
  const gapThreshold = VERTICAL_GAP_THRESHOLD * (TARGET_HEIGHT / 540);

  for (const frag of sorted) {
    const sameBlock =
      current &&
      Math.abs(frag.fontSize - current.fontSize) <= FONT_SIZE_TOLERANCE * 2 &&
      frag.y - current.bottomY <= gapThreshold;

    if (sameBlock) {
      current.lines.push(frag.text);
      current.bottomY = Math.max(current.bottomY, frag.y + frag.fontSize);
      current.right = Math.max(current.right, frag.x + frag.width);
      current.left = Math.min(current.left, frag.x);
      current.top = Math.min(current.top, frag.y);
    } else {
      current = {
        lines: [frag.text],
        fontSize: frag.fontSize,
        top: frag.y,
        bottomY: frag.y + frag.fontSize,
        left: frag.x,
        right: frag.x + frag.width
      };
      blocks.push(current);
    }
  }

  return blocks.map((b, i) => ({
    id: `p${pageIndex}-b${i}`,
    type: 'textbox',
    x: Math.round(b.left),
    y: Math.round(b.top),
    width: Math.max(80, Math.round(b.right - b.left)),
    fontSize: Math.round(b.fontSize),
    text: b.lines.join('\n')
  }));
}

// Main entry point: given a PDF as a Buffer, returns slides in the shape
// the frontend/editor and Deck model expect:
// { id, order, blocks: [{ id, type, x, y, width, fontSize, text }] }
export async function extractSlidesFromPdf(buffer) {
  const pdfDocument = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const slides = [];

  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    const { fragments } = await extractPageFragments(pdfDocument, pageNum);
    const blocks = groupFragmentsIntoBlocks(fragments, pageNum);

    const needsImageFallback = blocks.length === 0;

    slides.push({
      id: `slide-${pageNum}`,
      order: pageNum - 1,
      blocks,
      needsImageFallback
    });
  }

  await pdfDocument.destroy();
  return slides;
}