import { readFile } from 'fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractSlidesFromPptx } from './pptxIngestService.js';
import { extractSlidesFromPdf } from './pdfIngestService.js';
import { slideTitleFromBlocks } from './documentAnalysis.js';

// Tests A–F of the import fidelity brief, against fixtures built by
// test/fixtures/make_fixtures.py (a deck modelled on a real project
// presentation, and the same deck saved as PDF). Word (G) is in
// docxFidelity.test.js and the sidebar (H) in the frontend SlideRail test.

const fixture = (name) => readFile(new URL(`../test/fixtures/${name}`, import.meta.url));
const textOf = (slide) => slide.blocks.filter((b) => b.type === 'textbox');
const find = (slide, start) => textOf(slide).find((b) => b.text.startsWith(start));

describe('PowerPoint import fidelity', () => {
  let slides;
  let report;
  beforeAll(async () => {
    report = {};
    slides = await extractSlidesFromPptx(await fixture('fidelity-deck.pptx'), report);
  });

  it('A: title slide keeps separate boxes, sizes and only the bold that is in the source', () => {
    const [s] = slides;
    expect(s.blocks.filter((b) => b.type === 'image')).toHaveLength(1);
    const heading = find(s, 'Major Project');
    const college = find(s, 'BGS College');
    expect(heading.fontSize).toBeGreaterThan(college.fontSize);
    // Not everything is bold: the address lines under the college name are regular.
    expect(textOf(s).some((b) => b.fontWeight !== 'bold' && !(b.styles || []).every((r) => r.style.fontWeight === 'bold'))).toBe(true);
    // Boxes do not overlap: each starts below the one above it.
    const ys = textOf(s).map((b) => b.y);
    expect(new Set(ys).size).toBeGreaterThan(4);
    // A slide with no title placeholder has no title, so the sidebar shows "Slide 1".
    expect(slideTitleFromBlocks(s.blocks.filter((b) => b.role === 'title'))).toBeFalsy();
  });

  it('B: table of contents keeps its title, two columns and numbering', () => {
    const s = slides[1];
    expect(s.blocks.find((b) => b.role === 'title').text).toBe('Table of Contents');
    const [left, right] = [find(s, '1.'), find(s, '11.')];
    expect(left.text.split('\n')).toHaveLength(10);
    expect(left.text.split('\n')[3]).toMatch(/^4\.\s+Existing System/);
    expect(right.x).toBeGreaterThan(left.x + left.width / 2);
  });

  it('C: text-heavy slide keeps bullets, bold lead-ins and a smaller sub-level', () => {
    const s = slides[2];
    const body = find(s, '•');
    const lines = body.text.split('\n');
    expect(lines.filter((l) => l.startsWith('•'))).toHaveLength(4);
    const bold = body.styles.filter((r) => r.style.fontWeight === 'bold');
    expect(bold.length).toBeGreaterThanOrEqual(4);
    // Body text is mostly regular weight.
    expect(body.fontWeight).not.toBe('bold');
    expect(body.styles.some((r) => r.style.fontSize && r.style.fontSize < body.fontSize)).toBe(true);
  });

  it('D: tables stay tables, with header colours and a merged cell', () => {
    const t = slides[3].blocks.find((b) => b.type === 'table');
    expect(t.table.columns).toHaveLength(3);
    expect(t.table.rows).toHaveLength(5);
    expect(t.table.rows[0].cells[0].text).toBe('System / Tool');
    expect(t.table.rows[0].cells[0].background).not.toBe(t.table.rows[1].cells[0].background);
    expect(t.table.rows[4].cells[1].colspan).toBe(2);
    expect(t.table.rows[4].cells[2].covered).toBe(true);
  });

  it('E: themed slides keep their gradient, shapes and image backgrounds', () => {
    const themed = slides[4];
    expect(themed.backgroundGradient.stops.length).toBeGreaterThanOrEqual(2);
    expect(themed.blocks.filter((b) => b.type === 'shape').map((b) => b.shape)).toEqual(expect.arrayContaining(['rect', 'ellipse', 'roundRect']));
    // Light text on the dark theme, not forced to black.
    expect(find(themed, 'Proposed System').fill).toMatch(/^#[c-f]/i);
    const pattern = slides[5];
    expect(pattern.backgroundImageUrl).toMatch(/^data:image\//);
    expect(pattern.backgroundColor).not.toBe('#ffffff');
    // Charts are redrawn from their data, not left as a placeholder.
    const chart = pattern.blocks.find((b) => b.type === 'chart');
    expect(chart.chart).toMatchObject({ kind: 'column', categories: ['Precision', 'Recall', 'F1'], title: 'Model' });
    expect(chart.chart.series[0].values).toEqual([0.91, 0.88, 0.89]);
    expect(pattern.blocks.some((b) => b.role === 'placeholder')).toBe(false);
    expect(report.placeholders).toBe(0);
  });
});

describe('PDF import fidelity', () => {
  it('F: pages keep their rendered background (images, colours) under editable, aligned text', async () => {
    const report = {};
    const slides = await extractSlidesFromPdf(await fixture('fidelity-deck.pdf'), report);
    expect(slides).toHaveLength(6);
    slides.forEach((s) => expect(s.backgroundImageUrl).toMatch(/^data:image\/jpeg;base64,/));
    const toc = slides[1];
    expect(toc.blocks.find((b) => b.role === 'title').text).toBe('Table of Contents');
    const intro = slides[2];
    const body = textOf(intro).find((b) => /Rapid Growth/.test(b.text));
    expect(body.text).toMatch(/^•/);
    expect(body.styles.some((r) => r.style.fontWeight === 'bold')).toBe(true);
    // Text sits inside the page and keeps different sizes.
    const sizes = new Set(slides.flatMap((s) => textOf(s).map((b) => Math.round(b.fontSize))));
    expect(sizes.size).toBeGreaterThan(3);
    slides.flatMap(textOf).forEach((b) => {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(961);
    });
  }, 30000);
});
