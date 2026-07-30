import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Extracts real text content (not a flattened image) from a PDF, page by
// page, keeping each fragment's position, font size, and page number —
// then groups nearby fragments into logical text blocks. This is the
// piece that makes an uploaded deck genuinely editable instead of just
// a picture with text drawn on it.

// Heuristic grouping: fragments are folded into the same block when
// they're on the same page, vertically close, and similar in font size.
// Two knobs control this — tune them here if extraction looks too
// fragmented (blocks split that should be one) or too merged (unrelated
// lines glued together).
const VERTICAL_GAP_THRESHOLD = 10; // px, in PDF user-space units
const FONT_SIZE_TOLERANCE = 2; // px difference still considered "similar"

async function extractPageFragments(pdfDocument, pageNumber) {
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  const fragments = textContent.items
    .filter((item) => item.str.trim().length > 0)
    .map((item) => {
      // item.transform = [scaleX, skewX, skewY, scaleY, x, y] in PDF space,
      // where y is measured from the bottom of the page. Flip to a
      // top-down y so it matches how the frontend positions blocks.
      const [, , , scaleY, x, yFromBottom] = item.transform;
      const fontSize = Math.abs(scaleY);
      const y = viewport.height - yFromBottom - fontSize;
      return { text: item.str, x, y, fontSize, width: item.width };
    });

  return { fragments, pageWidth: viewport.width, pageHeight: viewport.height };
}

function groupFragmentsIntoBlocks(fragments, pageIndex) {
  // Sort top-to-bottom, then left-to-right, so grouping walks the page
  // in natural reading order.
  const sorted = [...fragments].sort((a, b) => a.y - b.y || a.x - b.x);

  const blocks = [];
  let current = null;

  for (const frag of sorted) {
    const sameBlock =
      current &&
      Math.abs(frag.fontSize - current.fontSize) <= FONT_SIZE_TOLERANCE &&
      frag.y - current.bottomY <= VERTICAL_GAP_THRESHOLD;

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

    // Pages with no cleanly extracted text (pure image slides, or a
    // rendering pdf.js can't parse into positioned glyphs — e.g. some
    // multi-column or heavily designed layouts) fall back to a flattened
    // background rather than an empty slide. Actually rendering that
    // fallback image is a follow-up step (page -> canvas -> PNG); for now
    // we flag it so the caller/UI knows to treat this slide as
    // non-editable until that's wired in.
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