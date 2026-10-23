import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportDeckToPdf, exportDeckToPptx, exportFileName } from './deckExportService.js';
import { extractSlidesFromPptx } from './pptxIngestService.js';
import { extractSlidesFromPdf } from './pdfIngestService.js';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

const deck = {
  title: 'Q3 / Review: “final”',
  slides: [
    {
      id: 's2',
      order: 1,
      notes: '',
      blocks: [{ id: 'c', type: 'textbox', x: 50, y: 50, width: 400, fontSize: 20, text: 'Second' }]
    },
    {
      id: 's1',
      order: 0,
      backgroundColor: '#112233',
      notes: 'Speaker note here',
      blocks: [
        {
          id: 'a', type: 'textbox', x: 96, y: 48, width: 768, fontSize: 48, text: 'Big title',
          fontWeight: 'bold', fontStyle: 'italic', underline: true, fill: '#e74c3c', textAlign: 'center',
          fontFamily: 'Georgia, serif'
        },
        { id: 'b', type: 'textbox', x: 96, y: 192, width: 576, fontSize: 24, text: 'Body “quoted” text' },
        { id: 'img', type: 'image', x: 768, y: 384, width: 96, height: 96, fontSize: 16, text: '', imageUrl: PNG_DATA_URL },
        { id: 'remote', type: 'image', x: 0, y: 0, width: 50, height: 50, fontSize: 16, text: '', imageUrl: 'https://example.com/x.png' }
      ]
    }
  ]
};

describe('exportDeckToPptx', () => {
  it('writes editable text with formatting that imports back the same', async () => {
    const buffer = await exportDeckToPptx(deck);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    const slides = await extractSlidesFromPptx(buffer);
    expect(slides).toHaveLength(2);
    const [first, second] = slides; // sorted by order

    expect(first.backgroundColor).toBe('#112233');
    expect(first.notes).toBe('Speaker note here');
    expect(first.blocks.find((b) => b.text === 'Big title')).toMatchObject({
      x: 96, y: 48, width: 768, fontSize: 48,
      fontWeight: 'bold', fontStyle: 'italic', underline: true, fill: '#e74c3c', textAlign: 'center',
      fontFamily: 'Georgia'
    });
    expect(first.blocks.find((b) => b.type === 'image')).toMatchObject({ x: 768, y: 384, width: 96, height: 96 });
    // Remote image URLs are skipped rather than fetched.
    expect(first.blocks.filter((b) => b.type === 'image')).toHaveLength(1);
    expect(second.blocks.map((b) => b.text)).toEqual(['Second']);
  });
});

describe('exportDeckToPdf', () => {
  it('writes one 960×540 page per slide in order, with the text', async () => {
    const buffer = await exportDeckToPdf(deck);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');

    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
    expect(pdf.numPages).toBe(2);
    const page = await pdf.getPage(1);
    const { width, height } = page.getViewport({ scale: 1 });
    expect([width, height]).toEqual([960, 540]);
    await pdf.destroy();

    const slides = await extractSlidesFromPdf(buffer);
    const texts = slides.map((s) => s.blocks.map((b) => b.text).join(' | '));
    expect(texts[0]).toContain('Big title');
    expect(texts[0]).toContain('Body "quoted" text');
    expect(texts[1]).toContain('Second');
    const title = slides[0].blocks.find((b) => b.text === 'Big title');
    expect(Math.abs(title.y - 48)).toBeLessThan(20);
  });

  it('still produces a valid one-page PDF for an empty deck', async () => {
    const buffer = await exportDeckToPdf({ title: 'Empty', slides: [] });
    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
    expect(pdf.numPages).toBe(1);
    await pdf.destroy();
  });
});

describe('exportFileName', () => {
  it('strips characters that are unsafe in a download name', () => {
    expect(exportFileName('Q3 / Review: “final”', 'pdf')).toBe('Q3 Review final.pdf');
    expect(exportFileName('', 'pptx')).toBe('deck.pptx');
  });
});
