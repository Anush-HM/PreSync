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
    // Positions are the text area: the shape's box less PowerPoint's
    // default 0.1in / 0.05in insets (9.6px / 4.8px on this canvas).
    expect(title).toMatchObject({
      type: 'textbox',
      x: 105.6,
      y: 52.8,
      width: 748.8,
      fontSize: 48, // 36pt on a 720pt-wide slide drawn 960px wide
      fontWeight: 'bold',
      fontStyle: 'italic',
      fill: '#e74c3c',
      textAlign: 'center',
      fontFamily: 'Georgia, Gelasio, serif'
    });

    const body = s1.blocks.find((b) => b.text.startsWith('Line one'));
    expect(body.text).toBe('Line one\nLine two');
    expect(body).toMatchObject({ x: 105.6, y: 196.8, fontSize: 24, underline: true });
    expect(body.fontWeight).toBeUndefined();
    expect(body.styles).toBeUndefined(); // uniform formatting needs no per-character styles

    const image = s1.blocks.find((b) => b.type === 'image');
    expect(image).toMatchObject({ x: 768, y: 384, width: 96, height: 96 });
    expect(image.imageUrl).toMatch(/^data:image\/png;base64,/);

    expect(s2.blocks.map((b) => b.text)).toEqual(['Second slide']);
    // The template's own (white) master background, read rather than assumed.
    expect(s2.backgroundColor).toBe('#ffffff');

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
      expect.objectContaining({
        text: 'Placeholder title', x: 181.2, y: 171.4, width: 597.6, fontSize: 44, textAlign: 'center',
        role: 'title', verticalAlign: 'middle'
      }),
      expect.objectContaining({ text: 'Subtitle from layout', x: 235.2, y: 309.6, fontSize: 32, textAlign: 'center', role: 'subtitle', fill: '#404040' })
    ]);
    // The body placeholder's bullets come from the master's body style.
    expect(contentSlide.blocks.map((b) => b.text.replace(/\u00a0+/g, ' '))).toEqual([
      'Agenda',
      '• First point\n• Second point',
      'Grouped text'
    ]);
    // 4:3 slide: content is centred horizontally on the 16:9 canvas.
    expect(contentSlide.blocks[2]).toMatchObject({ x: 227.2, y: 403.6, width: 185.6 });
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

describe('analyzePptx', () => {
  it('reports titles, imported tables and charts, and keeps slide order', async () => {
    const { analyzePptx } = await import('./pptxAnalysisService.js');
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    const s1 = pptx.addSlide();
    s1.addText('Overview', { x: 1, y: 0.5, w: 8, h: 1, fontSize: 40 });
    const s2 = pptx.addSlide();
    s2.addText('Numbers', { x: 0.5, y: 0.3, w: 8, h: 0.8, fontSize: 32 });
    s2.addTable([[{ text: 'A' }, { text: 'B' }]], { x: 1, y: 2, w: 4 });
    s2.addChart(pptx.ChartType.bar, [{ name: 'S', labels: ['a'], values: [1] }], { x: 5, y: 2, w: 4, h: 3 });
    const buf = await pptx.write({ outputType: 'nodebuffer' });

    const { slides, analysis, outline } = await analyzePptx(buf, 'numbers.pptx');
    expect(slides).toHaveLength(2);
    expect(analysis.slideCount).toBe(2);
    expect(analysis.stats).toMatchObject({ slides: 2, tables: 1, charts: 1 });
    expect(analysis.headings.map((h) => h.text)).toEqual(['Overview', 'Numbers']);
    expect(outline.map((o) => o.title)).toEqual(['Overview', 'Numbers']);
    // The chart is redrawn, so nothing on slide 2 is reported as missing.
    expect(slides[1].blocks.find((b) => b.type === 'chart').chart.series[0].values).toEqual([1]);
    expect(analysis.warnings.join(' ')).not.toMatch(/slide 2/);
    expect(slides[1].blocks.find((b) => b.type === 'table').table.rows[0].cells.map((c) => c.text)).toEqual(['A', 'B']);
  });
});
