import { DEFAULT_FONT_FAMILY, FONT_FAMILIES } from './slideFormat.js';

// The fonts PreSync offers in its font picker. Web fonts are open-licence
// families served by Google Fonts (loaded on demand, never bundled or
// redistributed by PreSync); Office names map to metric-compatible open
// stand-ins so imported text wraps as it did in the source. Every entry
// names its licence; see FONTS-LICENSES in the README.
//
// `stack` is the CSS font-family stored on blocks; `fallback` is the
// generic family every renderer and the PDF export fall back to.

const g = (family, category, weights, extra = {}) => ({
  label: family,
  family,
  category,
  weights,
  italic: extra.italic ?? true,
  source: 'google',
  license: extra.license || 'OFL-1.1',
  stack: `"${family}", ${{ sans: 'sans-serif', serif: 'serif', mono: 'monospace', display: 'sans-serif', handwriting: 'cursive' }[category]}`
});

export const FONT_CATEGORIES = [
  { id: 'sans', label: 'Sans serif' },
  { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' },
  { id: 'handwriting', label: 'Handwriting' },
  { id: 'mono', label: 'Monospace' },
  { id: 'office', label: 'Office & system' }
];

const OFFICE = FONT_FAMILIES.map((f) => ({
  label: f.label,
  family: f.value.split(',')[0].replace(/["']/g, '').trim(),
  category: f.value === DEFAULT_FONT_FAMILY ? 'sans' : 'office',
  weights: [400, 700],
  italic: true,
  source: f.value === DEFAULT_FONT_FAMILY ? 'google' : 'system',
  license: f.value === DEFAULT_FONT_FAMILY ? 'OFL-1.1' : 'Uses the font installed on the device, else an open metric-compatible stand-in (OFL / Apache-2.0)',
  stack: f.value
}));

export const FONTS = [
  ...OFFICE,
  g('Inter', 'sans', [300, 400, 500, 600, 700, 800]),
  g('Roboto', 'sans', [300, 400, 500, 700, 900]),
  g('Open Sans', 'sans', [300, 400, 600, 700, 800]),
  g('Lato', 'sans', [300, 400, 700, 900]),
  g('Montserrat', 'sans', [300, 400, 500, 600, 700, 800]),
  g('Poppins', 'sans', [300, 400, 500, 600, 700]),
  g('Source Sans 3', 'sans', [300, 400, 600, 700]),
  g('Nunito', 'sans', [300, 400, 600, 700, 800]),
  g('Work Sans', 'sans', [300, 400, 500, 600, 700]),
  g('DM Sans', 'sans', [400, 500, 700]),
  g('Manrope', 'sans', [300, 400, 500, 600, 700, 800], { italic: false }),
  g('Outfit', 'sans', [300, 400, 500, 600, 700], { italic: false }),
  g('Rubik', 'sans', [300, 400, 500, 700]),
  g('IBM Plex Sans', 'sans', [300, 400, 500, 600, 700]),
  g('Merriweather', 'serif', [300, 400, 700, 900]),
  g('Playfair Display', 'serif', [400, 500, 600, 700, 800]),
  g('Lora', 'serif', [400, 500, 600, 700]),
  g('Libre Baskerville', 'serif', [400, 700]),
  g('EB Garamond', 'serif', [400, 500, 600, 700]),
  g('Crimson Pro', 'serif', [300, 400, 600, 700]),
  g('Source Serif 4', 'serif', [300, 400, 600, 700]),
  g('IBM Plex Serif', 'serif', [300, 400, 500, 600, 700]),
  g('Space Grotesk', 'display', [300, 400, 500, 600, 700], { italic: false }),
  g('Oswald', 'display', [300, 400, 500, 600, 700], { italic: false }),
  g('Bebas Neue', 'display', [400], { italic: false }),
  g('Archivo Black', 'display', [400], { italic: false }),
  g('Abril Fatface', 'display', [400], { italic: false }),
  g('Comfortaa', 'display', [300, 400, 500, 700], { italic: false }),
  g('Quicksand', 'display', [300, 400, 500, 600, 700], { italic: false }),
  g('Caveat', 'handwriting', [400, 500, 600, 700], { italic: false }),
  g('Kalam', 'handwriting', [300, 400, 700], { italic: false }),
  g('Patrick Hand', 'handwriting', [400], { italic: false }),
  g('Dancing Script', 'handwriting', [400, 500, 600, 700], { italic: false }),
  g('Permanent Marker', 'handwriting', [400], { italic: false, license: 'Apache-2.0' }),
  g('JetBrains Mono', 'mono', [300, 400, 500, 700]),
  g('Fira Code', 'mono', [300, 400, 500, 700], { italic: false }),
  g('IBM Plex Mono', 'mono', [300, 400, 500, 600, 700])
];

const WEIGHT_NAMES = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };
export function weightName(w) {
  return WEIGHT_NAMES[w] || String(w);
}

const first = (stack) => (stack || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();

// The catalogue entry for a stored font stack, matching on its first family.
export function fontEntry(stack) {
  const name = first(stack);
  return FONTS.find((f) => f.family.toLowerCase() === name) || null;
}

export function searchFonts(query, category = null) {
  const q = (query || '').trim().toLowerCase();
  return FONTS.filter((f) => (!category || f.category === category) && (!q || f.label.toLowerCase().includes(q) || f.category.includes(q)));
}

// --- loading web fonts on demand -------------------------------------------

const loaded = new Map(); // family -> Promise<boolean>

function cssUrl(entry) {
  const fam = entry.family.replace(/ /g, '+');
  const axis = entry.italic
    ? `ital,wght@${[...entry.weights.map((w) => `0,${w}`), ...entry.weights.map((w) => `1,${w}`)].join(';')}`
    : `wght@${entry.weights.join(';')}`;
  return `https://fonts.googleapis.com/css2?family=${fam}:${axis}&display=swap`;
}

// Loads a Google font once; resolves true when the browser has it.
export function loadFont(stack) {
  const entry = fontEntry(stack);
  if (!entry || entry.source !== 'google' || typeof document === 'undefined') return Promise.resolve(true);
  if (loaded.has(entry.family)) return loaded.get(entry.family);
  const p = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl(entry);
    link.dataset.font = entry.family;
    link.onload = () => {
      if (!document.fonts?.load) return resolve(true);
      Promise.all([document.fonts.load(`400 16px "${entry.family}"`), document.fonts.load(`700 16px "${entry.family}"`)])
        .then(() => resolve(true), () => resolve(false));
    };
    link.onerror = () => resolve(false);
    document.head.appendChild(link);
  });
  loaded.set(entry.family, p);
  return p;
}

// Preview text: the whole catalogue is drawn in its own fonts, so the
// picker loads just the families it shows.
export function previewStack(entry) {
  return entry.stack;
}

// --- recents and favourites (per browser) ------------------------------------

const RECENT_KEY = 'presync:fonts:recent';
const FAV_KEY = 'presync:fonts:favorites';

function readList(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Storage can be unavailable (private mode); recents are a convenience.
  }
}

export function recentFonts() {
  return readList(RECENT_KEY);
}
export function rememberFont(stack) {
  writeList(RECENT_KEY, [stack, ...readList(RECENT_KEY).filter((s) => s !== stack)].slice(0, 6));
}
export function favoriteFonts() {
  return readList(FAV_KEY);
}
export function toggleFavoriteFont(stack) {
  const list = readList(FAV_KEY);
  const next = list.includes(stack) ? list.filter((s) => s !== stack) : [stack, ...list];
  writeList(FAV_KEY, next);
  return next;
}
