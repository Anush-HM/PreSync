import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  blocksToContent, borderOnPage, cleanBorder, cleanContent, countWords, expandTabs, defaultPage, importNotes, parsePageRanges, slotsFromWord, zoneTexts
} from './documentContent.js';
import { exportDocumentToDocx } from './docxExportService.js';
import { exportDocumentToPdf } from './documentPdfService.js';
import { parseDocx } from './docxIngestService.js';
import { buildDocx, p, PNG_BASE64 } from '../test/buildDocx.js';

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

const SIDES_ALL = { top: true, right: true, bottom: true, left: true };
const LAYOUT = {
  header: { left: '{title}', center: '', right: '' },
  footer: { left: 'Draft', center: '', right: '' },
  differentFirstPage: false,
  pageNumbers: { position: 'bottom-center', format: 'pageOf', hideOnFirst: true },
  pageBorder: { sides: SIDES_ALL, style: 'double', width: 1.5, color: '#2e5e4e', inset: 24, scope: 'all', pages: '' }
};

describe('page layout rules', () => {
  it('adds the page number to its zone, and hides it on page 1 when asked', () => {
    expect(zoneTexts(LAYOUT, 'footer', 1).center).toBe('Page {page} of {pages}');
    expect(zoneTexts(LAYOUT, 'footer', 0).center).toBe('');
    expect(zoneTexts(LAYOUT, 'header', 1).center).toBe('');
  });

  it('clears page 1 for a different first page', () => {
    const first = zoneTexts({ ...LAYOUT, differentFirstPage: true }, 'header', 0);
    expect(first).toEqual({ left: '', center: '', right: '' });
  });

  it('limits a border to its pages', () => {
    const on = (scope, pages = '') => [0, 1, 2].map((i) => borderOnPage({ scope, pages }, i));
    expect(on('all')).toEqual([true, true, true]);
    expect(on('first')).toEqual([true, false, false]);
    expect(on('exceptFirst')).toEqual([false, true, true]);
    expect(on('pages', '1, 3')).toEqual([true, false, true]);
    expect([...parsePageRanges('2-4, x, 7')]).toEqual([2, 3, 4, 7]);
  });

  it('reads Word headers into slots, with their page fields', () => {
    const runs = [{ text: 'Left\t' }, { text: 'Mid\t' }, { text: 'Page ' }, { text: '3', field: 'PAGE' }];
    expect(slotsFromWord([{ runs }])).toEqual({ left: 'Left', center: 'Mid', right: 'Page {page}' });
    expect(slotsFromWord([{ runs: [{ text: 'Only' }], layout: { align: 'right' } }]).right).toBe('Only');
  });
});

// Close enough for the columns in these tests: the text is the same font.
const textWidthOf = (text) => text.length * 7.2;

describe('page breaks and blank lines from Word', () => {
  const blanks = (n) => '<w:p/>'.repeat(n);
  const types = (parsed) => parsed.blocks.map((b) => (isBlankBlock(b) ? 'blank' : b.type));
  const isBlankBlock = (b) => b.type === 'paragraph' && !b.text;
  const brThen = (text) => `<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const rendered = (text) => `<w:p><w:r><w:lastRenderedPageBreak/><w:t>${text}</w:t></w:r></w:p>`;

  it('keeps blank lines between text, but not at the end', async () => {
    expect(types(await parseDocx(await buildDocx(p('a') + blanks(2) + p('b') + blanks(3))))).toEqual(['paragraph', 'blank', 'blank', 'paragraph']);
  });

  it('puts a break ahead of the text it comes before', async () => {
    const parsed = await parseDocx(await buildDocx(p('cover') + brThen('next')));
    expect(parsed.blocks.map((b) => b.type)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
    expect(parsed.blocks[2].text).toBe('next');
  });

  it('uses where Word last broke the page, only at a paragraph start', async () => {
    const mid = '<w:p><w:r><w:t>one</w:t></w:r><w:r><w:lastRenderedPageBreak/><w:t>two</w:t></w:r></w:p>';
    expect(types(await parseDocx(await buildDocx(p('a') + rendered('b'))))).toEqual(['paragraph', 'pageBreak', 'paragraph']);
    expect(types(await parseDocx(await buildDocx(p('a') + mid)))).toEqual(['paragraph', 'paragraph']);
  });

  it('makes one break of several, dropping blank lines that filled the page', async () => {
    const parsed = await parseDocx(await buildDocx(p('a') + blanks(4) + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + blanks(1) + rendered('b')));
    expect(types(parsed)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
  });

  it('turns them into editor nodes', async () => {
    const parsed = await parseDocx(await buildDocx(p('a') + blanks(1) + p('b') + brThen('c')));
    const { content } = blocksToContent(parsed.blocks);
    expect(content.map((n) => n.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'pageBreak', 'paragraph']);
    expect(content[1].content).toBeUndefined();
  });

  it('starts the contents on a new page, title centred and items left', async () => {
    const centre = (t) => `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
    const parsed = await parseDocx(await buildDocx(centre('Cover') + p('TABLE OF CONTENTS') + centre('1. Introduction') + centre('2. Meaning') + brThen('Body') + centre('Centred again')));
    expect(parsed.blocks.map((b) => b.type)).toEqual(['paragraph', 'pageBreak', 'paragraph', 'paragraph', 'paragraph', 'pageBreak', 'paragraph', 'paragraph']);
    expect(parsed.blocks[2].layout.align).toBe('center');
    expect(parsed.blocks[3].layout?.align).toBeUndefined();
    expect(parsed.blocks[4].layout?.align).toBeUndefined();
    expect(parsed.blocks[7].layout.align).toBe('center');
  });

  it('adds no page ahead of contents that open the document', async () => {
    expect((await parseDocx(await buildDocx(p('Table of Contents') + p('x')))).blocks[0].type).toBe('paragraph');
  });
});

