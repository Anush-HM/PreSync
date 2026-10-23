import { describe, expect, it } from 'vitest';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { readFile } from 'fs/promises';
import { extractSlidesFromPptx, PptxParseError } from './pptxIngestService.js';

// 1×1 red PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

async function buildPptx() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9'; // 10in × 5.625in -> 96px per inch on the 960 canvas

  const s1 = pptx.addSlide();
  s1.background = { color: '112233' };
  s1.addText('Quarterly review', {
    x: 1, y: 0.5, w: 8, h: 1, fontSize: 36, bold: true, italic: true, color: 'E74C3C', align: 'center', fontFace: 'Georgia'
  });
  s1.addText('Line one\nLine two', { x: 1, y: 2, w: 6, h: 1.5, fontSize: 18, underline: { style: 'sng' } });
  s1.addImage({ data: `image/png;base64,${PNG_BASE64}`, x: 8, y: 4, w: 1, h: 1 });
  s1.addNotes('Open with the headline number');

  const s2 = pptx.addSlide();
  s2.addText('Second slide', { x: 0.5, y: 0.5, w: 4, h: 0.5, fontSize: 24 });

  pptx.addSlide(); // empty slide

  return pptx.write({ outputType: 'nodebuffer' });
}

describe('extractSlidesFromPptx', () => {
  it('extracts text, formatting, images, backgrounds and notes', async () => {
    const slides = await extractSlidesFromPptx(await buildPptx());
    expect(slides).toHaveLength(3);

    const [s1, s2, s3] = slides;
    expect(s1).toMatchObject({ id: 'slide-1', order: 0, backgroundColor: '#112233', needsImageFallback: false });
    expect(s1.notes).toBe('Open with the headline number');

    const title = s1.blocks.find((b) => b.text === 'Quarterly review');
    expect(title).toMatchObject({
      type: 'textbox',
      x: 96,
      y: 48,
      width: 768,
      fontSize: 48, // 36pt on a 720pt-wide slide drawn 960px wide
      fontWeight: 'bold',
      fontStyle: 'italic',
      fill: '#e74c3c',
      textAlign: 'center',
      fontFamily: 'Georgia'
    });

    const body = s1.blocks.find((b) => b.text.startsWith('Line one'));
    expect(body.text).toBe('Line one\nLine two');
    expect(body).toMatchObject({ x: 96, y: 192, fontSize: 24, underline: true });
    expect(body.fontWeight).toBeUndefined();

    const image = s1.blocks.find((b) => b.type === 'image');
    expect(image).toMatchObject({ x: 768, y: 384, width: 96, height: 96 });
    expect(image.imageUrl).toMatch(/^data:image\/png;base64,/);

    expect(s2.blocks.map((b) => b.text)).toEqual(['Second slide']);
    expect(s2.backgroundColor).toBeUndefined();

    expect(s3).toMatchObject({ blocks: [], needsImageFallback: true });
  });

  it('keeps slide order from presentation.xml and gives blocks unique ids', async () => {
    const slides = await extractSlidesFromPptx(await buildPptx());
    expect(slides.map((s) => s.order)).toEqual([0, 1, 2]);
    const ids = slides.flatMap((s) => s.blocks.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('inherits position, size and style from layout and master placeholders', async () => {
    // Made with python-pptx's default (PowerPoint-authored) template: the
    // slide shapes carry only text, everything else comes from layouts.
    const file = await readFile(new URL('../test/fixtures/placeholders.pptx', import.meta.url));
    const [titleSlide, contentSlide] = await extractSlidesFromPptx(file);

    expect(titleSlide.blocks).toEqual([
      expect.objectContaining({ text: 'Placeholder title', x: 174, y: 168, width: 612, fontSize: 44, textAlign: 'center' }),
      expect.objectContaining({ text: 'Subtitle from layout', x: 228, y: 306, fontSize: 32, textAlign: 'center' })
    ]);
    expect(contentSlide.blocks.map((b) => b.text)).toEqual(['Agenda', 'First point\nSecond point', 'Grouped text']);
    // 4:3 slide: content is centred horizontally on the 16:9 canvas.
    expect(contentSlide.blocks[2]).toMatchObject({ x: 220, y: 400, width: 200 });
    expect(contentSlide.notes).toBe('Keep it short');
  });

  it('rejects files that are not pptx archives', async () => {
    await expect(extractSlidesFromPptx(Buffer.from('%PDF-1.4'))).rejects.toBeInstanceOf(PptxParseError);
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    await expect(extractSlidesFromPptx(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(
      'Missing ppt/presentation.xml'
    );
  });
});
