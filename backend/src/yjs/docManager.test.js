import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('../models/Deck.js', () => ({
  default: { findById: vi.fn(), findByIdAndUpdate: vi.fn() }
}));

const { default: Deck } = await import('../models/Deck.js');
const { plainToSlideMap, docToSlides, getDoc, releaseDoc, flushDoc } = await import('./docManager.js');

const formattedSlide = {
  id: 's1',
  order: 0,
  needsImageFallback: false,
  backgroundColor: '#112233',
  notes: 'Mention the Q3 numbers',
  blocks: [
    {
      id: 'b1',
      type: 'textbox',
      x: 10,
      y: 20,
      width: 300,
      fontSize: 24,
      text: 'Hello',
      fontFamily: 'Georgia, serif',
      fontWeight: 'bold',
      fontStyle: 'italic',
      underline: true,
      fill: '#e74c3c',
      textAlign: 'center',
      lineHeight: 1.4
    },
    { id: 'b2', type: 'image', x: 0, y: 0, width: 100, height: 50, fontSize: 16, text: '', imageUrl: 'https://example.com/a.png' }
  ]
};

function docWith(slides) {
  const doc = new Y.Doc();
  doc.getArray('slides').push(slides.map(plainToSlideMap));
  return doc;
}

afterEach(() => vi.clearAllMocks());

describe('Y.Doc <-> plain slide mapping', () => {
  it('round-trips text formatting, slide background and speaker notes', () => {
    expect(docToSlides(docWith([formattedSlide]))).toEqual([formattedSlide]);
  });

  it('leaves unset formatting out instead of writing nulls', () => {
    const [slide] = docToSlides(
      docWith([{ id: 's1', order: 0, blocks: [{ id: 'b1', x: 0, y: 0, width: 80, text: 'Hi' }] }])
    );
    expect(slide).toEqual({
      id: 's1',
      order: 0,
      needsImageFallback: false,
      notes: '',
      blocks: [{ id: 'b1', type: 'textbox', x: 0, y: 0, width: 80, fontSize: 16, text: 'Hi' }]
    });
  });

  it('renumbers order from array position', () => {
    const slides = docToSlides(
      docWith([
        { id: 'a', order: 5, blocks: [] },
        { id: 'b', order: 2, blocks: [] }
      ])
    );
    expect(slides.map((s) => [s.id, s.order])).toEqual([
      ['a', 0],
      ['b', 1]
    ]);
  });
});

describe('flushDoc', () => {
  it('persists a live doc immediately', async () => {
    Deck.findById.mockReturnValue({ lean: () => Promise.resolve({ slides: [formattedSlide] }) });
    Deck.findByIdAndUpdate.mockReturnValue({ exec: () => Promise.resolve() });

    const doc = await getDoc('deck-live');
    doc.getArray('slides').get(0).get('blocks').get(0).set('text', 'Edited');

    expect(await flushDoc('deck-live')).toBe(true);
    const [, update] = Deck.findByIdAndUpdate.mock.calls.at(-1);
    expect(update.slides[0].blocks[0].text).toBe('Edited');
    expect(update.slides[0].blocks[0].fontWeight).toBe('bold');

    releaseDoc('deck-live');
  });

  it('reports false when nobody is editing the deck', async () => {
    expect(await flushDoc('deck-idle')).toBe(false);
    expect(Deck.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
