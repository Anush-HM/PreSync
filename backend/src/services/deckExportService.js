import PptxGenJS from 'pptxgenjs';
import PDFDocument from 'pdfkit';

// Turns a deck's slides (the Deck model shape) back into files people
// can take elsewhere: a .pptx with real, editable text boxes, or a PDF.
// Both work from the 960×540 editor canvas, so positions carry over 1:1.

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
const DEFAULT_TEXT_COLOR = '#1a1a2e';
const DEFAULT_LINE_HEIGHT = 1.16;

// --- shared helpers -----------------------------------------------------

function sortedSlides(deck) {
  return [...(deck.slides || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function isHexColor(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

// Decodes an inline data: URL image. Remote URLs are skipped on export
// rather than fetched server-side.
function decodeDataUrl(url) {
  const match = /^data:(image\/(png|jpe?g|gif));base64,(.+)$/i.exec(url || '');
  if (!match) return null;
  return { mime: match[1].toLowerCase(), base64: match[3], buffer: Buffer.from(match[3], 'base64') };
}

// Rough text height so exported boxes are about as tall as their text.
function estimateTextHeight(block) {
  const fontSize = block.fontSize || 16;
  const lineHeight = fontSize * (block.lineHeight || DEFAULT_LINE_HEIGHT);
  const charsPerLine = Math.max(1, Math.floor((block.width || 300) / (fontSize * 0.5)));
  const lines = (block.text || '')
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return Math.ceil(lines * lineHeight);
}

export function exportFileName(title, ext) {
  const base = (title || 'deck').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, ' ').slice(0, 80) || 'deck';
  return `${base}.${ext}`;
}

// --- PPTX ---------------------------------------------------------------

// 16:9 layout is 10in × 5.625in, so 96 canvas px = 1in and 1px = 0.75pt.
const PX_PER_INCH = CANVAS_WIDTH / 10;
const inch = (px) => px / PX_PER_INCH;
const pt = (px) => Math.round(px * 0.75 * 10) / 10;

export async function exportDeckToPptx(deck) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = deck.title || 'PreSync deck';

  for (const s of sortedSlides(deck)) {
    const slide = pptx.addSlide();
    if (isHexColor(s.backgroundColor)) slide.background = { color: s.backgroundColor.slice(1) };
    if (s.notes) slide.addNotes(s.notes);

    for (const b of s.blocks || []) {
      if (b.type === 'image') {
        const img = decodeDataUrl(b.imageUrl);
        if (!img) continue;
        // Always pass w/h so pptxgenjs never has to sniff image sizes.
        slide.addImage({
          data: `${img.mime};base64,${img.base64}`,
          x: inch(b.x || 0),
          y: inch(b.y || 0),
          w: inch(b.width || 100),
          h: inch(b.height || b.width || 100)
        });
        continue;
      }
      if (!b.text) continue;
      slide.addText(b.text, {
        x: inch(b.x || 0),
        y: inch(b.y || 0),
        w: inch(b.width || 300),
        h: inch(estimateTextHeight(b)),
        fontSize: pt(b.fontSize || 16),
        fontFace: (b.fontFamily || 'Arial').split(',')[0].replace(/"/g, '').trim(),
        bold: b.fontWeight === 'bold',
        italic: b.fontStyle === 'italic',
        underline: b.underline ? { style: 'sng' } : undefined,
        color: (isHexColor(b.fill) ? b.fill : DEFAULT_TEXT_COLOR).slice(1),
        align: b.textAlign || 'left',
        valign: 'top',
        margin: 0,
        lineSpacingMultiple: b.lineHeight || undefined,
        fit: 'none'
      });
    }
  }

  return pptx.write({ outputType: 'nodebuffer' });
}

// --- PDF ----------------------------------------------------------------

// PDF uses the 14 standard fonts, so map each family to its closest one.
function pdfFont(block) {
  const family = (block.fontFamily || '').toLowerCase();
  const bold = block.fontWeight === 'bold';
  const italic = block.fontStyle === 'italic';
  if (/courier|mono/.test(family)) {
    return `Courier${bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''}`;
  }
  if (/times|georgia|serif/.test(family) && !/sans/.test(family)) {
    return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  }
  return `Helvetica${bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''}`;
}

// The standard fonts only cover Latin-1; swap anything else for '?'
// rather than letting it render as garbage.
function pdfSafeText(text) {
  return (text || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/•/g, '·')
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, '?');
}

export function exportDeckToPdf(deck) {
  const doc = new PDFDocument({
    size: [CANVAS_WIDTH, CANVAS_HEIGHT],
    margin: 0,
    autoFirstPage: false,
    info: { Title: deck.title || 'PreSync deck', Creator: 'PreSync' }
  });

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const slides = sortedSlides(deck);
  if (slides.length === 0) doc.addPage();

  for (const s of slides) {
    doc.addPage();
    doc.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).fill(isHexColor(s.backgroundColor) ? s.backgroundColor : '#ffffff');

    for (const b of s.blocks || []) {
      if (b.type === 'image') {
        const img = decodeDataUrl(b.imageUrl);
        // pdfkit embeds PNG and JPEG only.
        if (!img || img.mime === 'image/gif') continue;
        try {
          doc.image(img.buffer, b.x || 0, b.y || 0, { width: b.width || 100, height: b.height || undefined });
        } catch {
          // A corrupt image shouldn't sink the whole export.
        }
        continue;
      }
      if (!b.text) continue;
      const fontSize = b.fontSize || 16;
      doc
        .font(pdfFont(b))
        .fontSize(fontSize)
        .fillColor(isHexColor(b.fill) ? b.fill : DEFAULT_TEXT_COLOR)
        .text(pdfSafeText(b.text), b.x || 0, b.y || 0, {
          width: b.width || 300,
          // Bounded so overflowing text is cut at the slide edge instead
          // of spilling onto an extra page.
          height: Math.max(fontSize, CANVAS_HEIGHT - (b.y || 0)),
          align: b.textAlign || 'left',
          underline: !!b.underline,
          lineGap: Math.max(0, fontSize * ((b.lineHeight || DEFAULT_LINE_HEIGHT) - DEFAULT_LINE_HEIGHT)),
          lineBreak: true
        });
    }
  }

  doc.end();
  return done;
}
