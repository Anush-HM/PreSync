import { describe, expect, it } from 'vitest';
import { analyzeDocx, analyzeSlides, condense, outlineToSlides, sanitizeOutline, MAX_BULLETS_PER_SLIDE } from './documentAnalysis.js';

const parsed = (blocks, extra = {}) => ({ blocks, images: [], meta: { title: null, pages: null, words: null }, found: {}, ...extra });

describe('condense', () => {
  it('keeps short text and shortens long paragraphs to their first sentence', () => {
    expect(condense('Short point.')).toBe('Short point.');
    const long = `First sentence is here. ${'More words follow. '.repeat(20)}`;
    expect(condense(long)).toBe('First sentence is here.');
  });
});

describe('analyzeDocx', () => {
  it('makes a title slide and one slide per top-level section, in order', () => {
    const { analysis, outline } = analyzeDocx(parsed([
      { type: 'title', text: 'Annual plan' },
      { type: 'subtitle', text: 'Leadership offsite' },
      { type: 'paragraph', text: 'Why we are here.' },
      { type: 'heading', level: 1, text: 'Goals' },
      { type: 'paragraph', text: 'Grow revenue.' },
      { type: 'heading', level: 2, text: 'Markets' },
      { type: 'list', items: [{ text: 'Europe', level: 0, ordered: false }] },
      { type: 'heading', level: 1, text: 'Budget' },
      { type: 'table', rows: [['Item', 'Cost'], ['Laptops', '$10k']] }
    ]), 'plan.docx');

    expect(outline.map((o) => o.title)).toEqual(['Annual plan', 'Introduction', 'Goals', 'Budget']);
    expect(outline[0]).toMatchObject({ layout: 'title', subtitle: 'Leadership offsite' });
    expect(outline[2].bullets).toEqual([
      { text: 'Grow revenue.', level: 0 },
      { text: 'Markets', level: 0 },
      { text: 'Europe', level: 1 }
    ]);
    expect(outline[2].notes).toContain('Grow revenue.');
    expect(outline[3].bullets).toEqual([{ text: 'Item · Cost', level: 0 }, { text: 'Laptops · $10k', level: 1 }]);

    expect(analysis).toMatchObject({
      kind: 'docx',
      title: 'Annual plan',
      majorTopics: ['Introduction', 'Goals', 'Budget'],
      suggestedSlides: 4,
      stats: { headings: 3, paragraphs: 2, listItems: 1, tables: 1, images: 0 }
    });
    expect(analysis.headings.map((h) => [h.level, h.text, h.startsSlide])).toEqual([[1, 'Goals', true], [2, 'Markets', false], [1, 'Budget', true]]);
    expect(analysis.warnings.join(' ')).toMatch(/1 table was converted/);
  });

  it('treats a lone leading heading as the title and splits on the next level', () => {
    const { outline } = analyzeDocx(parsed([
      { type: 'heading', level: 1, text: 'Handbook' },
      { type: 'heading', level: 2, text: 'Welcome' },
      { type: 'paragraph', text: 'Hello.' },
      { type: 'heading', level: 2, text: 'Benefits' },
      { type: 'paragraph', text: 'Health.' }
    ]), 'handbook.docx');
    expect(outline.map((o) => o.title)).toEqual(['Handbook', 'Welcome', 'Benefits']);
  });

  it('continues long sections onto extra slides', () => {
    const items = Array.from({ length: MAX_BULLETS_PER_SLIDE + 2 }, (_, i) => ({ text: `Point ${i + 1}`, level: 0, ordered: false }));
    const { outline } = analyzeDocx(parsed([
      { type: 'heading', level: 1, text: 'Plan' },
      { type: 'list', items },
      { type: 'heading', level: 1, text: 'Next' },
      { type: 'paragraph', text: 'Go.' }
    ]), 'x.docx');
    expect(outline.map((o) => o.title)).toEqual(['x', 'Plan', 'Plan (continued)', 'Next']);
    expect(outline[2].bullets).toHaveLength(2);
  });

  it('splits documents without headings every few paragraphs and says so', () => {
    const blocks = Array.from({ length: 6 }, (_, i) => ({ type: 'paragraph', text: `Paragraph ${i + 1} text.` }));
    const { analysis, outline } = analyzeDocx(parsed(blocks), 'notes.docx');
    expect(outline).toHaveLength(3);
    expect(analysis.warnings[0]).toMatch(/No headings were found/);
  });

  it('refuses an empty document', () => {
    expect(() => analyzeDocx(parsed([]), 'empty.docx')).toThrow(/no readable text/);
  });
});

