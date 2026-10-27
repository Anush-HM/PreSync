import { describe, expect, it } from 'vitest';
import { parseDocx, DocxParseError } from './docxIngestService.js';
import { buildDocx, li, p, picture, table } from '../test/buildDocx.js';

describe('parseDocx', () => {
  it('reads headings, paragraphs, lists, tables and pictures in order', async () => {
    const buf = await buildDocx(
      [
        p('Annual plan', 'Title'),
        p('For the leadership team', 'Subtitle'),
        p('Goals', 'Heading1'),
        p('We want to grow.'),
        li('Revenue', 1),
        li('New markets', 1, 1),
        li('Hire', 2),
        p('Budget', 'MySection'),
        table([['Item', 'Cost'], ['Laptops', '$10k']]),
        picture('rIdImg')
      ].join(''),
      { title: 'Plan 2027', pages: 7 }
    );

    const { blocks, images, meta } = await parseDocx(buf);

    expect(blocks.map((b) => b.type)).toEqual(['title', 'subtitle', 'heading', 'paragraph', 'list', 'list', 'heading', 'table', 'image']);
    expect(blocks[2]).toMatchObject({ type: 'heading', level: 1, text: 'Goals' });
    expect(blocks[4].items).toMatchObject([
      { text: 'Revenue', level: 0, ordered: false },
      { text: 'New markets', level: 1, ordered: false }
    ]);
    expect(blocks[5].items).toMatchObject([{ text: 'Hire', level: 0, ordered: true }]);
    // "My Section" is based on Heading 1
    expect(blocks[6]).toMatchObject({ type: 'heading', level: 1, text: 'Budget' });
    expect(blocks[7].rows).toEqual([['Item', 'Cost'], ['Laptops', '$10k']]);
    expect(blocks[8]).toEqual({ type: 'image', imageId: 'img-1' });
    expect(images[0]).toMatchObject({ id: 'img-1', mime: 'image/png', widthPx: 200, heightPx: 100 });
    expect(images[0].dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(meta).toMatchObject({ title: 'Plan 2027', pages: 7 });
  });

  it('skips deleted text, keeps inserted text and flags what it did not import', async () => {
    const body = [
      '<w:p><w:r><w:t>Keep </w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:ins><w:r><w:t>added</w:t></w:r></w:ins></w:p>',
      '<w:p><w:r><w:drawing><wp:anchor><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></wp:anchor></w:drawing></w:r></w:p>',
      '<w:p><w:r><w:txbxContent><w:p><w:r><w:t>In a box</w:t></w:r></w:p></w:txbxContent></w:r></w:p>',
      picture('rIdEmf')
    ].join('');
    const { blocks, found } = await parseDocx(await buildDocx(body));
    expect(blocks).toMatchObject([{ type: 'paragraph', text: 'Keep added' }]);
    expect(found).toMatchObject({ trackedChanges: true, charts: true, textBoxes: true, unsupportedImages: 1 });
  });

  it('reads lists whose numbering comes from the paragraph style', async () => {
    const buf = await buildDocx([p('One', 'ListBullet'), p('Nested', 'ListBullet2'), p('Plain'), p('First', 'ListNumber')].join(''));
    const { blocks } = await parseDocx(buf);
    expect(blocks).toMatchObject([
      { type: 'list', items: [{ text: 'One', level: 0, ordered: false }, { text: 'Nested', level: 1, ordered: false }] },
      { type: 'paragraph', text: 'Plain' },
      { type: 'list', items: [{ text: 'First', level: 0, ordered: true }] }
    ]);
  });

  it('rejects files that are not a docx', async () => {
    await expect(parseDocx(Buffer.from('hello'))).rejects.toBeInstanceOf(DocxParseError);
  });
});
