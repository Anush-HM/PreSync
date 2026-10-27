import { describe, expect, it } from 'vitest';
import { applyLayout, layoutById, LAYOUTS, slideFromLayout } from './layouts.js';
import { applyTheme, themeById, THEMES } from './themes.js';
import { alignBoxes, distributeBoxes, expandToGroups } from './arrange.js';
import { cropInsets, cropPatch, replaceImagePatch } from './imageOps.js';
import { addCategory, addSeries, chartFromGrid, defaultChart, removeCategory, setValue } from './chartOps.js';
import { SHAPES } from './shapes.js';

describe('layouts', () => {
  it('moves existing content into the slots and only fills empty ones', () => {
    const slide = {
      blocks: [
        { id: 't', type: 'textbox', role: 'title', text: 'Roadmap', x: 300, y: 300, width: 200, fontSize: 20 },
        { id: 'b', type: 'textbox', text: 'Points', x: 10, y: 10, width: 100, fontSize: 14 },
        { id: 'd', type: 'shape', role: 'decor', x: 0, y: 0, width: 10, height: 10 }
      ]
    };
    const { blocks, added, moved } = applyLayout(slide, layoutById('two-column'));
    expect(moved).toBe(2);
    expect(added).toBe(1); // the empty right column
    const title = blocks.find((b) => b.id === 't');
    expect(title).toMatchObject({ text: 'Roadmap', x: 60, y: 44, width: 840, fontSize: 20 });
    expect(blocks.find((b) => b.id === 'b')).toMatchObject({ text: 'Points', x: 60, y: 130 });
    // Nothing is deleted and decoration stays put.
    expect(blocks.find((b) => b.id === 'd')).toMatchObject({ x: 0, y: 0 });
    expect(blocks).toHaveLength(4);
  });

  it('fits a picture into a picture slot without stretching it', () => {
    const slide = { blocks: [{ id: 'i', type: 'image', x: 0, y: 0, width: 400, height: 200, imageUrl: 'data:x' }] };
    const img = applyLayout(slide, layoutById('image-caption')).blocks.find((b) => b.id === 'i');
    expect(img.width / img.height).toBeCloseTo(2, 1);
    expect(img.width).toBeLessThanOrEqual(720);
  });

  it('builds new slides for every layout inside the canvas', () => {
    for (const layout of LAYOUTS) {
      const s = slideFromLayout(layout, 0, THEMES[1]);
      expect(s.layout).toBe(layout.id);
      for (const b of s.blocks) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(960);
      }
    }
  });
});

describe('themes', () => {
  it('restyles default and theme colours but keeps the author’s own', () => {
    const slide = {
      blocks: [
        { id: 't', type: 'textbox', role: 'title', text: 'A', fill: '#1a1a2e' },
        { id: 'c', type: 'textbox', text: 'B', fill: '#ff6600', styles: [{ start: 0, end: 1, style: { fontFamily: 'Arial', fontWeight: 'bold' } }] }
      ]
    };
    const ember = themeById('ember');
    const out = applyTheme(slide, ember);
    expect(out).toMatchObject({ theme: 'ember', backgroundColor: ember.background });
    expect(out.blocks[0]).toMatchObject({ fill: ember.title, fontFamily: ember.titleFont, text: 'A' });
    expect(out.blocks[1].fill).toBe('#ff6600');
    expect(out.blocks[1].styles).toEqual([{ start: 0, end: 1, style: { fontWeight: 'bold' } }]);
    // Switching again swaps the previous theme's colours.
    const again = applyTheme(out, themeById('harbor'));
    expect(again.blocks[0].fill).toBe(themeById('harbor').title);
  });
});

describe('arrange', () => {
  const boxes = [
    { id: 'a', x: 10, y: 10, w: 100, h: 50 },
    { id: 'b', x: 200, y: 40, w: 50, h: 50 },
    { id: 'c', x: 500, y: 100, w: 100, h: 20 }
  ];
  it('aligns to the selection, or a single element to the slide', () => {
    expect(alignBoxes(boxes, 'left')).toMatchObject({ a: { x: 10 }, b: { x: 10 }, c: { x: 10 } });
    expect(alignBoxes(boxes, 'bottom').b.y).toBe(70);
    expect(alignBoxes([boxes[0]], 'centre').a).toEqual({ x: 430, y: 10 });
  });
  it('distributes with equal gaps', () => {
    const out = distributeBoxes(boxes, 'horizontal');
    const gap1 = out.b.x - (out.a.x + 100);
    const gap2 = out.c.x - (out.b.x + 50);
    expect(gap1).toBeCloseTo(gap2, 0);
    expect(out.a.x).toBe(10);
    expect(out.c.x).toBe(500);
  });
  it('selects whole groups', () => {
    const blocks = [{ id: 'a', groupId: 'g' }, { id: 'b', groupId: 'g' }, { id: 'c' }];
    expect(expandToGroups(blocks, ['a'])).toEqual(['a', 'b']);
  });
});

describe('image crop', () => {
  it('trims edges without moving the picture', () => {
    const block = { x: 100, y: 50, width: 400, height: 200 };
    const p = cropPatch(block, { left: 0.25 });
    expect(p).toMatchObject({ x: 200, width: 300, height: 200, crop: { x: 0.25, y: 0, w: 0.75, h: 1 } });
    // Uncropping restores the original box.
    const back = cropPatch({ ...block, ...p }, { left: 0 });
    expect(back).toMatchObject({ x: 100, width: 400, crop: null });
    expect(cropInsets({ ...block, ...p }).left).toBe(0.25);
  });
  it('replaces the picture keeping width and centre', () => {
    const p = replaceImagePatch({ x: 0, y: 100, width: 200, height: 100, crop: { x: 0.1, y: 0, w: 0.9, h: 1 } }, { dataUrl: 'data:y', width: 100, height: 100 });
    expect(p).toEqual({ imageUrl: 'data:y', height: 200, y: 50, crop: null });
  });
});

describe('chart data', () => {
  it('edits values, categories and series', () => {
    let c = defaultChart();
    c = setValue(c, 0, 1, '1,200');
    expect(c.series[0].values[1]).toBe(1200);
    expect(setValue(c, 0, 1, 'abc')).toBe(c);
    c = addCategory(c);
    expect(c.categories).toHaveLength(5);
    expect(c.series[1].values).toHaveLength(5);
    c = removeCategory(c, 0);
    expect(c.categories[0]).toBe('Q2');
    c = addSeries(c);
    expect(c.series).toHaveLength(3);
  });
  it('takes a pasted spreadsheet range', () => {
    const c = chartFromGrid(defaultChart(), '\tNorth\tSouth\nJan\t1\t2\nFeb\t3\t40%\n');
    expect(c.categories).toEqual(['Jan', 'Feb']);
    expect(c.series.map((s) => s.name)).toEqual(['North', 'South']);
    expect(c.series[1].values).toEqual([2, 0.4]);
  });
});

describe('shapes', () => {
  it('draws every preset inside the 0–1000 box', () => {
    for (const s of SHAPES) {
      if (!s.path) continue;
      const nums = s.path.match(/-?\d+(\.\d+)?/g).map(Number);
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...nums)).toBeLessThanOrEqual(1000);
    }
  });
});
