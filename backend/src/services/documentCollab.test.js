import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { cleanContent, DocumentContentError } from './documentContent.js';
import { exportDocumentToDocx } from './docxExportService.js';
import { exportDocumentToPdf } from './documentPdfService.js';

const PAGE = { width: 816, height: 1056, margins: { top: 96, right: 96, bottom: 96, left: 96 } };
const item = (text) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const COMMENT = 'ab'.repeat(12);
const CONTENT = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Commented', marks: [{ type: 'comment', attrs: { commentId: COMMENT } }] }] },
    { type: 'bulletList', attrs: { listStyle: 'square' }, content: [item('a')] },
    { type: 'orderedList', attrs: { start: 1, listStyle: 'upper-alpha' }, content: [item('b')] }
  ]
};

describe('list styles and comments in stored documents', () => {
  it('keeps list marker styles and comment marks', () => {
    expect(cleanContent(CONTENT)).toEqual(CONTENT);
    expect(() => cleanContent({ type: 'doc', content: [{ type: 'bulletList', attrs: { listStyle: 'url(x)' }, content: [item('a')] }] })).toThrow(DocumentContentError);
    expect(() => cleanContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'comment', attrs: { commentId: 'nope' } }] }] }] })).toThrow(DocumentContentError);
  });

  it('drops what it does not know in lenient mode instead of refusing', () => {
    const messy = {
      type: 'doc',
      content: [
        { type: 'script' },
        { type: 'paragraph', attrs: { textAlign: 'sideways', onclick: 'x' }, content: [{ type: 'text', text: 'ok', marks: [{ type: 'blink' }, { type: 'bold' }] }] }
      ]
    };
    expect(cleanContent(messy, { lenient: true })).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ok', marks: [{ type: 'bold' }] }] }] });
  });

  it('exports list marker styles to Word, and ignores comment marks', async () => {
    const file = await exportDocumentToDocx({ title: 'Lists', content: CONTENT, page: PAGE, layout: null });
    const zip = await JSZip.loadAsync(file);
    const numbering = await zip.file('word/numbering.xml').async('string');
    expect(numbering).toContain('w:lvlText w:val="▪"');
    expect(numbering).toContain('w:numFmt w:val="upperLetter"');
    const body = await zip.file('word/document.xml').async('string');
    expect(body).toContain('Commented');
    const pdf = await exportDocumentToPdf({ title: 'Lists', content: CONTENT, page: PAGE, layout: null });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
