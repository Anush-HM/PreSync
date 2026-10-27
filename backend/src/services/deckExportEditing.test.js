import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportDeckToPdf, exportDeckToPptx, pptxImageOptions } from './deckExportService.js';
import { extractSlidesFromPptx } from './pptxIngestService.js';
import { blockToPlain, plainToBlockMap, plainToSlideMap, slideToPlain } from '../yjs/docManager.js';
import * as Y from 'yjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

// Fields the Phase 2 editor writes: crops, picture effects, highlights,
// super/subscript, locks, groups and hidden, named slides.
const deck = {
  title: 'Editing',
  slides: [
    {
      id: 's1', order: 0, name: 'Intro', theme: 'ember', layout: 'title',
      blocks: [
        {
          id: 'img', type: 'image', x: 100, y: 100, width: 300, height: 150, fontSize: 16, text: '', imageUrl: PNG,
          crop: { x: 0.25, y: 0, w: 0.75, h: 1 }, opacity: 0.5, alt: 'A green field', shadow: { color: '#000000', blur: 8, x: 0, y: 4, opacity: 0.3 },
          locked: true, groupId: 'g1'
        },
        {
          id: 't', type: 'textbox', x: 50, y: 300, width: 500, fontSize: 24, text: 'E=mc2 marked', textBackgroundColor: '#fff3a3',
          styles: [{ start: 4, end: 5, style: { fontSize: 14, deltaY: -8 } }], groupId: 'g1'
        }
      ]
    },
    { id: 's2', order: 1, hidden: true, blocks: [{ id: 'h', type: 'textbox', x: 50, y: 50, width: 300, fontSize: 20, text: 'Backup slide' }] }
  ]
};

describe('export of editor fields', () => {
  it('crops pictures in PowerPoint without moving them', () => {
    const o = pptxImageOptions(deck.slides[0].blocks[0]);
    // The visible box stays 300×150 px at (100, 100); the full picture is 400 px wide.
    expect(o.sizing).toMatchObject({ type: 'crop', w: 300 / 96, h: 150 / 96 });
    expect(o.sizing.x).toBeCloseTo((0.25 * 400) / 96, 5);
    expect(o.w).toBeCloseTo(400 / 96, 5);
    expect(o).toMatchObject({ transparency: 50, altText: 'A green field' });
    expect(o.shadow).toMatchObject({ type: 'outer', color: '000000', opacity: 0.3 });
  });

  it('writes crop, alt text, highlight, superscript and hidden slides to the .pptx', async () => {
    const buffer = await exportDeckToPptx(deck);
    const zip = await JSZip.loadAsync(buffer);
    const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
    const s2 = await zip.file('ppt/slides/slide2.xml').async('string');
    expect(s1).toMatch(/<a:srcRect l="25000" r="0" t="0" b="0"\/>/);
    expect(s1).toContain('descr="A green field"');
    expect(s1).toContain('<a:highlight><a:srgbClr val="FFF3A3"/></a:highlight>');
    expect(s1).toMatch(/baseline="30000"/);
    expect(s2).toContain('show="0"');
    // The cropped picture still lands where it was on the slide.
    const [slide] = await extractSlidesFromPptx(buffer);
    expect(slide.blocks.find((b) => b.type === 'image')).toMatchObject({ x: 100, y: 100, width: 300, height: 150 });
  });

  it('leaves hidden slides out of the PDF', async () => {
    const pdf = await getDocument({ data: new Uint8Array(await exportDeckToPdf(deck)) }).promise;
    expect(pdf.numPages).toBe(1);
    await pdf.destroy();
  });

  it('keeps the new fields through the live collaboration document', () => {
    const doc = new Y.Doc();
    const arr = doc.getArray('x');
    arr.push([plainToBlockMap(deck.slides[0].blocks[0])]);
    expect(blockToPlain(arr.get(0))).toMatchObject({ crop: { x: 0.25, y: 0, w: 0.75, h: 1 }, alt: 'A green field', locked: true, groupId: 'g1' });
    arr.push([plainToSlideMap(deck.slides[1])]);
    expect(slideToPlain(arr.get(1))).toMatchObject({ hidden: true, id: 's2' });
    arr.push([plainToSlideMap(deck.slides[0])]);
    expect(slideToPlain(arr.get(2))).toMatchObject({ name: 'Intro', theme: 'ember', layout: 'title' });
  });
});
