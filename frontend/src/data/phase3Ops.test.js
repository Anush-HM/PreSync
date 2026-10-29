import { describe, expect, it } from 'vitest';
import { snapBox } from './snapping.js';
import { TEMPLATES, buildTemplateSlides } from './templates.js';
import { layoutById } from './layouts.js';
import { ASSETS, DEFAULT_ICON_COLOR, assetSvg, assetToBlock, getAsset, searchAssets } from './assetLibrary.js';
import { filterCommands, keyParts, SHORTCUT_GROUPS, shortcutFor } from './shortcuts.js';

const FRAME = { left: 0, top: 0, width: 960, height: 540 };

describe('snapBox', () => {
  it('pulls a box onto the slide centre within the threshold and draws a full-height guide', () => {
    const { dx, dy, guides } = snapBox({ left: 384, top: 100, width: 200, height: 50 }, [], FRAME);
    expect(dx).toBe(-4); // centre 484 → 480
    expect(dy).toBe(0);
    expect(guides).toEqual([{ axis: 'x', at: 480, from: 0, to: 540 }]);
  });

  it('lines an edge up with another element and spans both in the guide', () => {
    const other = { left: 100, top: 300, width: 120, height: 80 };
    const { dx, guides } = snapBox({ left: 103, top: 40, width: 50, height: 30 }, [other], FRAME);
    expect(dx).toBe(-3);
    expect(guides[0]).toEqual({ axis: 'x', at: 100, from: 40, to: 380 });
  });

  it('leaves a box alone when nothing is close enough', () => {
    expect(snapBox({ left: 130, top: 77, width: 50, height: 30 }, [], FRAME, 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('snaps both axes at once, to the nearest line', () => {
    const { dx, dy } = snapBox({ left: 2, top: 508, width: 100, height: 30 }, [], FRAME);
    expect(dx).toBe(-2);
    expect(dy).toBe(2); // bottom 538 → 540
  });
});

describe('starter templates', () => {
  it('fill exactly the text slots their layouts have', () => {
    for (const t of TEMPLATES) {
      for (const spec of t.slides) {
        const layout = layoutById(spec.layout);
        expect(layout, `${t.id}: ${spec.layout}`).toBeTruthy();
        const textSlots = layout.slots.filter((s) => ['title', 'subtitle', 'body'].includes(s.kind)).length;
        expect(spec.texts.length, `${t.id} / ${spec.layout}`).toBe(textSlots);
      }
    }
  });

  it('build ordinary slides with the example text and the template’s theme', () => {
    const pitch = TEMPLATES.find((t) => t.id === 'pitch');
    const slides = buildTemplateSlides(pitch);
    expect(slides).toHaveLength(pitch.slides.length);
    expect(slides.map((s) => s.order)).toEqual(slides.map((_, i) => i));
    expect(new Set(slides.map((s) => s.id)).size).toBe(slides.length);
    expect(slides.every((s) => s.theme === 'studio' && s.backgroundColor)).toBe(true);
    const title = slides[0].blocks.find((b) => b.role === 'title');
    expect(title.text).toBe('Company name');
    expect(title.layoutSlot).toBeUndefined();
    // Filled subtitles take the theme's text colour, not the grey prompt colour.
    expect(slides[0].blocks.find((b) => b.role === 'subtitle').fill).toBe('#d9e2dc');
  });

  it('keep picture placeholders as placeholders', () => {
    const slides = buildTemplateSlides(TEMPLATES.find((t) => t.id === 'portfolio'));
    expect(slides[1].blocks.some((b) => b.layoutSlot === 'image')).toBe(true);
  });
});

describe('element library', () => {
  it('has unique ids, a licence on every asset, and no active content in any SVG', () => {
    expect(new Set(ASSETS.map((a) => a.id)).size).toBe(ASSETS.length);
    expect(ASSETS.every((a) => a.license?.name)).toBe(true);
    for (const a of ASSETS.filter((x) => x.svg)) {
      expect(a.svg).not.toMatch(/<script|\son[a-z]+=|javascript:|<foreignObject|href=/i);
    }
    expect(ASSETS.filter((a) => a.recolor).length).toBeGreaterThanOrEqual(40);
    expect(ASSETS.filter((a) => a.kind === 'emoji').length).toBeGreaterThanOrEqual(100);
  });

  it('paints recolourable icons in the chosen colour, and refuses anything that is not a hex colour', () => {
    const icon = getAsset('icon-check-circle');
    expect(assetSvg(icon, '#8f2638')).toContain('stroke="#8f2638"');
    expect(assetSvg(icon, '#8f2638')).not.toContain('currentColor');
    expect(assetSvg(icon, 'red" onload="x')).toContain(`stroke="${DEFAULT_ICON_COLOR}"`);
    const sticker = getAsset('sticker-rocket');
    expect(assetSvg(sticker, '#000000')).toBe(sticker.svg);
  });

  it('finds icons by meaning and turns them into image blocks with alt text', async () => {
    expect(searchAssets('security', { kinds: ['icon'] }).map((a) => a.id)).toEqual(expect.arrayContaining(['icon-lock', 'icon-shield']));
    // jsdom can't decode pictures, so the block keeps the SVG itself.
    const RealImage = globalThis.Image;
    globalThis.Image = undefined;
    const block = await assetToBlock(getAsset('icon-lock'), { id: 'b1', color: '#2f6f9f' }).finally(() => { globalThis.Image = RealImage; });
    expect(block).toMatchObject({ id: 'b1', type: 'image', alt: 'Lock' });
    expect(decodeURIComponent(block.imageUrl)).toContain('stroke="#2f6f9f"');
  });
});

describe('shortcuts and commands', () => {
  it('describe each shortcut once', () => {
    const ids = SHORTCUT_GROUPS.flatMap((g) => g.items.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(shortcutFor('palette')).toBe('Mod+K');
  });

  it('spell keys for the platform', () => {
    expect(keyParts('Mod+Shift+Z', false)).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(keyParts('Mod+Shift+Z', true)).toEqual(['⌘', '⇧', 'Z']);
    expect(keyParts('Arrow keys', false)).toEqual(['Arrow keys']);
  });

  it('match every word, preferring labels that start with the query', () => {
    const cmds = [
      { id: 'a', label: 'Insert table', group: 'Insert' },
      { id: 'b', label: 'Align left', group: 'Arrange' },
      { id: 'c', label: 'Theme: Paper', group: 'Themes', keywords: 'colour' },
      { id: 'd', label: 'Text align', group: 'Text' }
    ];
    expect(filterCommands(cmds, 'align').map((c) => c.id)).toEqual(['b', 'd']);
    expect(filterCommands(cmds, 'insert tab').map((c) => c.id)).toEqual(['a']);
    expect(filterCommands(cmds, 'colour').map((c) => c.id)).toEqual(['c']);
    expect(filterCommands(cmds, '')).toHaveLength(4);
  });
});
