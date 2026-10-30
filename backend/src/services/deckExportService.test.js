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

    const { slides } = await extractSlidesFromPptx(buffer);
    expect(slides).toHaveLength(2);
    const [first, second] = slides; // sorted by order

    expect(first.backgroundColor).toBe('#112233');
    expect(first.notes).toBe('Speaker note here');
    expect(first.blocks.find((b) => b.text === 'Big title')).toMatchObject({
      x: 96, y: 48, width: 768, fontSize: 48,
      fontWeight: 'bold', fontStyle: 'italic', underline: true, fill: '#e74c3c', textAlign: 'center',
      fontFamily: expect.stringMatching(/^Georgia,/)
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

    const { slides } = await extractSlidesFromPdf(buffer);
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

describe('export of imported content', () => {
  const rich = {
    title: 'Rich',
    slides: [
      {
        id: 'r1',
        order: 0,
        backgroundGradient: { angle: 180, stops: [{ pos: 0, color: '#224433' }, { pos: 1, color: '#112233' }] },
        blocks: [
          {
            id: 't', type: 'textbox', x: 60, y: 40, width: 600, fontSize: 20, fill: '#ffffff', fontFamily: 'Arial, sans-serif',
            text: 'Lead: rest\nSecond line',
            styles: [{ start: 0, end: 5, style: { fontWeight: 'bold', fill: '#ffcc00' } }]
          },
          { id: 's', type: 'shape', shape: 'path', path: 'M500 0 L1000 1000 L0 1000 Z', x: 700, y: 40, width: 100, height: 80, background: '#c01f2f', stroke: '#000000', strokeWidth: 2, rotation: 15 },
          { id: 'e', type: 'shape', shape: 'ellipse', x: 820, y: 40, width: 80, height: 80, fillGradient: { angle: 90, stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#000000' }] } },
          {
            id: 'tb', type: 'table', x: 60, y: 200, width: 400, height: 80, fontSize: 16, text: 'A\tB\nC',
            table: {
              columns: [200, 200],
              rows: [
                { height: 40, cells: [
                  { text: 'A', fontWeight: 'bold', background: '#d9e2f3', borders: { top: { color: '#000000', width: 1 }, bottom: null, left: null, right: null } },
                  { text: 'B' }
                ] },
                { height: 40, cells: [{ text: 'C', colspan: 2 }, { text: '', covered: true }] }
              ]
            }
          }
        ]
      }
    ]
  };

  it('keeps mixed formatting, shapes and tables in PowerPoint', async () => {
    const { slides: [slide] } = await extractSlidesFromPptx(await exportDeckToPptx(rich));
    const text = slide.blocks.find((b) => b.type === 'textbox' && b.text.startsWith('Lead'));
    expect(text.text).toBe('Lead: rest\nSecond line');
    const boldRange = text.styles.find((r) => r.style.fontWeight === 'bold');
    expect(boldRange).toMatchObject({ start: 0, end: 5 });
    expect(slide.blocks.find((b) => b.type === 'shape' && b.background === '#c01f2f')).toMatchObject({ rotation: 15 });
    const table = slide.blocks.find((b) => b.type === 'table');
    expect(table.table.rows[0].cells[0]).toMatchObject({ text: 'A', background: '#d9e2f3' });
    expect(table.table.rows[1].cells[0].colspan).toBe(2);
  });

  it('draws the same content into the PDF', async () => {
    const buffer = await exportDeckToPdf(rich);
    const pdf = await getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
    const page = await pdf.getPage(1);
    const items = (await page.getTextContent()).items.map((i) => i.str).join('|');
    expect(items).toMatch(/Lead:/);
    expect(items).toMatch(/Second line/);
    expect(items).toMatch(/A.*B.*C/);
  });
});

describe('export size', () => {
  const shaped = { ...deck, canvasWidth: 960, canvasHeight: 720 };

  it('keeps a 4:3 deck 4:3 in PowerPoint', async () => {
    const { canvasWidth, canvasHeight } = await extractSlidesFromPptx(await exportDeckToPptx(shaped));
    expect([canvasWidth, canvasHeight]).toEqual([960, 720]);
  });

  it('keeps a 4:3 deck 4:3 in PDF', async () => {
    const { canvasWidth, canvasHeight } = await extractSlidesFromPdf(await exportDeckToPdf(shaped));
    expect([canvasWidth, canvasHeight]).toEqual([960, 720]);
  });
});
