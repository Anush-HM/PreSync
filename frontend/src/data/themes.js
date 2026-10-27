import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR } from './slideFormat.js';

// PreSync's slide themes: a palette and a pair of fonts. A theme only
// restyles: it never moves, adds or removes content (that is what
// layouts do). Text the author coloured on purpose keeps its colour;
// text in a theme's own (or the default) colours takes the new ones.
// All palettes are PreSync originals; fonts are open-licence families
// from data/fonts.js.

export const THEMES = [
  {
    id: 'paper', name: 'Paper',
    background: '#ffffff', accentBackground: '#285c43',
    title: '#171a19', text: '#2b302d', accent: '#285c43', accentSoft: '#e3efe7', onAccent: '#ffffff',
    titleFont: DEFAULT_FONT_FAMILY, bodyFont: DEFAULT_FONT_FAMILY
  },
  {
    id: 'forest', name: 'Forest',
    background: '#f4f7f2', accentBackground: '#1d4532',
    title: '#1d4532', text: '#26332b', accent: '#347653', accentSoft: '#d6e8dc', onAccent: '#f4f7f2',
    titleFont: '"Lora", serif', bodyFont: '"Source Sans 3", sans-serif'
  },
  {
    id: 'charcoal', name: 'Charcoal',
    background: '#171a19', backgroundGradient: { angle: 160, stops: [{ pos: 0, color: '#202522' }, { pos: 1, color: '#101311' }] },
    accentBackground: '#285c43',
    title: '#f2f4f0', text: '#cfd6d1', accent: '#a3d4b2', accentSoft: '#2a332e', onAccent: '#101311',
    titleFont: '"Space Grotesk", sans-serif', bodyFont: '"Inter", sans-serif'
  },
  {
    id: 'ember', name: 'Ember',
    background: '#fbf6f2', accentBackground: '#8f2638',
    title: '#5e1823', text: '#3a2a2c', accent: '#ac3045', accentSoft: '#f6dde1', onAccent: '#fbf6f2',
    titleFont: '"Playfair Display", serif', bodyFont: '"Lato", sans-serif'
  },
  {
    id: 'harbor', name: 'Harbor',
    background: '#f3f6f9', accentBackground: '#16324f',
    title: '#16324f', text: '#2c3a47', accent: '#2f6f9f', accentSoft: '#dbe7f1', onAccent: '#ffffff',
    titleFont: '"Montserrat", sans-serif', bodyFont: '"Open Sans", sans-serif'
  },
  {
    id: 'sand', name: 'Sand',
    background: '#f7f1e6', accentBackground: '#6b4f2c',
    title: '#3d2f1d', text: '#4a3f33', accent: '#b07a2e', accentSoft: '#efe2cb', onAccent: '#fffaf1',
    titleFont: '"EB Garamond", serif', bodyFont: '"Work Sans", sans-serif'
  },
  {
    id: 'mono', name: 'Mono',
    background: '#ffffff', accentBackground: '#111111',
    title: '#111111', text: '#333333', accent: '#111111', accentSoft: '#ececec', onAccent: '#ffffff',
    titleFont: '"IBM Plex Sans", sans-serif', bodyFont: '"IBM Plex Sans", sans-serif'
  },
  {
    id: 'studio', name: 'Studio',
    background: '#101311', backgroundGradient: { angle: 135, stops: [{ pos: 0, color: '#1d4532' }, { pos: 1, color: '#101311' }] },
    accentBackground: '#8f2638',
    title: '#ffffff', text: '#d9e2dc', accent: '#f0a1ad', accentSoft: '#26302a', onAccent: '#ffffff',
    titleFont: '"Outfit", sans-serif', bodyFont: '"DM Sans", sans-serif'
  }
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || null;
}

const low = (c) => (typeof c === 'string' ? c.toLowerCase() : c);

// Colours that belong to a theme (or to PreSync's defaults) rather than
// to the author, so a new theme may replace them.
function themedColors(prev) {
  const set = new Set(['#1a1a2e', '#000000', '#ffffff', low(DEFAULT_TEXT_COLOR), '#8a8f88']);
  for (const t of prev ? [prev] : THEMES) ['title', 'text', 'accent', 'onAccent'].forEach((k) => set.add(low(t[k])));
  return set;
}

function themedFills(prev) {
  const set = new Set(['#eef0ed', '#2e7d5b', '#e3efe7']);
  for (const t of prev ? [prev] : THEMES) ['accent', 'accentSoft', 'accentBackground'].forEach((k) => set.add(low(t[k])));
  return set;
}

// The slide after restyling it with `theme`. `prev` is the theme the
// slide had (slide.theme), when known, so only its colours are swapped.
export function applyTheme(slide, theme) {
  const prev = themeById(slide.theme);
  const colors = themedColors(prev);
  const fills = themedFills(prev);
  const onAccent = slide.backgroundColor && prev && low(slide.backgroundColor) === low(prev.accentBackground);
  const blocks = (slide.blocks || []).map((b) => {
    if (b.role === 'decor') return b;
    const type = b.type || 'textbox';
    if (type === 'textbox') {
      const next = { ...b, fontFamily: b.role === 'title' ? theme.titleFont : theme.bodyFont };
      if (!b.fill || colors.has(low(b.fill))) {
        const fill = onAccent ? theme.onAccent : b.role === 'title' ? theme.title : theme.text;
        next.fill = b.layoutSlot === 'subtitle' && !onAccent ? theme.text : fill;
      }
      if (Array.isArray(b.styles)) {
        const styles = b.styles
          .map((r) => {
            const style = { ...r.style };
            delete style.fontFamily;
            if (style.fill && colors.has(low(style.fill))) delete style.fill;
            return { ...r, style };
          })
          .filter((r) => Object.keys(r.style).length);
        next.styles = styles.length ? styles : null;
      }
      return next;
    }
    if (type === 'shape' && b.background && fills.has(low(b.background))) {
      const soft = prev ? low(b.background) === low(prev.accentSoft) : low(b.background) === '#e3efe7';
      return { ...b, background: soft ? theme.accentSoft : theme.accent };
    }
    if (type === 'chart' && b.chart) {
      return { ...b, chart: { ...b.chart, textColor: onAccent ? theme.onAccent : theme.text } };
    }
    return b;
  });
  const bg = onAccent
    ? { backgroundColor: theme.accentBackground, backgroundGradient: null }
    : { backgroundColor: theme.background, backgroundGradient: theme.backgroundGradient || null };
  // A picture background from an imported file stays; the colour sits behind it.
  return { ...slide, ...bg, blocks, theme: theme.id };
}
