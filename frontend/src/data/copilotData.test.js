import { describe, expect, it } from 'vitest';
import { analyzeSlideLayout, collectFixes, contrastRatio } from './layoutAnalysis.js';
import { buildCopilotContext, rankSlides, snapshotFor } from './copilotContext.js';
import { ASSETS, getAsset, searchAssets } from './assetLibrary.js';
import { buildOutlineSlide, layoutPatches, LAYOUTS } from './copilotLayouts.js';

const tb = (id, props) => ({ id, type: 'textbox', fontSize: 18, text: 'Some text', x: 80, y: 100, width: 300, ...props });

describe('analyzeSlideLayout', () => {
  it('flags objects off the slide and suggests moving them back', () => {
    const report = analyzeSlideLayout({ blocks: [tb('a', { x: 800, width: 300 })] });
    const f = report.findings.find((x) => x.kind === 'off-slide');
    expect(f.fixes[0]).toMatchObject({ blockId: 'a' });
    expect(f.fixes[0].x + f.fixes[0].width).toBeLessThanOrEqual(960);
  });

  it('only reports text overflow when the editor measured the text', () => {
    const slide = { blocks: [tb('a', { y: 450 })] };
    expect(analyzeSlideLayout(slide).findings.some((f) => f.kind === 'text-overflow')).toBe(false);
    const measured = new Map([['a', { height: 200 }]]);
    const report = analyzeSlideLayout(slide, { measured });
    expect(report.measured).toBe(true);
    expect(report.findings.find((f) => f.kind === 'text-overflow').fixes[0]).toMatchObject({ blockId: 'a', y: 316 });
  });

  it('finds overlapping text, near-miss alignment, small type and low contrast', () => {
    const slide = {
      backgroundColor: '#ffffff',
      blocks: [
        tb('title', { role: 'title', x: 80, y: 40, width: 700 }),
        tb('a', { x: 85, y: 120 }),
        tb('b', { x: 86, y: 130, fontSize: 9, fill: '#eeeeee' })
      ]
    };
    const measured = new Map([['title', { height: 40 }], ['a', { height: 40 }], ['b', { height: 40 }]]);
    const kinds = analyzeSlideLayout(slide, { measured }).findings.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['overlap', 'alignment', 'small-text', 'contrast']));
    const fixes = collectFixes(analyzeSlideLayout(slide, { measured }));
    expect(fixes.find((f) => f.blockId === 'a')).toMatchObject({ x: 80 });
    expect(fixes.find((f) => f.blockId === 'b')).toMatchObject({ x: 80, fontSize: 14 });
  });

  it('is quiet for a clean slide', () => {
    const slide = { blocks: [tb('t', { role: 'title', x: 80, y: 40 }), tb('b', { x: 80, y: 140 })] };
    const measured = new Map([['t', { height: 40 }], ['b', { height: 60 }]]);
    expect(analyzeSlideLayout(slide, { measured }).findings).toEqual([]);
  });

  it('computes WCAG contrast', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff'))).toBe(21);
  });
});

