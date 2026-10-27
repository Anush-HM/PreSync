import { newId } from './deckOps.js';

// Slide layouts and colour themes the Copilot can use, on the editor's
// 960×540 canvas. A layout names frames for a title, a subtitle and up
// to two bodies; applying one moves the slide's existing blocks into
// those frames, and building a slide from an outline fills them.
// (When the editor gains its own layouts module, the Copilot should read
// from it instead of this file.)

export const LAYOUTS = [
  {
    id: 'title',
    name: 'Title slide',
    description: 'Large centred title with a subtitle; for the opening slide.',
    frames: {
      title: { x: 80, y: 180, width: 800, fontSize: 48, textAlign: 'center', fontWeight: 'bold' },
      subtitle: { x: 140, y: 300, width: 680, fontSize: 22, textAlign: 'center' }
    }
  },
  {
    id: 'section',
    name: 'Section header',
    description: 'Big left-aligned heading with a short line under it; divides parts of a talk.',
    frames: {
      title: { x: 80, y: 200, width: 760, fontSize: 44, fontWeight: 'bold' },
      subtitle: { x: 80, y: 290, width: 760, fontSize: 20 }
    }
  },
  {
    id: 'title-bullets',
    name: 'Title and bullets',
    description: 'Title at the top with a bulleted body; the default content slide.',
    frames: {
      title: { x: 80, y: 50, width: 800, fontSize: 36, fontWeight: 'bold' },
      body: [{ x: 80, y: 140, width: 800, fontSize: 22, lineHeight: 1.3 }]
    }
  },
  {
    id: 'two-column',
    name: 'Two columns',
    description: 'Title with two side-by-side text columns; for comparisons or pros and cons.',
    frames: {
      title: { x: 80, y: 50, width: 800, fontSize: 36, fontWeight: 'bold' },
      body: [
        { x: 80, y: 140, width: 380, fontSize: 20, lineHeight: 1.3 },
        { x: 500, y: 140, width: 380, fontSize: 20, lineHeight: 1.3 }
      ]
    }
  },
  {
    id: 'visual-right',
    name: 'Text with visual',
    description: 'Title and text on the left, space on the right for an image, chart or sticker.',
    frames: {
      title: { x: 60, y: 50, width: 480, fontSize: 34, fontWeight: 'bold' },
      body: [{ x: 60, y: 140, width: 460, fontSize: 20, lineHeight: 1.3 }],
      visual: { x: 580, y: 110, width: 320, height: 320 }
    }
  },
  {
    id: 'quote',
    name: 'Big statement',
    description: 'One large centred statement or quote, with an attribution line.',
    frames: {
      title: { x: 100, y: 160, width: 760, fontSize: 38, textAlign: 'center', fontStyle: 'italic' },
      subtitle: { x: 100, y: 330, width: 760, fontSize: 18, textAlign: 'center' }
    }
  }
];

export const THEMES = [
  { id: 'clean', name: 'Clean white', background: '#ffffff', title: '#1a1a2e', text: '#1a1a2e' },
  { id: 'paper', name: 'Warm paper', background: '#f5f5f0', title: '#2e5e4e', text: '#1a1a2e' },
  { id: 'forest', name: 'Forest', background: '#eafaf1', title: '#285C43', text: '#1a1a2e' },
  { id: 'midnight', name: 'Midnight', background: '#0f3460', title: '#ffffff', text: '#eef2f7' },
  { id: 'charcoal', name: 'Charcoal', background: '#1a1a2e', title: '#A3D4B2', text: '#f2f4f0' }
];

export function getLayout(id) {
  return LAYOUTS.find((l) => l.id === id) || null;
}

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

const isText = (b) => (b.type || 'textbox') === 'textbox';

function frameStyle(frame) {
  const out = {};
  for (const k of ['fontSize', 'textAlign', 'fontWeight', 'fontStyle', 'lineHeight']) if (frame[k] !== undefined) out[k] = frame[k];
  return out;
}