describe('tabs and page borders from Word', () => {
  const tab = '<w:r><w:tab/></w:r>';
  const line = (left, right, pPr = '') => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${left}</w:t></w:r>${tab}<w:r><w:t>${right}</w:t></w:r></w:p>`;

  it('keeps tabs and repeated spaces in the text', async () => {
    const parsed = await parseDocx(await buildDocx(`${line('Student Name:   Asha', 'USN: 1')}`));
    const text = blocksToContent(parsed.blocks).content[0].content.map((n) => n.text).join('');
    expect(text).toBe('Student Name:   Asha\tUSN: 1');
  });

  it('turns centred column lines into one left block on a shared stop', () => {
    const line = (text) => ({ type: 'paragraph', text, runs: [{ text, style: { fontSize: 14.7 } }], layout: { align: 'center' } });
    const { content } = blocksToContent([line('Student Name: Amruth B     USN: 1'), line('Student Name: Yashwanth D     USN: 22'), line('Guide: Dr. M'), line('Plain centred line')]);
    const [one, two, three, four] = content;
    for (const n of [one, two, three]) {
      expect(n.attrs.textAlign).toBeUndefined();
      expect(n.attrs.indent).toBe(one.attrs.indent);
    }
    expect(one.attrs.indent).toBeGreaterThan(0);
    expect(four.attrs.textAlign).toBe('center');
    const texts = (n) => n.content.map((c) => c.text);
    expect(texts(one)[0]).toBe('Student Name: Amruth B');
    expect(texts(one)[2]).toBe('USN: 1');
    expect(texts(one)[1]).toMatch(/^\t+$/);
    expect(texts(two)[1]).toMatch(/^\t+$/);
    const reach = (n) => Math.floor(textWidthOf(texts(n)[0]) / 48) + texts(n)[1].length;
    expect(reach(one)).toBe(reach(two));
  });

  it('leaves a lone centred label alone', () => {
    const { content } = blocksToContent([{ type: 'paragraph', text: 'Note: read this', runs: [{ text: 'Note: read this' }], layout: { align: 'center' } }]);
    expect(content[0].attrs.textAlign).toBe('center');
  });

  it('survives validation with its indent', () => {
    const content = { type: 'doc', content: [{ type: 'paragraph', attrs: { indent: 2 } }] };
    expect(cleanContent(content)).toEqual(content);
  });

  it('lines columns up on a custom tab stop, whatever the left text', async () => {
    const stop = '<w:tabs><w:tab w:val="left" w:pos="5040"/></w:tabs>';
    const parsed = await parseDocx(await buildDocx(line('Name: Asha', 'USN', stop) + line('Department of Computer', 'Sem', stop)));
    expect(parsed.blocks[0].layout.tabs).toEqual([{ pos: 336, type: 'left' }]);
    const reach = (block) => {
      const text = blocksToContent([block]).content[0].content.map((n) => n.text).join('');
      const [left, tabs] = text.split(/(\t+)/);
      return Math.floor((left.length * 8) / 48) + tabs.length;
    };
    expect(reach(parsed.blocks[0])).toBe(reach(parsed.blocks[1]));
  });

  it('leaves text alone without custom stops', () => {
    const runs = [{ text: 'a' }, { text: '\t' }, { text: 'b' }];
    expect(expandTabs(runs, undefined)).toBe(runs);
  });

  it('reads a page border, measured from the page', async () => {
    const sect = '<w:p><w:pPr><w:sectPr><w:pgBorders w:offsetFrom="page" w:display="notFirstPage"><w:top w:val="double" w:sz="12" w:space="24" w:color="2E5E4E"/><w:left w:val="double" w:sz="12" w:space="24" w:color="2E5E4E"/><w:bottom w:val="double" w:sz="12" w:space="24" w:color="2E5E4E"/><w:right w:val="double" w:sz="12" w:space="24" w:color="2E5E4E"/></w:pgBorders></w:sectPr></w:pPr></w:p>';
    const { pageBorder } = await parseDocx(await buildDocx(p('x') + sect));
    expect(pageBorder).toEqual({ sides: { top: true, right: true, bottom: true, left: true }, style: 'double', width: 1.5, color: '#2e5e4e', inset: 24, scope: 'exceptFirst' });
    expect(cleanBorder(pageBorder)).toMatchObject({ style: 'double', width: 1.5, scope: 'exceptFirst' });
  });

  it('converts a border measured from the text, and keeps only present sides', async () => {
    const sect = '<w:p><w:pPr><w:sectPr><w:pgBorders><w:top w:val="thick" w:sz="36" w:space="10" w:color="auto"/><w:bottom w:val="nil"/></w:pgBorders></w:sectPr></w:pPr></w:p>';
    const { pageBorder } = await parseDocx(await buildDocx(sect));
    expect(pageBorder).toMatchObject({ sides: { top: true, bottom: false }, style: 'solid', width: 4.5, color: '#000000', inset: 31, scope: 'all' });
  });

  it('has no border when Word has none', async () => {
    expect((await parseDocx(await buildDocx(p('x')))).pageBorder).toBeNull();
  });

  it('round-trips a border through export and import', async () => {
    const { pageBorder } = await parseDocx(await exportDocumentToDocx({ ...DOC, layout: LAYOUT }));
    expect(pageBorder).toMatchObject({ style: 'double', width: 1.5, color: '#2e5e4e', inset: 24, scope: 'all' });
  });
});

describe('exportDocumentToDocx', () => {
  it('writes native headers, footers, page fields and page borders', async () => {
    const zip = await JSZip.loadAsync(await exportDocumentToDocx({ ...DOC, layout: LAYOUT }));
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toMatch(/<w:headerReference w:type="default" r:id="rIdZone1"\/>/);
    expect(xml).toMatch(/<w:footerReference w:type="first" r:id="rIdZone4"\/>/);
    expect(xml).toContain('<w:titlePg/>');
    expect(xml).toContain('<w:pgBorders w:offsetFrom="page" w:display="allPages"><w:top w:val="double" w:sz="12" w:space="24" w:color="2E5E4E"/>');
    expect(xml.indexOf('<w:pgMar')).toBeLessThan(xml.indexOf('<w:pgBorders'));
    expect(xml.indexOf('<w:pgBorders')).toBeLessThan(xml.indexOf('<w:titlePg'));
    const footer = await zip.file('word/footer2.xml').async('string');
    expect(footer).toContain('<w:fldSimple w:instr=" PAGE ">');
    expect(footer).toContain('<w:fldSimple w:instr=" NUMPAGES ">');
    expect(await zip.file('word/footer4.xml').async('string')).not.toContain('fldSimple');
    expect(await zip.file('[Content_Types].xml').async('string')).toContain('/word/header1.xml');
    expect(await zip.file('word/_rels/document.xml.rels').async('string')).toContain('Target="footer2.xml"');
  });

  it('keeps headers and footers through export and import', async () => {
    const parsed = await parseDocx(await exportDocumentToDocx({ ...DOC, title: 'Plan', layout: { ...LAYOUT, pageNumbers: { position: 'bottom-center', format: 'plain', hideOnFirst: false } } }));
    expect(slotsFromWord(parsed.header).left).toBe('Plan');
    expect(slotsFromWord(parsed.footer)).toMatchObject({ left: 'Draft', center: '{page}' });
  });

  it('adds nothing when the layout is empty', async () => {
    const zip = await JSZip.loadAsync(await exportDocumentToDocx(DOC));
    expect(zip.file('word/header1.xml')).toBeNull();
    expect(await zip.file('word/document.xml').async('string')).not.toContain('pgBorders');
  });

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

  it('puts numbered footers on each page, and draws every border style', async () => {
    const pages = await pdfPages(await exportDocumentToPdf({ ...DOC, layout: LAYOUT }));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('Annual plan');
    expect(pages[0]).not.toMatch(/Page\s+1\s+of\s+2/);
    expect(pages[1]).toMatch(/Page\s+2\s+of\s+2/);
    for (const style of ['solid', 'dashed', 'dotted', 'groove']) {
      const buffer = await exportDocumentToPdf({ ...DOC, layout: { ...LAYOUT, pageBorder: { ...LAYOUT.pageBorder, style } } });
      expect(await pdfPages(buffer)).toHaveLength(2);
    }
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
