import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { blocksToContent, cleanContent, countWords, defaultPage, importNotes } from './documentContent.js';
import { exportDocumentToDocx } from './docxExportService.js';
import { exportDocumentToPdf } from './documentPdfService.js';
import { parseDocx } from './docxIngestService.js';
import { PNG_BASE64 } from '../test/buildDocx.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/fidelity-report.docx');
const PNG = `data:image/png;base64,${PNG_BASE64}`;
const text = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const para = (...content) => ({ type: 'paragraph', content });
const cell = (t, attrs = {}) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, ...attrs }, content: [para(text(t))] });

const RICH = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { blockStyle: 'title' }, content: [text('Annual plan')] },
    { type: 'heading', attrs: { level: 1, textAlign: 'center', lineHeight: 1.5 }, content: [text('Goals')] },
    para(
      text('Bold ', [{ type: 'bold' }]),
      text('red ', [{ type: 'textStyle', attrs: { color: '#ac3045', fontSize: '14pt', fontFamily: 'Georgia, serif' } }]),
      text('badge', [{ type: 'badge', attrs: { tone: 'success' } }])
    ),
    { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('First')), { type: 'orderedList', content: [{ type: 'listItem', content: [para(text('Nested'))] }] }] }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [para(text('Third'))] }] },
    { type: 'blockquote', content: [para(text('Quoted line'))] },
    { type: 'horizontalRule' },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('A', { rowspan: 2, background: '#e3f2e8' }), cell('B')] },
        { type: 'tableRow', content: [cell('C')] }
      ]
    },
    { type: 'image', attrs: { src: PNG, width: 120, height: 60, align: 'center', alt: 'Dot' } },
    { type: 'shape', attrs: { shape: 'star5', color: '#285c43', width: 80, height: 80, align: 'right' } },
    { type: 'callout', attrs: { tone: 'warning' }, content: [para(text('Mind this'))] },
    { type: 'pageBreak' },
    para(text('After the break'))
  ]
};
const DOC = { title: 'Annual plan', page: defaultPage('a4'), content: RICH };

async function pdfPages(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    pages.push((await page.getTextContent()).items.map((t) => t.str).join(' '));
  }
  return pages;
}

describe('cleanContent', () => {
  it('keeps everything the editor writes', () => {
    expect(cleanContent(RICH)).toEqual(RICH);
  });

  it('drops unknown attributes and refuses unknown nodes and marks', () => {
    const cleaned = cleanContent({ type: 'doc', content: [{ type: 'paragraph', attrs: { onclick: 'x', textAlign: 'left' } }] });
    expect(cleaned.content[0].attrs).toEqual({ textAlign: 'left' });
    expect(() => cleanContent({ type: 'doc', content: [{ type: 'iframe' }] })).toThrow(/Unknown content/);
    expect(() => cleanContent({ type: 'doc', content: [para({ type: 'text', text: 'x', marks: [{ type: 'link' }] })] })).toThrow(/Unknown formatting/);
    expect(() => cleanContent({ type: 'nope' })).toThrow();
  });

  it('refuses CSS smuggled through colours and fonts', () => {
    const styled = (attrs) => ({ type: 'doc', content: [para({ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs }] })] });
    expect(() => cleanContent(styled({ color: 'red;background:url(x)' }))).toThrow(/color/);
    expect(() => cleanContent(styled({ fontFamily: 'x;}<style>' }))).toThrow(/fontFamily/);
  });

  it('fills an empty document with a paragraph', () => {
    expect(cleanContent({ type: 'doc', content: [] }).content).toEqual([{ type: 'paragraph' }]);
  });
});