// Which existing block goes in which frame: the title block (by role,
// else the largest text near the top), then the remaining text in
// reading order, then visuals. Decorative blocks stay where they are.
export function layoutPatches(slide, layoutId) {
  const layout = getLayout(layoutId);
  if (!layout || !slide) return [];
  const blocks = (slide.blocks || []).filter((b) => b.role !== 'decor');
  const texts = blocks.filter(isText).sort((a, b) => a.y - b.y || a.x - b.x);
  const title = texts.find((b) => b.role === 'title') || [...texts].sort((a, b) => (b.fontSize || 16) - (a.fontSize || 16))[0];
  const rest = texts.filter((b) => b !== title);
  const subtitle = layout.frames.subtitle ? rest.find((b) => b.role === 'subtitle') || (layout.frames.body ? null : rest[0]) : null;
  const bodies = rest.filter((b) => b !== subtitle);
  const visuals = blocks.filter((b) => !isText(b));
  const patches = [];
  const place = (block, frame) => {
    if (!block || !frame) return;
    patches.push({ blockId: block.id, patch: { x: frame.x, y: frame.y, width: frame.width, ...frameStyle(frame), verticalAlign: null, height: block.verticalAlign ? null : block.height } });
  };
  place(title, layout.frames.title);
  place(subtitle, layout.frames.subtitle);
  const bodyFrames = layout.frames.body || [];
  if (bodyFrames.length) {
    // Extra body blocks stack down the last column.
    let y = null;
    bodies.forEach((b, i) => {
      const frame = bodyFrames[Math.min(i, bodyFrames.length - 1)];
      if (i >= bodyFrames.length) {
        y = (y ?? frame.y) + 90;
        place(b, { ...frame, y });
      } else place(b, frame);
    });
  }
  const visual = layout.frames.visual;
  if (visual) {
    visuals.slice(0, 1).forEach((b) => {
      const ratio = b.height && b.width ? b.height / b.width : 1;
      const width = ratio > 1 ? Math.round(visual.height / ratio) : visual.width;
      const height = Math.round(width * ratio);
      patches.push({ blockId: b.id, patch: { x: visual.x + Math.round((visual.width - width) / 2), y: visual.y + Math.round((visual.height - height) / 2), width, height } });
    });
  }
  return patches.map((p) => ({ ...p, patch: Object.fromEntries(Object.entries(p.patch).filter(([, v]) => v !== undefined)) }));
}

export function applyPatchesToPlain(slide, patches) {
  const byId = new Map(patches.map((p) => [p.blockId, p.patch]));
  return {
    ...slide,
    blocks: slide.blocks.map((b) => {
      const patch = byId.get(b.id);
      if (!patch) return b;
      const next = { ...b };
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === undefined) delete next[k];
        else next[k] = v;
      });
      return next;
    })
  };
}

const BULLET = '• ';

// A new slide in the document model from one outline entry.
export function buildOutlineSlide(entry, { order = 0, layoutId, themeId, isFirst = false } = {}) {
  const theme = getTheme(themeId);
  const layout = getLayout(layoutId || entry.layoutId) || getLayout(isFirst ? 'title' : 'title-bullets');
  const f = layout.frames;
  const blocks = [
    { id: newId('b'), type: 'textbox', role: 'title', text: entry.title || 'Untitled', fill: theme.title, ...pick(f.title) }
  ];
  const bullets = (entry.bullets || []).filter(Boolean);
  if (f.body?.length) {
    const columns = f.body.length > 1 && bullets.length > 1 ? [bullets.slice(0, Math.ceil(bullets.length / 2)), bullets.slice(Math.ceil(bullets.length / 2))] : [bullets];
    columns.forEach((items, i) => {
      if (!items.length) return;
      blocks.push({ id: newId('b'), type: 'textbox', text: items.map((b) => BULLET + b).join('\n'), fill: theme.text, paragraphSpacing: 8, ...pick(f.body[i]) });
    });
  } else if (f.subtitle && bullets.length) {
    blocks.push({ id: newId('b'), type: 'textbox', role: 'subtitle', text: bullets.join(' · '), fill: theme.text, ...pick(f.subtitle) });
  }
  const slide = { id: newId('slide'), order, needsImageFallback: false, notes: entry.notes || '', blocks };
  if (theme.background !== '#ffffff') slide.backgroundColor = theme.background;
  return slide;
}

function pick(frame) {
  const { x, y, width, ...style } = frame;
  return { x, y, width, fontSize: style.fontSize || 18, ...frameStyle(style) };
}

