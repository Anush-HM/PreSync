import { newId } from './deckOps.js';

// PreSync's slide layouts. A layout is a set of named slots on the
// 960×540 canvas. Applying one moves the slide's existing content into
// the slots (title into the title slot, body text into text slots,
// pictures into picture slots) and adds prompt text only for slots that
// are still empty; nothing already on the slide is deleted.

export const PROMPT_COLOR = '#8a8f88';

export const LAYOUTS = [
  {
    id: 'title', name: 'Title slide',
    slots: [
      { kind: 'title', x: 90, y: 176, width: 780, fontSize: 48, fontWeight: 'bold', textAlign: 'center', prompt: 'Presentation title' },
      { kind: 'subtitle', x: 150, y: 300, width: 660, fontSize: 22, textAlign: 'center', prompt: 'Subtitle or presenter name' }
    ]
  },
  {
    id: 'title-content', name: 'Title and content',
    slots: [
      { kind: 'title', x: 60, y: 44, width: 840, fontSize: 34, fontWeight: 'bold', prompt: 'Slide title' },
      { kind: 'body', x: 60, y: 130, width: 840, height: 360, fontSize: 22, lineHeight: 1.35, prompt: '• Add your first point\n• Add another point' }
    ]
  },
  {
    id: 'section', name: 'Section divider',
    background: 'accent',
    slots: [
      { kind: 'title', x: 80, y: 210, width: 800, fontSize: 52, fontWeight: 'bold', prompt: 'Section name' },
      { kind: 'subtitle', x: 80, y: 300, width: 800, fontSize: 22, prompt: 'What this part covers' }
    ]
  },
  {
    id: 'two-column', name: 'Two columns',
    slots: [
      { kind: 'title', x: 60, y: 44, width: 840, fontSize: 34, fontWeight: 'bold', prompt: 'Slide title' },
      { kind: 'body', x: 60, y: 130, width: 400, height: 360, fontSize: 20, lineHeight: 1.35, prompt: '• Left column point' },
      { kind: 'body', x: 500, y: 130, width: 400, height: 360, fontSize: 20, lineHeight: 1.35, prompt: '• Right column point' }
    ]
  },
  {
    id: 'comparison', name: 'Comparison',
    slots: [
      { kind: 'title', x: 60, y: 40, width: 840, fontSize: 34, fontWeight: 'bold', prompt: 'Comparison title' },
      { kind: 'subtitle', x: 60, y: 118, width: 400, fontSize: 22, fontWeight: 'bold', prompt: 'Option A' },
      { kind: 'subtitle', x: 500, y: 118, width: 400, fontSize: 22, fontWeight: 'bold', prompt: 'Option B' },
      { kind: 'body', x: 60, y: 168, width: 400, height: 320, fontSize: 19, lineHeight: 1.35, prompt: '• Strength\n• Trade-off' },
      { kind: 'body', x: 500, y: 168, width: 400, height: 320, fontSize: 19, lineHeight: 1.35, prompt: '• Strength\n• Trade-off' }
    ]
  },
  {
    id: 'image-caption', name: 'Picture with caption',
    slots: [
      { kind: 'image', x: 120, y: 40, width: 720, height: 380 },
      { kind: 'title', x: 120, y: 436, width: 720, fontSize: 26, fontWeight: 'bold', textAlign: 'center', prompt: 'Caption title' },
      { kind: 'subtitle', x: 120, y: 480, width: 720, fontSize: 16, textAlign: 'center', prompt: 'A line about the picture' }
    ]
  },
  {
    id: 'image-text', name: 'Picture and text',
    slots: [
      { kind: 'image', x: 0, y: 0, width: 440, height: 540 },
      { kind: 'title', x: 490, y: 70, width: 420, fontSize: 32, fontWeight: 'bold', prompt: 'Slide title' },
      { kind: 'body', x: 490, y: 160, width: 420, height: 320, fontSize: 20, lineHeight: 1.4, prompt: 'Tell the story behind the picture.' }
    ]
  },
  {
    id: 'timeline', name: 'Timeline',
    slots: [
      { kind: 'title', x: 60, y: 44, width: 840, fontSize: 34, fontWeight: 'bold', prompt: 'Timeline' },
      { kind: 'shape', x: 80, y: 300, width: 800, height: 6, shape: 'rect', fill: 'accent' },
      ...[0, 1, 2, 3].map((i) => ({ kind: 'shape', x: 128 + i * 220, y: 288, width: 30, height: 30, shape: 'ellipse', fill: 'accent' })),
      ...[0, 1, 2, 3].map((i) => ({ kind: 'body', x: 68 + i * 220, y: 196, width: 150, fontSize: 18, fontWeight: 'bold', textAlign: 'center', prompt: `Step ${i + 1}` })),
      ...[0, 1, 2, 3].map((i) => ({ kind: 'body', x: 68 + i * 220, y: 340, width: 150, fontSize: 15, textAlign: 'center', prompt: 'What happens' }))
    ]
  },
  {
    id: 'process', name: 'Process',
    slots: [
      { kind: 'title', x: 60, y: 44, width: 840, fontSize: 34, fontWeight: 'bold', prompt: 'How it works' },
      ...[0, 1, 2].map((i) => ({ kind: 'shape', x: 70 + i * 290, y: 190, width: 240, height: 200, shape: 'roundRect', fill: 'accentSoft' })),
      ...[0, 1].map((i) => ({ kind: 'shape', x: 316 + i * 290, y: 270, width: 38, height: 40, shape: 'path', path: 'M0 300 L600 300 L600 0 L1000 500 L600 1000 L600 700 L0 700 Z', fill: 'accent' })),
      ...[0, 1, 2].map((i) => ({ kind: 'body', x: 90 + i * 290, y: 216, width: 200, height: 150, fontSize: 18, textAlign: 'center', prompt: `${i + 1}. Step name\nShort description` }))
    ]
  },
  {
    id: 'kpi', name: 'Statistics',
    slots: [
      { kind: 'title', x: 60, y: 44, width: 840, fontSize: 34, fontWeight: 'bold', prompt: 'Key numbers' },
      ...[0, 1, 2].map((i) => ({ kind: 'body', x: 60 + i * 290, y: 190, width: 260, fontSize: 64, fontWeight: 'bold', textAlign: 'center', fill: 'accent', prompt: ['42%', '3.1k', '×2'][i] })),
      ...[0, 1, 2].map((i) => ({ kind: 'body', x: 60 + i * 290, y: 290, width: 260, fontSize: 18, textAlign: 'center', prompt: 'What this number means' }))
    ]
  },
  {
    id: 'closing', name: 'Closing',
    background: 'accent',
    slots: [
      { kind: 'title', x: 90, y: 190, width: 780, fontSize: 54, fontWeight: 'bold', textAlign: 'center', prompt: 'Thank you' },
      { kind: 'subtitle', x: 150, y: 300, width: 660, fontSize: 22, textAlign: 'center', prompt: 'Questions · contact@example.com' }
    ]
  },
  { id: 'blank', name: 'Blank', slots: [] }
];

