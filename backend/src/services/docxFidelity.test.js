import { readFile } from 'fs/promises';
import { describe, expect, it } from 'vitest';
import { parseDocx } from './docxIngestService.js';
import { analyzeDocx, outlineToSlides, sanitizeOutline, tableIdsOf, tableSlideBlock } from './documentAnalysis.js';

// Test G: a Word report with run formatting, a list, a coloured centred
// paragraph, a picture, a shaded table with a merged cell, a page break
// and a header/footer (see test/fixtures/make_fixtures.py).
const fixture = () => readFile(new URL('../test/fixtures/fidelity-report.docx', import.meta.url));

describe('Word import fidelity', () => {
  it('keeps page size, margins, header and footer', async () => {
    const parsed = await parseDocx(await fixture());
    expect(parsed.meta.page.width).toBeCloseTo(793.9, 0);
    expect(parsed.meta.page.height).toBeCloseTo(1122.3, 0);
    expect(parsed.meta.page.margins).toMatchObject({ top: 96, left: 96 });
    expect(parsed.header[0].runs[0].text).toBe('S.H.I.E.L.D. project report');
    expect(parsed.footer[0].runs[0].text).toMatch(/BGS College/);
  });

  it('keeps run formatting and paragraph layout instead of flattening text', async () => {
    const { blocks } = await parseDocx(await fixture());
    const abstract = blocks.find((b) => b.type === 'paragraph' && b.text.startsWith('Abstract.'));
    const runs = abstract.runs;
    expect(runs.find((r) => r.text === 'Abstract. ').style.fontWeight).toBe('bold');
    expect(runs.find((r) => r.text === 'live').style.fontStyle).toBe('italic');
    // Only the lead-in is bold.
    expect(runs.filter((r) => r.style.fontWeight === 'bold')).toHaveLength(1);
    const red = blocks.find((b) => b.text === 'Red, centred and 14pt.');
    expect(red.layout.align).toBe('center');
    expect(red.runs[0].style).toMatchObject({ fill: '#c01f2f', fontSize: 18.7 });
    const heading = blocks.find((b) => b.type === 'heading' && b.text === 'Introduction');
    expect(heading.runs[0].style.fontSize).toBeGreaterThan(red.runs[0].style.fontSize - 0.1);
  });

  it('keeps list markers and hanging indents', async () => {
    const { blocks } = await parseDocx(await fixture());
    const list = blocks.find((b) => b.type === 'list');
    expect(list.items.map((i) => i.marker)).toEqual(['•', '•']);
    expect(list.items[0]).toMatchObject({ indentLeft: 24, indentFirst: -24 });
  });

  it('keeps tables structured, with shading, borders and merged cells', async () => {
    const { blocks } = await parseDocx(await fixture());
    const t = blocks.find((b) => b.type === 'table');
    expect(t.table.columns).toHaveLength(3);
    expect(t.table.rows[0].cells[0]).toMatchObject({ text: 'Tool', background: '#d9e2f3', fontWeight: 'bold' });
    expect(t.table.rows[0].cells[0].borders.top).toEqual({ color: '#000000', width: 0.75 });
    const merged = t.table.rows[2].cells;
    expect(merged[1].colspan).toBe(2);
    expect(merged[2].covered).toBe(true);
  });

  it('records explicit page breaks', async () => {
    const { blocks } = await parseDocx(await fixture());
    const i = blocks.findIndex((b) => b.type === 'pageBreak');
    expect(blocks[i + 1]).toMatchObject({ type: 'heading', text: 'Conclusion' });
    expect(blocks[blocks.length - 1].type).not.toBe('pageBreak');
  });

  it('turns tables into table slides rather than text bullets', async () => {
    const parsed = await parseDocx(await fixture());
    const { outline, analysis } = analyzeDocx(parsed, 'fidelity-report.docx');
    const item = outline.find((o) => o.tableId);
    expect(item).toMatchObject({ title: 'Comparison', bullets: [], tableRows: [0, 3] });
    expect(analysis.warnings.join(' ')).not.toMatch(/converted to text/);

    const clean = sanitizeOutline(outline, new Set(parsed.images.map((i) => i.id)), tableIdsOf(parsed.blocks));
    const slides = outlineToSlides(clean, parsed.images, parsed.blocks);
    const slide = slides[outline.indexOf(item)];
    expect(slide.blocks[0]).toMatchObject({ role: 'title', text: 'Comparison' });
    const table = slide.blocks.find((b) => b.type === 'table');
    expect(table.x).toBeGreaterThanOrEqual(0);
    expect(table.x + table.width).toBeLessThanOrEqual(960);
    expect(table.y + table.height).toBeLessThanOrEqual(540);
    expect(table.table.rows[0].cells[0]).toMatchObject({ text: 'Tool', background: '#d9e2f3' });
  });

  it('drops table references the document does not have', () => {
    const [item] = sanitizeOutline([{ title: 'x', tableId: 'tbl-9', tableRows: [0, 2] }], new Set(), new Set(['tbl-1']));
    expect(item).toMatchObject({ tableId: null, tableRows: null });
  });

  it('splits long tables across slides without cutting merged cells, repeating the header', () => {
    const cell = (text, extra = {}) => ({ text, fontSize: 14, ...extra });
    const rows = [{ height: 0, cells: [cell('H1'), cell('H2')] }];
    for (let r = 1; r <= 24; r += 1) rows.push({ height: 0, cells: [cell(`r${r}`), cell('v')] });
    // A cell spanning rows 9-11 (the first cut would fall at row 10).
    rows[9].cells[0] = cell('merged', { rowspan: 3 });
    rows[10].cells[0] = { text: '', covered: true };
    rows[11].cells[0] = { text: '', covered: true };
    const block = { type: 'table', id: 'tbl-1', rows: [], table: { columns: [200, 200], rows } };
    const parsed = { blocks: [{ type: 'heading', level: 1, text: 'Data' }, block], images: [], meta: {}, found: {} };
    const { outline } = analyzeDocx(parsed, 'x.docx');
    const ranges = outline.filter((o) => o.tableId).map((o) => o.tableRows);
    expect(ranges[0]).toEqual([0, 9]);
    expect(ranges.flat().pop()).toBe(25);
    const second = tableSlideBlock(block, ranges[1], { x: 60, y: 124, width: 840, height: 376 });
    expect(second.table.rows[0].cells[0].text).toBe('H1');
    expect(second.table.rows[1].cells[0]).toMatchObject({ text: 'merged', rowspan: 3 });
  });
});
