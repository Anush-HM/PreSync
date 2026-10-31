import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { documentExtensions } from './documentExtensions.js';
import { layoutBlocks } from './pagination.js';
import { borderOnPage, fillTokens, parsePageRanges, zoneTexts } from './pageLayout.js';

const schema = getSchema(documentExtensions);
const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const cell = (t) => ({ type: 'tableCell', content: [para(t)] });
const doc = (...content) => Node.fromJSON(schema, { type: 'doc', content });

describe('layoutBlocks', () => {
  it('moves a list as a whole from its first item, and items after that one by one', () => {
    const blocks = layoutBlocks(doc({ type: 'bulletList', content: [{ type: 'listItem', content: [para('a')] }, { type: 'listItem', content: [para('b')] }] }));
    expect(blocks).toHaveLength(2);
    expect(blocks[0].anchor).toBe(0);
    expect(blocks[1].anchor).toBe(blocks[1].pos - 1);
    expect(blocks[1].kind).toBe('text');
  });

  it('breaks tables between rows', () => {
    const row = (t) => ({ type: 'tableRow', content: [cell(t)] });
    const blocks = layoutBlocks(doc({ type: 'table', content: [row('a'), row('b')] }));
    expect(blocks.map((b) => b.kind)).toEqual(['block', 'row']);
    expect(blocks[0].anchor).toBe(0);
  });

  it('keeps callouts and pictures whole', () => {
    const blocks = layoutBlocks(doc({ type: 'callout', attrs: { tone: 'info' }, content: [para('a'), para('b')] }, para('c')));
    expect(blocks.map((b) => b.node.type.name)).toEqual(['callout', 'paragraph']);
  });
});

describe('pageLayout', () => {
  const layout = { header: { left: '', center: '', right: 'R' }, footer: { left: '', center: '', right: '' }, differentFirstPage: false, pageNumbers: { position: 'top-right', format: 'plain', hideOnFirst: false }, pageBorder: null };

  it('joins numbers to text in the same slot and fills tokens', () => {
    const { right } = zoneTexts(layout, 'header', 2);
    expect(right).toBe('R {page}');
    expect(fillTokens(right, { page: 3, pages: 9, title: 'T' })).toBe('R 3');
  });

  it('reads page ranges', () => {
    expect([...parsePageRanges('1, 3-4')]).toEqual([1, 3, 4]);
    expect(borderOnPage({ scope: 'pages', pages: '2' }, 1)).toBe(true);
    expect(borderOnPage(null, 0)).toBe(false);
  });
});
