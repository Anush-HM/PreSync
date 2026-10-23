import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getSlidesArray, plainToSlideMap, slideMapToPlain } from './yjsClient.js';
import {
  deleteBlocks,
  deleteSlide,
  duplicateBlocks,
  duplicateSlide,
  moveSlide,
  restackBlock,
  updateBlocks,
  updateSlide
} from './deckOps.js';

function block(id, extra = {}) {
  return { id, type: 'textbox', x: 10, y: 10, width: 100, fontSize: 16, text: id, ...extra };
}

function docWith(slides) {
  const doc = new Y.Doc();
  getSlidesArray(doc).push(slides.map(plainToSlideMap));
  return doc;
}

const read = (doc) => getSlidesArray(doc).toArray().map(slideMapToPlain);

describe('block edits', () => {
  it('sets formatting on only the listed blocks and clears null fields', () => {
    const doc = docWith([{ id: 's1', order: 0, blocks: [block('a', { fill: '#ff0000' }), block('b')] }]);
    updateBlocks(doc, 0, ['a'], { fontWeight: 'bold', textAlign: 'center', fill: null });
    const [a, b] = read(doc)[0].blocks;
    expect(a).toMatchObject({ fontWeight: 'bold', textAlign: 'center' });
    expect(a.fill).toBeUndefined();
    expect(b.fontWeight).toBeUndefined();
  });

  it('duplicates blocks with new ids, offset, keeping formatting', () => {
    const doc = docWith([{ id: 's1', order: 0, blocks: [block('a', { fontStyle: 'italic' })] }]);
    const [copyId] = duplicateBlocks(doc, 0, ['a']);
    const blocks = read(doc)[0].blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ id: copyId, x: 30, y: 30, fontStyle: 'italic', text: 'a' });
    expect(copyId).not.toBe('a');
  });

  it('deletes several blocks at once', () => {
    const doc = docWith([{ id: 's1', order: 0, blocks: [block('a'), block('b'), block('c')] }]);
    deleteBlocks(doc, 0, ['a', 'c']);
    expect(read(doc)[0].blocks.map((b) => b.id)).toEqual(['b']);
  });

  it('restacks blocks forward, backward, to front and to back', () => {
    const doc = docWith([{ id: 's1', order: 0, blocks: [block('a'), block('b'), block('c')] }]);
    const ids = () => read(doc)[0].blocks.map((b) => b.id);
    restackBlock(doc, 0, 'a', 'forward');
    expect(ids()).toEqual(['b', 'a', 'c']);
    restackBlock(doc, 0, 'c', 'back');
    expect(ids()).toEqual(['c', 'b', 'a']);
    restackBlock(doc, 0, 'c', 'front');
    expect(ids()).toEqual(['b', 'a', 'c']);
    restackBlock(doc, 0, 'b', 'backward'); // already at the back: no-op
    expect(ids()).toEqual(['b', 'a', 'c']);
  });
});

describe('slide edits', () => {
  it('sets background and speaker notes', () => {
    const doc = docWith([{ id: 's1', order: 0, blocks: [] }]);
    updateSlide(doc, 0, { backgroundColor: '#112233', notes: 'Say hi' });
    expect(read(doc)[0]).toMatchObject({ backgroundColor: '#112233', notes: 'Say hi' });
  });

  it('duplicates a slide right after itself with fresh ids', () => {
    const doc = docWith([
      { id: 's1', order: 0, notes: 'n', backgroundColor: '#000000', blocks: [block('a')] },
      { id: 's2', order: 1, blocks: [] }
    ]);
    expect(duplicateSlide(doc, 0)).toBe(1);
    const slides = read(doc);
    expect(slides.map((s) => s.id)[2]).toBe('s2');
    expect(slides[1]).toMatchObject({ notes: 'n', backgroundColor: '#000000' });
    expect(slides[1].id).not.toBe('s1');
    expect(slides[1].blocks[0].id).not.toBe('a');
    expect(slides[1].blocks[0].text).toBe('a');
  });

  it('moves slides within bounds', () => {
    const doc = docWith(['s1', 's2', 's3'].map((id, order) => ({ id, order, blocks: [block(`${id}-b`)] })));
    expect(moveSlide(doc, 0, 1)).toBe(1);
    expect(read(doc).map((s) => s.id)).toEqual(['s2', 's1', 's3']);
    expect(moveSlide(doc, 0, -1)).toBe(0);
    expect(read(doc)[1].blocks[0].id).toBe('s1-b');
  });

  it('never deletes the last slide', () => {
    const doc = docWith([{ id: 's1', order: 0, blocks: [] }]);
    deleteSlide(doc, 0);
    expect(read(doc)).toHaveLength(1);
  });

  it('is undoable as one step per edit', () => {
    const doc = docWith([{ id: 's1', order: 0, blocks: [block('a')] }]);
    const undo = new Y.UndoManager(getSlidesArray(doc));
    updateBlocks(doc, 0, ['a'], { fontWeight: 'bold', underline: true });
    undo.undo();
    expect(read(doc)[0].blocks[0].fontWeight).toBeUndefined();
    expect(read(doc)[0].blocks[0].underline).toBeUndefined();
  });
});
