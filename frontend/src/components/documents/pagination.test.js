import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { documentExtensions } from './documentExtensions.js';
import { layoutBlocks } from './pagination.js';
import {
  borderOnPage, dateTexts, displayNumber, fillTokens, formatPageRanges, isLinked, parsePageRanges, setLinked, toRoman, zoneOwner, zoneSlots, zoneTexts
} from './pageLayout.js';

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

  it('keeps callouts and images whole', () => {
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

  it('gives even pages their own texts when asked', () => {
    const both = { ...layout, pageNumbers: null, differentOddEven: true, even: { header: { left: 'Even', center: '', right: '' }, footer: layout.footer } };
    expect(zoneTexts(both, 'header', 1).left).toBe('Even');
    expect(zoneTexts(both, 'header', 2).right).toBe('R');
  });

  it('offers both date formats', () => {
    const [short, long] = dateTexts(new Date(2026, 9, 5));
    expect(short.text).toBe('05/10/2026');
    expect(long.text).toBe('October 05, 2026');
  });

  it('numbers from a start page, with an offset and in roman numerals', () => {
    const numbers = { position: 'bottom-center', format: 'plain', startPage: 3, restartAt: 1 };
    const on = { ...layout, pageNumbers: numbers };
    expect(zoneTexts(on, 'footer', 1).center).toBe('');
    expect(zoneTexts(on, 'footer', 2).center).toBe('{page}');
    expect(displayNumber(numbers, 3)).toBe('1');
    expect(displayNumber(numbers, 5)).toBe('3');
    expect(displayNumber({ ...numbers, restartAt: null }, 5)).toBe('5');
    expect(displayNumber({ ...numbers, format: 'roman' }, 6)).toBe('iv');
    expect(toRoman(49)).toBe('xlix');
    expect(fillTokens('Page {page} of {pages}', { page: 4, pages: 7, title: '', numbers })).toBe('Page 2 of 5');
  });

  it('keeps an unlinked page and the pages after it apart from earlier ones', () => {
    const base = { ...layout, pageNumbers: null, header: { left: 'Shared', center: '', right: '' } };
    expect(isLinked(base, 'header', 2)).toBe(true);
    const split = setLinked(base, 'header', 2, false);
    expect(zoneOwner(split, 'header', 1)).toBeNull();
    expect(zoneOwner(split, 'header', 4)).toBe(2);
    const edited = { ...split, sections: { header: { 2: { left: 'Own', center: '', right: '' } } } };
    expect(zoneSlots(edited, 'header', 1).left).toBe('Shared');
    expect(zoneSlots(edited, 'header', 2).left).toBe('Own');
    expect(zoneSlots(edited, 'header', 3).left).toBe('Own');
    expect(isLinked(edited, 'header', 2)).toBe(false);
    expect(isLinked(edited, 'header', 3)).toBe(true);
    expect(zoneSlots({ ...edited, header: { left: 'Changed', center: '', right: '' } }, 'header', 2).left).toBe('Own');
    expect(zoneSlots(setLinked(edited, 'header', 2, true), 'header', 2).left).toBe('Shared');
  });

  it('limits a border to its scope', () => {
    const on = (scope, pages = '') => [0, 1, 2, 3].map((i) => borderOnPage({ scope, pages }, i));
    expect(on('all')).toEqual([true, true, true, true]);
    expect(on('first')).toEqual([true, false, false, false]);
    expect(on('exceptFirst')).toEqual([false, true, true, true]);
    expect(on('pages', '1, 3-4')).toEqual([true, false, true, true]);
    expect(formatPageRanges(new Set([7, 1, 3, 5, 6]))).toBe('1, 3, 5-7');
  });

  it('reads page ranges', () => {
    expect([...parsePageRanges('1, 3-4')]).toEqual([1, 3, 4]);
    expect(borderOnPage({ scope: 'pages', pages: '2' }, 1)).toBe(true);
    expect(borderOnPage(null, 0)).toBe(false);
  });
});
