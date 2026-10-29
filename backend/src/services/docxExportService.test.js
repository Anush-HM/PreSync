import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { exportDeckToDocx } from './docxExportService.js';
import { parseDocx } from './docxIngestService.js';
import { exportDeckToPdf } from './deckExportService.js';

// 1×1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const deck = {
  title: 'Quarterly <review> & plan',
  slides: [
    {
      id: 's1', order: 0, notes: 'Open with the headline number.\nThen pause.',
      blocks: [
        { id: 't', type: 'textbox', role: 'title', x: 60, y: 40, width: 800, fontSize: 40, text: 'Results' },
        {
          id: 'b', type: 'textbox', x: 60, y: 140, width: 800, fontSize: 22,
          text: ' • Revenue up\n   • Costs flat\nH2O and x2',
          styles: [{ start: 3, end: 10, style: { fontWeight: 'bold', fill: '#8f2638' } }, { start: 23, end: 24, style: { deltaY: 6, fontSize: 14 } }]
        },
        { id: 'img', type: 'image', x: 600, y: 300, width: 200, height: 100, imageUrl: PNG, alt: 'Team photo' },
        { id: 'web', type: 'image', x: 600, y: 420, width: 200, height: 100, imageUrl: 'https://example.com/x.png' }
      ]
    },
    {
      id: 's2', order: 1, name: 'Numbers',
      blocks: [
        {
          id: 'tbl', type: 'table', x: 60, y: 60, width: 600,
          table: {
            columns: [200, 200, 200],
            rows: [
              { height: 30, cells: [{ text: 'Region', colspan: 2, background: '#e3efe7' }, { text: '', covered: true }, { text: 'Total', rowspan: 2 }] },
              { height: 30, cells: [{ text: 'North' }, { text: 'South' }, { text: '', covered: true }] }
            ]
          }
        },
        { id: 'ch', type: 'chart', x: 60, y: 200, width: 500, height: 300, chart: { kind: 'column', title: 'Sales', categories: ['Q1', 'Q2'], series: [{ name: 'This year', values: [10, 20] }] } }
      ]
    },
    { id: 's3', order: 2, hidden: true, blocks: [{ id: 'h', type: 'textbox', role: 'title', x: 0, y: 0, width: 300, text: 'Secret slide' }] },
    { id: 's4', order: 3, backgroundImageUrl: PNG, needsImageFallback: false, blocks: [] }
  ]
};

async function partsOf(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const errors = [];
  new DOMParser({ onError: (level, msg) => errors.push(`${level}: ${msg}`) }).parseFromString(xml, 'text/xml');
  return { zip, xml, errors };
}

describe('exportDeckToDocx', () => {
  it('writes a valid Word package with headings, formatted runs, lists, tables, charts, pictures and notes', async () => {
    const { zip, xml, errors } = await partsOf(await exportDeckToDocx(deck));
    expect(errors).toEqual([]);
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/styles.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml']) {
      expect(zip.file(part), part).toBeTruthy();
    }
    expect(xml).toContain('Quarterly &lt;review&gt; &amp; plan');
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/>.*Results/);
    expect(xml).toMatch(/<w:b\/><w:color w:val="8F2638"\/>.*Revenue/);
    expect(xml).toContain('<w:ind w:left="720" w:hanging="260"/>'); // nested bullet
    expect(xml).toContain('<w:vertAlign w:val="subscript"/>');
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('<w:vMerge w:val="restart"/>');
    expect(xml).toContain('<w:vMerge/>');
    expect(xml).toContain('Chart: Sales (column), its data');
    expect(xml).toContain('descr="Team photo"');
    expect(xml).toContain('not included: only pictures stored in the presentation can be exported');
    expect(xml).toContain('Then pause.');
    expect(xml).toContain('Picture of the original slide');
    expect(xml).not.toContain('Secret slide');
    expect(Object.keys(zip.files).filter((f) => f.startsWith('word/media/') && !f.endsWith('/'))).toHaveLength(2);
  });

  it('includes hidden slides and leaves out notes when asked', async () => {
    const { xml } = await partsOf(await exportDeckToDocx(deck, { includeHidden: true, notes: false }));
    expect(xml).toContain('Secret slide');
    expect(xml).not.toContain('Then pause.');
  });

  it('reads back through PreSync’s own Word import', async () => {
    const parsed = await parseDocx(await exportDeckToDocx(deck));
    const headings = parsed.blocks.filter((b) => b.type === 'heading').map((b) => b.text);
    expect(headings).toEqual(expect.arrayContaining(['Results', 'Numbers', 'Slide 4']));
    expect(parsed.blocks.some((b) => b.type === 'table')).toBe(true);
    expect(parsed.images.length).toBeGreaterThanOrEqual(1);
  });
});

describe('exportDeckToPdf options', () => {
  it('adds a notes page after slides with notes, and can include hidden slides', async () => {
    const pages = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    expect(pages(await exportDeckToPdf(deck))).toBe(3);
    expect(pages(await exportDeckToPdf(deck, { notes: true }))).toBe(4);
    expect(pages(await exportDeckToPdf(deck, { notes: true, includeHidden: true }))).toBe(5);
  });
});
