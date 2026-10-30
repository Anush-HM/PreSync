import { describe, expect, it } from 'vitest';
import PDFDocument from 'pdfkit';
import { extractSlidesFromPdf } from './pdfIngestService.js';

function makePdf(draw) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: [720, 405], margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    draw(doc);
    doc.end();
  });
}

const blockWith = (slide, text) => slide.blocks.find((b) => b.text.includes(text));

describe('PDF import alignment', () => {
  it('centres single-line table cells that share a column centre', async () => {
    const buffer = await makePdf((doc) => {
      doc.font('Helvetica').fontSize(14);
      ['Backend', 'FastAPI', 'PyJWT + bcrypt'].forEach((t, i) => doc.text(t, 40, 80 + i * 40, { width: 200, align: 'center', lineBreak: false }));
    });
    const { slides } = await extractSlidesFromPdf(buffer);
    for (const text of ['Backend', 'FastAPI', 'PyJWT + bcrypt']) {
      const b = blockWith(slides[0], text);
      expect(b.textAlign).toBe('center');
      expect(b.x + b.width / 2).toBeCloseTo((40 + 100) * (960 / 720), 0);
    }
  });

  it('gives unevenly spaced rows their own boxes, so none drifts off its place', async () => {
    const rows = [[80, 'First row'], [100, 'Second row'], [128, 'Third row'], [146, 'Fourth row']];
    const buffer = await makePdf((doc) => {
      doc.font('Helvetica').fontSize(14);
      rows.forEach(([y, t]) => doc.text(t, 40, y, { lineBreak: false }));
    });
    const { slides } = await extractSlidesFromPdf(buffer);
    const first = blockWith(slides[0], 'First row');
    const third = blockWith(slides[0], 'Third row');
    expect(third).not.toBe(first);
    expect(third.y - first.y).toBeCloseTo(48 * (960 / 720), 0);
  });

  it('keeps an evenly spaced paragraph in one box with room to spare', async () => {
    const buffer = await makePdf((doc) => {
      doc.font('Helvetica').fontSize(14);
      ['One line of a paragraph here', 'Another line of that paragraph', 'And the last line of it'].forEach((t, i) => doc.text(t, 40, 80 + i * 18, { lineBreak: false }));
    });
    const { slides } = await extractSlidesFromPdf(buffer);
    const b = blockWith(slides[0], 'One line');
    expect(b.text.split('\n')).toHaveLength(3);
    expect(b.width).toBeGreaterThan(190 * (960 / 720) * 1.2);
  });
});