describe('blocksToContent', () => {
  it('nests list items by level and splits by list type', () => {
    const items = [
      { text: 'a', level: 0, ordered: false },
      { text: 'b', level: 1, ordered: true },
      { text: 'c', level: 0, ordered: false },
      { text: 'd', level: 0, ordered: true }
    ];
    const { content } = blocksToContent([{ type: 'list', items }]);
    expect(content.map((n) => n.type)).toEqual(['bulletList', 'orderedList']);
    expect(content[0].content[0].content[1].type).toBe('orderedList');
    expect(content[0].content).toHaveLength(2);
  });

  it('turns line breaks into hard breaks and groups quote paragraphs', () => {
    const { content } = blocksToContent([
      { type: 'paragraph', styleId: 'Quote', text: 'one', runs: [{ text: 'one\ntwo', style: {} }] },
      { type: 'paragraph', styleId: 'Quote', text: 'three' },
      { type: 'paragraph', text: 'plain' }
    ]);
    expect(content.map((n) => n.type)).toEqual(['blockquote', 'paragraph']);
    expect(content[0].content).toHaveLength(2);
    expect(content[0].content[0].content.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text']);
  });

  it('keeps tables with merged cells and turns charts into their data', () => {
    const { content } = blocksToContent([
      {
        type: 'table',
        table: {
          columns: [100, 100],
          rows: [
            { cells: [{ text: 'wide', colspan: 2 }, { text: '', covered: true }] },
            { cells: [{ text: 'tall', rowspan: 1 }, { text: 'x' }] }
          ]
        }
      },
      { type: 'chart', chart: { title: 'Sales', categories: ['Q1'], series: [{ name: 'A', values: [4] }] } }
    ]);
    expect(content[0].content[0].content[0].attrs).toMatchObject({ colspan: 2, colwidth: [100, 100] });
    expect(content[1].attrs.blockStyle).toBe('caption');
    expect(content[2].content[1].content[1].content[0].content[0].text).toBe('4');
  });

  it('imports the Word fixture into content the API accepts', async () => {
    const parsed = await parseDocx(readFileSync(FIXTURE));
    const content = blocksToContent(parsed.blocks, parsed.images);
    expect(cleanContent(content)).toEqual(content);
    expect(countWords(content)).toBeGreaterThan(10);
    expect(content.content.some((n) => n.type === 'table')).toBe(true);
  });

  it('describes what was left out', () => {
    expect(importNotes({ textBoxes: true, skippedImages: 2 })).toEqual(['Text boxes were not imported.', '2 pictures were left out because of size or format.']);
  });
});

describe('exportDocumentToDocx', () => {
  it('writes a package Word styles, numbering and media can resolve', async () => {
    const zip = await JSZip.loadAsync(await exportDocumentToDocx(DOC));
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('<w:pStyle w:val="Title"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('<w:spacing w:line="360" w:lineRule="auto"/>');
    expect(xml).toContain('<w:rFonts w:ascii="Georgia"');
    expect(xml).toContain('<w:sz w:val="28"/>');
    expect(xml).toContain('<w:vMerge w:val="restart"/>');
    expect(xml).toContain('<w:vMerge/>');
    expect(xml).toContain('prst="star5"');
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain('w:w="11910"');
    expect(Object.keys(zip.files)).toContain('word/media/image1.png');
    const numbering = await zip.file('word/numbering.xml').async('string');
    expect(numbering).toContain('<w:startOverride w:val="3"/>');
  });

  it('round-trips through the importer', async () => {
    const parsed = await parseDocx(await exportDocumentToDocx(DOC));
    const content = blocksToContent(parsed.blocks, parsed.images);
    const types = content.content.map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(['heading', 'bulletList', 'orderedList', 'blockquote', 'table', 'image', 'pageBreak']));
    expect(content.content[0].attrs.blockStyle).toBe('title');
    const heading = content.content.find((n) => n.type === 'heading');
    expect(heading.attrs).toMatchObject({ level: 1, textAlign: 'center', lineHeight: 1.5 });
    expect(parsed.meta.page.width).toBeCloseTo(794, 0);
    const list = content.content.find((n) => n.type === 'bulletList');
    expect(list.content[0].content[1].type).toBe('orderedList');
  });

  it('escapes text', async () => {
    const zip = await JSZip.loadAsync(await exportDocumentToDocx({ ...DOC, content: { type: 'doc', content: [para(text('a < b & c'))] } }));
    expect(await zip.file('word/document.xml').async('string')).toContain('a &lt; b &amp; c');
  });
});

describe('exportDocumentToPdf', () => {
  it('sets every kind of block, honouring page breaks', async () => {
    const pages = await pdfPages(await exportDocumentToPdf(DOC));
    expect(pages).toHaveLength(2);
    for (const word of ['Annual', 'Goals', 'Bold', 'badge', 'First', 'Nested', 'Third', 'Quoted', 'Mind']) expect(pages[0]).toContain(word);
    expect(pages[1]).toContain('After');
  });

  it('flows long text onto new pages', async () => {
    const paragraph = para(text('word '.repeat(120).trim()));
    const pages = await pdfPages(await exportDocumentToPdf({ ...DOC, content: { type: 'doc', content: Array.from({ length: 30 }, () => paragraph) } }));
    expect(pages.length).toBeGreaterThan(1);
  });

  it('handles an empty document and a word wider than the page', async () => {
    expect(await pdfPages(await exportDocumentToPdf({ ...DOC, content: { type: 'doc', content: [{ type: 'paragraph' }] } }))).toHaveLength(1);
    const pages = await pdfPages(await exportDocumentToPdf({ ...DOC, content: { type: 'doc', content: [para(text('x'.repeat(500)))] } }));
    expect(pages[0]).toContain('xxxx');
  });

  it('breaks a tall table across pages by row', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ type: 'tableRow', content: [cell(`Row ${i}`), cell('value')] }));
    const pages = await pdfPages(await exportDocumentToPdf({ ...DOC, content: { type: 'doc', content: [{ type: 'table', content: rows }] } }));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join(' ')).toMatch(/Row\s+79/);
  });
});
