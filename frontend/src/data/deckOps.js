import { blockMapToPlain, getSlidesArray, plainToBlockMap, plainToSlideMap, slideMapToPlain } from './yjsClient.js';

// Pure Y.Doc edits used by the editor. Each runs in one transaction so
// it is a single undo step and reaches collaborators atomically.

export function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makeBlankSlide(order) {
  return {
    id: newId('slide'),
    order,
    needsImageFallback: false,
    notes: '',
    blocks: [
      { id: newId('b'), type: 'textbox', x: 80, y: 60, width: 700, fontSize: 36, fontWeight: 'bold', text: 'New slide' },
      { id: newId('b'), type: 'textbox', x: 80, y: 130, width: 700, fontSize: 18, text: 'Click to add text' }
    ]
  };
}

function findBlockIndex(blocksArr, blockId) {
  for (let i = 0; i < blocksArr.length; i++) {
    if (blocksArr.get(i).get('id') === blockId) return i;
  }
  return -1;
}

export function getBlocksArray(doc, slideIdx) {
  return getSlidesArray(doc).get(slideIdx)?.get('blocks') ?? null;
}

// Sets fields on every listed block of a slide.
export function updateBlocks(doc, slideIdx, blockIds, patch) {
  const blocksArr = getBlocksArray(doc, slideIdx);
  if (!blocksArr) return;
  doc.transact(() => {
    blocksArr.forEach((blockMap) => {
      if (!blockIds.includes(blockMap.get('id'))) return;
      Object.entries(patch).forEach(([key, value]) => {
        if (value === undefined || value === null) blockMap.delete(key);
        else blockMap.set(key, value);
      });
    });
  });
}

export function addBlock(doc, slideIdx, block) {
  const blocksArr = getBlocksArray(doc, slideIdx);
  if (!blocksArr) return;
  doc.transact(() => blocksArr.push([plainToBlockMap(block)]));
}

export function deleteBlocks(doc, slideIdx, blockIds) {
  const blocksArr = getBlocksArray(doc, slideIdx);
  if (!blocksArr) return;
  doc.transact(() => {
    for (let i = blocksArr.length - 1; i >= 0; i--) {
      if (blockIds.includes(blocksArr.get(i).get('id'))) blocksArr.delete(i, 1);
    }
  });
}

// Copies blocks onto the same slide, nudged so the copy is visible.
// Returns the new block ids.
export function duplicateBlocks(doc, slideIdx, blockIds) {
  const blocksArr = getBlocksArray(doc, slideIdx);
  if (!blocksArr) return [];
  const copies = blocksArr
    .toArray()
    .filter((m) => blockIds.includes(m.get('id')))
    .map((m) => {
      const plain = blockMapToPlain(m);
      return { ...plain, id: newId('b'), x: plain.x + 20, y: plain.y + 20 };
    });
  doc.transact(() => blocksArr.push(copies.map(plainToBlockMap)));
  return copies.map((b) => b.id);
}

// Changes a block's stacking position. `to` is 'forward', 'backward',
// 'front' or 'back'. Later blocks in the array draw on top.
export function restackBlock(doc, slideIdx, blockId, to) {
  const blocksArr = getBlocksArray(doc, slideIdx);
  if (!blocksArr) return;
  const from = findBlockIndex(blocksArr, blockId);
  if (from < 0) return;
  const last = blocksArr.length - 1;
  const target = { forward: from + 1, backward: from - 1, front: last, back: 0 }[to];
  if (target === undefined || target < 0 || target > last || target === from) return;
  doc.transact(() => {
    const plain = blockMapToPlain(blocksArr.get(from));
    blocksArr.delete(from, 1);
    blocksArr.insert(target, [plainToBlockMap(plain)]);
  });
}

export function updateSlide(doc, slideIdx, patch) {
  const slideMap = getSlidesArray(doc).get(slideIdx);
  if (!slideMap) return;
  doc.transact(() => {
    Object.entries(patch).forEach(([key, value]) => {
      if (value === undefined || value === null) slideMap.delete(key);
      else slideMap.set(key, value);
    });
  });
}

export function insertSlide(doc, index, slide) {
  const slidesArr = getSlidesArray(doc);
  doc.transact(() => slidesArr.insert(index, [plainToSlideMap(slide)]));
}

// Copies a slide (with fresh slide and block ids) right after itself.
// Returns the copy's index.
export function duplicateSlide(doc, slideIdx) {
  const slidesArr = getSlidesArray(doc);
  const source = slidesArr.get(slideIdx);
  if (!source) return slideIdx;
  const plain = slideMapToPlain(source);
  const copy = {
    ...plain,
    id: newId('slide'),
    blocks: plain.blocks.map((b) => ({ ...b, id: newId('b') }))
  };
  insertSlide(doc, slideIdx + 1, copy);
  return slideIdx + 1;
}

// Moves a slide by `delta` positions. Returns its new index.
export function moveSlide(doc, slideIdx, delta) {
  const slidesArr = getSlidesArray(doc);
  const target = slideIdx + delta;
  if (!slidesArr.get(slideIdx) || target < 0 || target >= slidesArr.length) return slideIdx;
  doc.transact(() => {
    const plain = slideMapToPlain(slidesArr.get(slideIdx));
    slidesArr.delete(slideIdx, 1);
    slidesArr.insert(target, [plainToSlideMap(plain)]);
  });
  return target;
}

export function deleteSlide(doc, slideIdx) {
  const slidesArr = getSlidesArray(doc);
  if (slidesArr.length <= 1 || !slidesArr.get(slideIdx)) return;
  doc.transact(() => slidesArr.delete(slideIdx, 1));
}