describe('buildCopilotContext', () => {
  const slides = [
    { id: 's1', blocks: [tb('t1', { role: 'title', text: 'Intro' }), tb('x1', { text: 'Hello everyone' })] },
    { id: 's2', blocks: [tb('t2', { role: 'title', text: 'Pricing' }), tb('x2', { text: 'Our pricing tiers are basic and premium' })] },
    { id: 's3', blocks: [tb('t3', { role: 'title', text: 'Team' }), tb('x3', { text: 'Meet the team' })] }
  ];

  it('describes the selection and the active slide with geometry', () => {
    const ctx = buildCopilotContext({
      deckTitle: 'Deck',
      slides,
      activeIdx: 1,
      selectedIds: [],
      textSelection: { blockId: 'x2', start: 4, end: 11, text: 'pricing' },
      scope: 'selection',
      measured: new Map([['x2', { height: 30 }]])
    });
    expect(ctx.selection).toMatchObject({ blockId: 'x2', text: 'pricing', start: 4, end: 11 });
    expect(ctx.activeSlide.blocks[1]).toMatchObject({ id: 'x2', x: 80, measuredHeight: 30 });
    expect(ctx.slides.map((s) => s.title)).toEqual(['Intro', 'Pricing', 'Team']);
    expect(ctx.slides[0].text).toBeUndefined(); // other slides only by title
    expect(ctx.layoutReport.measured).toBe(true);
  });

  it('falls back to the slide when nothing is selected', () => {
    const ctx = buildCopilotContext({ slides, activeIdx: 0, scope: 'selection' });
    expect(ctx.scope).toBe('slide');
    expect(ctx.selection).toBeNull();
  });

  it('only offers library assets', () => {
    const ctx = buildCopilotContext({ slides, activeIdx: 0, scope: 'slide', message: 'celebration stickers' });
    expect(ctx.assets.length).toBeGreaterThan(0);
    expect(ctx.assets.every((a) => getAsset(a.id))).toBe(true);
    expect(ctx.assets.slice(0, 3).every((a) => a.category === 'celebration' || a.tags.includes('celebrate'))).toBe(true);
  });

  it('sends whole decks when small and abridges unrelated slides in large ones', () => {
    const small = buildCopilotContext({ slides, activeIdx: 0, scope: 'deck', message: 'summarize' });
    expect(small.slides[1].text).toContain('pricing');
    expect(small.truncated).toBe(false);

    const big = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, blocks: [tb(`t${i}`, { role: 'title', text: `Slide ${i}` }), tb(`b${i}`, { text: `${i === 30 ? 'quantum computing ' : ''}${'filler words here '.repeat(60)}` })] }));
    const ctx = buildCopilotContext({ slides: big, activeIdx: 0, scope: 'deck', message: 'What do we say about quantum computing?' });
    expect(ctx.truncated).toBe(true);
    expect(ctx.slides[30].abridged).toBeUndefined();
    expect(ctx.slides[30].text).toContain('quantum computing');
    expect(ctx.slides[20].abridged).toBe(true);
    expect(rankSlides(big, 'quantum computing')[0].index).toBe(30);
  });

  it('records slide ids and the selected text for later conflict checks', () => {
    const ctx = buildCopilotContext({ slides, activeIdx: 1, scope: 'selection', selectedIds: ['x2'] });
    const snap = snapshotFor(slides, 1, ctx, null);
    expect(snap).toMatchObject({ slideIds: ['s1', 's2', 's3'], activeSlideId: 's2', selection: { slideId: 's2', blockId: 'x2', fullText: 'Our pricing tiers are basic and premium', start: null } });
  });
});

describe('asset library', () => {
  it('has unique ids and licensing on every asset', () => {
    expect(new Set(ASSETS.map((a) => a.id)).size).toBe(ASSETS.length);
    expect(ASSETS.every((a) => a.license?.name && (a.emoji || a.svg?.startsWith('<svg')))).toBe(true);
  });

  it('finds relevant assets and nothing for unrelated queries', () => {
    expect(searchAssets('education icons').map((a) => a.category)).toContain('education');
    expect(searchAssets('rocket launch').slice(0, 2).map((a) => a.id)).toEqual(expect.arrayContaining(['sticker-rocket']));
    expect(searchAssets('nature', { kinds: ['emoji'] }).every((a) => a.kind === 'emoji' && (a.category === 'nature' || a.tags.includes('nature')))).toBe(true);
    expect(searchAssets('zzzqqq')).toEqual([]);
  });
});

describe('layouts', () => {
  it('builds outline slides inside the canvas', () => {
    for (const l of LAYOUTS) {
      const s = buildOutlineSlide({ title: 'T', bullets: ['a', 'b', 'c'], notes: 'n' }, { layoutId: l.id });
      expect(s.blocks[0].role).toBe('title');
      s.blocks.forEach((b) => expect(b.x + b.width).toBeLessThanOrEqual(960));
      expect(s.notes).toBe('n');
    }
  });

  it('leaves decoration alone when re-laying out a slide', () => {
    const slide = { blocks: [tb('d', { role: 'decor', x: 0, y: 0 }), tb('t', { role: 'title' }), tb('b', { y: 200 })] };
    const ids = layoutPatches(slide, 'title-bullets').map((p) => p.blockId);
    expect(ids).toEqual(['t', 'b']);
  });
});