describe('analyzeSlides', () => {
  it('uses detected titles, lists unsupported content per slide, and builds a source outline', () => {
    const slides = [
      { id: 's1', blocks: [{ id: 'a', type: 'textbox', text: 'Kickoff', fontSize: 40, y: 10 }], notes: '' },
      { id: 's2', blocks: [{ id: 'b', type: 'textbox', text: 'Small title', fontSize: 20, y: 10 }, { id: 'c', type: 'textbox', text: '• One\n• Two', fontSize: 18, y: 100 }], notes: 'Say hi' },
      { id: 's3', blocks: [], notes: '' }
    ];
    const details = [{}, { title: 'Agenda', tables: 1 }, { charts: 2 }];
    const { analysis, outline } = analyzeSlides(slides, { kind: 'pptx', fileName: 'deck.pptx', details });

    expect(analysis.title).toBe('Kickoff');
    expect(analysis.slideCount).toBe(3);
    expect(analysis.headings.map((h) => h.text)).toEqual(['Kickoff', 'Agenda']);
    expect(outline[0]).toMatchObject({ layout: 'title', title: 'Kickoff' });
    expect(outline[1]).toMatchObject({ title: 'Agenda', notes: 'Say hi' });
    expect(outline[1].bullets.map((b) => b.text)).toEqual(['Small title', 'One', 'Two']);
    expect(outline[2].title).toBe('Slide 3');
    const text = analysis.warnings.join(' ');
    expect(text).toMatch(/Slide 3 had nothing/);
    expect(text).toMatch(/slide 2 \(1 table\); slide 3 \(2 charts\)/);
  });
});

describe('sanitizeOutline / outlineToSlides', () => {
  it('cleans client input and drops unknown images', () => {
    const clean = sanitizeOutline(
      [{ id: 'o1', layout: 'weird', title: '  Hi ', bullets: [{ text: 'x', level: 7 }, { text: '' }], imageId: 'nope' }],
      new Set(['img-1'])
    );
    expect(clean).toEqual([{ id: 'o1', layout: 'content', title: 'Hi', subtitle: '', bullets: [{ text: 'x', level: 2 }], notes: '', imageId: null }]);
    expect(() => sanitizeOutline([])).toThrow();
    expect(() => sanitizeOutline('x')).toThrow();
  });

  it('lays out title and content slides, with a fitted picture beside the bullets', () => {
    const outline = sanitizeOutline([
      { layout: 'title', title: 'Deck', subtitle: 'Sub' },
      { title: 'Points', bullets: [{ text: 'A', level: 0 }, { text: 'B', level: 1 }], notes: 'n', imageId: 'img-1' }
    ], new Set(['img-1']));
    const slides = outlineToSlides(outline, [{ id: 'img-1', dataUrl: 'data:image/png;base64,AA', widthPx: 200, heightPx: 100 }]);

    expect(slides).toHaveLength(2);
    expect(slides[0].blocks.map((b) => b.text)).toEqual(['Deck', 'Sub']);
    const [title, body, image] = slides[1].blocks;
    expect(title).toMatchObject({ text: 'Points', fontWeight: 'bold' });
    expect(body.text).toBe('• A\n    – B');
    expect(body.width).toBe(500);
    expect(image).toMatchObject({ type: 'image', imageUrl: 'data:image/png;base64,AA', width: 320, height: 160 });
    expect(slides[1]).toMatchObject({ id: 'slide-2', order: 1, notes: 'n' });
  });
});