export function layoutById(id) {
  return LAYOUTS.find((l) => l.id === id) || null;
}

const isText = (b) => (b.type || 'textbox') === 'textbox';

// Colours a slot asks for by name, from the slide's theme.
function paint(value, theme) {
  if (value === 'accent') return theme?.accent || '#2e7d5b';
  if (value === 'accentSoft') return theme?.accentSoft || '#e3efe7';
  return value;
}

// The slide's blocks after applying `layout`. Existing blocks are moved
// into matching slots and keep their own formatting and text; blocks
// no slot takes (and decorations from the original file) stay where
// they are. Returns { blocks, added, moved }.
export function applyLayout(slide, layout, theme = null) {
  const blocks = (slide.blocks || []).map((b) => ({ ...b }));
  const free = blocks.filter((b) => b.role !== 'decor' && b.role !== 'placeholder' && !b.locked);
  const take = (pred) => {
    const i = free.findIndex(pred);
    return i >= 0 ? free.splice(i, 1)[0] : null;
  };
  const added = [];
  let moved = 0;
  const textColor = theme?.text || '#1a1a2e';
  const titleColor = theme?.title || textColor;
  for (const slot of layout.slots) {
    let target = null;
    if (slot.kind === 'title') target = take((b) => b.role === 'title' && isText(b)) || take((b) => isText(b) && b.role !== 'subtitle' && !b.layoutSlot);
    else if (slot.kind === 'subtitle') target = take((b) => b.role === 'subtitle' && isText(b)) || take((b) => isText(b) && b.layoutSlot === 'subtitle');
    else if (slot.kind === 'body') target = take((b) => isText(b) && b.role !== 'title' && b.role !== 'subtitle');
    else if (slot.kind === 'image') target = take((b) => b.type === 'image');
    if (target) {
      moved += 1;
      Object.assign(target, { x: slot.x, y: slot.y, width: slot.width });
      if (target.type === 'image') {
        // Fit the picture into the slot without stretching it.
        const w0 = slot.width;
        const h0 = slot.height;
        const old = (slide.blocks || []).find((b) => b.id === target.id);
        const r = old?.height && old?.width ? old.height / old.width : h0 / w0;
        const width = Math.min(w0, h0 / r);
        const height = width * r;
        Object.assign(target, { x: Math.round(slot.x + (w0 - width) / 2), y: Math.round(slot.y + (h0 - height) / 2), width: Math.round(width), height: Math.round(height) });
      } else if (slot.height && target.verticalAlign) target.height = slot.height;
      if (slot.kind === 'title') target.role = 'title';
      if (slot.kind === 'subtitle') target.role = 'subtitle';
      continue;
    }
    if (slot.kind === 'image') {
      added.push({ id: newId('b'), type: 'shape', shape: 'rect', x: slot.x, y: slot.y, width: slot.width, height: slot.height, background: '#eef0ed', stroke: '#b9beb7', strokeWidth: 1.5, dash: true, fontSize: 16, text: '', layoutSlot: 'image' });
      continue;
    }
    if (slot.kind === 'shape') {
      const shape = { id: newId('b'), type: 'shape', shape: slot.shape, x: slot.x, y: slot.y, width: slot.width, height: slot.height, background: paint(slot.fill, theme), fontSize: 16, text: '', layoutSlot: 'shape' };
      if (slot.path) shape.path = slot.path;
      added.push(shape);
      continue;
    }
    const block = {
      id: newId('b'), type: 'textbox', x: slot.x, y: slot.y, width: slot.width, fontSize: slot.fontSize,
      text: slot.prompt, fill: slot.fill ? paint(slot.fill, theme) : slot.kind === 'title' ? titleColor : slot.kind === 'subtitle' ? PROMPT_COLOR : textColor,
      layoutSlot: slot.kind
    };
    if (slot.fontWeight) block.fontWeight = slot.fontWeight;
    if (slot.textAlign) block.textAlign = slot.textAlign;
    if (slot.lineHeight) block.lineHeight = slot.lineHeight;
    if (theme?.titleFont && slot.kind === 'title') block.fontFamily = theme.titleFont;
    else if (theme?.bodyFont) block.fontFamily = theme.bodyFont;
    if (slot.kind === 'title') block.role = 'title';
    if (slot.kind === 'subtitle') block.role = 'subtitle';
    added.push(block);
  }
  // Shapes the layout draws go behind the slide's content.
  const shapes = added.filter((b) => b.type === 'shape');
  const texts = added.filter((b) => b.type !== 'shape');
  return { blocks: [...shapes, ...blocks, ...texts], added: added.length, moved };
}

// A new slide built from a layout.
export function slideFromLayout(layout, order, theme = null) {
  const { blocks } = applyLayout({ blocks: [] }, layout, theme);
  const slide = { id: newId('slide'), order, needsImageFallback: false, notes: '', blocks, layout: layout.id };
  if (theme) Object.assign(slide, themeBackground(theme, layout.background === 'accent'));
  return slide;
}

export function themeBackground(theme, accent = false) {
  if (accent && theme.accentBackground) return { backgroundColor: theme.accentBackground, backgroundGradient: null, backgroundImageUrl: null };
  if (theme.backgroundGradient) return { backgroundColor: theme.background, backgroundGradient: theme.backgroundGradient, backgroundImageUrl: null };
  return { backgroundColor: theme.background, backgroundGradient: null, backgroundImageUrl: null };
}
