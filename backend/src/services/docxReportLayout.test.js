import { readFile } from 'fs/promises';
import { describe, expect, it } from 'vitest';
import { parseDocx } from './docxIngestService.js';
import { blocksToContent, cleanContent } from './documentContent.js';
import { exportDocumentToDocx } from './docxExportService.js';
import { exportDocumentToPdf } from './documentPdfService.js';
import { buildDocx, PNG_BASE64 } from '../test/buildDocx.js';

// A college report's front matter (see make_fixtures.py,
// build_academic_docx): a floating logo, signature lines and contents
// laid out with tab stops, manual line breaks, and runs whose own font
// names only the complex-script face.
const fixture = () => readFile(new URL('../test/fixtures/academic-report.docx', import.meta.url));
const PNG = `data:image/png;base64,${PNG_BASE64}`;

describe('Word report layout', () => {
  it('takes a run’s Latin face from its style when the run only names another script', async () => {
    const { blocks } = await parseDocx(await fixture());
    const body = blocks.find((b) => b.text?.startsWith('This is to certify'));
    for (const run of body.runs) expect(run.style.fontFamily).toMatch(/^"Times New Roman"/);
  });

  it('keeps tabs, tab stops and manual line breaks', async () => {
    const { blocks } = await parseDocx(await fixture());
    const signatures = blocks.find((b) => b.text?.startsWith('Signature of the Guide'));
    expect(signatures.runs.map((r) => r.text).join('')).toBe('Signature of the Guide\tSignature of the HOD');
    expect(signatures.layout.tabs).toEqual([{ pos: expect.closeTo(602, 0), type: 'right', leader: 'none' }]);
    const contents = blocks.find((b) => b.text?.startsWith('2. Acknowledgment'));
    expect(contents.layout.tabs[0]).toMatchObject({ type: 'right', leader: 'dot' });
    const student = blocks.find((b) => b.text?.startsWith('Student Name'));
    expect(student.runs.map((r) => r.text).join('')).toBe('Student Name\nUSN');
  });

  it('keeps a floating picture’s wrapping and puts it before its paragraph’s text', async () => {
    const { blocks } = await parseDocx(await fixture());
    expect(blocks[0]).toMatchObject({ type: 'image', float: { wrap: 'square', align: 'left' } });
    expect(blocks[1]).toMatchObject({ type: 'heading', text: 'VISVESVARAYA TECHNOLOGICAL UNIVERSITY' });
    const content = cleanContent(blocksToContent(blocks, (await parseDocx(await fixture())).images));
    expect(content.content[0]).toMatchObject({ type: 'image', attrs: { wrap: 'square', align: 'left' } });
  });

  it('reads pictures placed in front of text with their offset', async () => {
    const anchor = (wrap, h) =>
      `<w:p><w:r><w:drawing><wp:anchor behindDoc="0" simplePos="0" relativeHeight="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>${h}<wp:positionV relativeFrom="paragraph"><wp:posOffset>190500</wp:posOffset></wp:positionV><wp:extent cx="952500" cy="952500"/>${wrap}<wp:docPr id="1" name="P"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r><w:r><w:t>Beside</w:t></w:r></w:p>`;
    const buf = await buildDocx(
      anchor('<wp:wrapNone/>', '<wp:positionH relativeFrom="column"><wp:posOffset>476250</wp:posOffset></wp:positionH>') +
        anchor('<wp:wrapSquare wrapText="bothSides"/>', '<wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>') +
        anchor('<wp:wrapTopAndBottom/>', '<wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>')
    );
    const { blocks } = await parseDocx(buf);
    const pictures = blocks.filter((b) => b.type === 'image');
    expect(pictures.map((b) => b.float)).toEqual([
      { wrap: 'front', align: 'left', x: 50, y: 20 },
      { wrap: 'square', align: 'right' },
      { wrap: 'inline', align: 'center' }
    ]);
    expect(blocks[0].type).toBe('image');
  });

  it('shows symbol-font characters as the symbols Word draws', async () => {
    const buf = await buildDocx(
      '<w:p><w:r><w:sym w:font="Wingdings" w:char="F0FC"/></w:r><w:r><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr><w:t>a+b</w:t></w:r><w:r><w:sym w:font="Symbol" w:char="F0B3"/></w:r><w:r><w:t xml:space="preserve"> ok</w:t></w:r></w:p>',
      { withImage: false }
    );
    const { blocks } = await parseDocx(buf);
    expect(blocks[0].runs.map((r) => r.text).join('')).toBe('✓α+β≥ ok');
  });

  it('exports free and wrapped pictures as floating Word pictures that import back', async () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: PNG, width: 100, height: 100, wrap: 'front', offsetX: 120, offsetY: 30 } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Under the picture' }] },
        { type: 'image', attrs: { src: PNG, width: 80, height: 80, wrap: 'square', align: 'right' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Beside the picture' }] }
      ]
    };
    const doc = { title: 'Pictures', content: cleanContent(content), page: { width: 816, height: 1056, margins: { top: 96, right: 96, bottom: 96, left: 96 } } };
    const { blocks } = await parseDocx(await exportDocumentToDocx(doc));
    expect(blocks.filter((b) => b.type === 'image').map((b) => b.float)).toEqual([
      { wrap: 'front', align: 'left', x: 120, y: 30 },
      { wrap: 'square', align: 'right' }
    ]);
    const pdf = await exportDocumentToPdf(doc);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('rejects unknown picture placements', () => {
    expect(() => cleanContent({ type: 'doc', content: [{ type: 'image', attrs: { src: PNG, wrap: 'behind' } }] })).toThrow(/wrap/);
  });
});
