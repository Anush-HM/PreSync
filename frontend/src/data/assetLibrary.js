// PreSync's sticker, icon and emoji library.
//
// Export shape (kept stable; other editor features build on it):
//   ASSET_CATEGORIES: [{ id, label }]
//   ASSETS: [{ id, kind: 'emoji' | 'sticker' | 'icon', name, category, tags: [string],
//              emoji?: string, svg?: string, license: { name, source } }]
//   getAsset(id), searchAssets(query, { limit, kinds, category }), assetToBlock(asset, options)
//
// Licensing: emoji are the viewer's own platform emoji (inserted as text,
// no artwork is shipped). Stickers and icons are original PreSync artwork
// drawn for this file and released under the repository's licence.

export const ASSET_CATEGORIES = [
  { id: 'reactions', label: 'Reactions' },
  { id: 'celebration', label: 'Celebration' },
  { id: 'education', label: 'Study & education' },
  { id: 'business', label: 'Business & productivity' },
  { id: 'nature', label: 'Nature' },
  { id: 'technology', label: 'Technology' },
  { id: 'travel', label: 'Travel' },
  { id: 'arrows', label: 'Arrows & pointers' },
  { id: 'shapes', label: 'Decorative shapes' }
];

const EMOJI_LICENSE = { name: 'Platform emoji (Unicode text)', source: 'Rendered by the viewer’s system font' };
const ORIGINAL_LICENSE = { name: 'Original PreSync artwork', source: 'frontend/src/data/assetLibrary.js' };

const emoji = (id, char, name, category, tags) => ({ id: `emoji-${id}`, kind: 'emoji', name, category, tags, emoji: char, license: EMOJI_LICENSE });

const EMOJI = [
  emoji('thumbs-up', '👍', 'Thumbs up', 'reactions', ['like', 'approve', 'yes', 'good']),
  emoji('clap', '👏', 'Clapping hands', 'reactions', ['applause', 'well done', 'bravo']),
  emoji('heart', '❤️', 'Red heart', 'reactions', ['love', 'like', 'care']),
  emoji('smile', '😊', 'Smiling face', 'reactions', ['happy', 'friendly', 'emotion']),
  emoji('thinking', '🤔', 'Thinking face', 'reactions', ['question', 'consider', 'hmm', 'emotion']),
  emoji('mind-blown', '🤯', 'Mind blown', 'reactions', ['wow', 'surprise', 'emotion']),
  emoji('eyes', '👀', 'Eyes', 'reactions', ['look', 'attention', 'watch']),
  emoji('fire', '🔥', 'Fire', 'reactions', ['hot', 'trending', 'energy']),
  emoji('party', '🎉', 'Party popper', 'celebration', ['party', 'congratulations', 'launch', 'celebrate']),
  emoji('confetti', '🎊', 'Confetti ball', 'celebration', ['party', 'celebrate', 'festival']),
  emoji('balloon', '🎈', 'Balloon', 'celebration', ['birthday', 'party']),
  emoji('trophy', '🏆', 'Trophy', 'celebration', ['win', 'award', 'success', 'achievement']),
  emoji('medal', '🥇', 'Gold medal', 'celebration', ['first', 'winner', 'award']),
  emoji('sparkles', '✨', 'Sparkles', 'celebration', ['new', 'magic', 'shine', 'highlight']),
  emoji('gift', '🎁', 'Gift', 'celebration', ['present', 'birthday', 'holiday']),
  emoji('books', '📚', 'Books', 'education', ['study', 'reading', 'library', 'learn']),
  emoji('pencil', '✏️', 'Pencil', 'education', ['write', 'homework', 'edit']),
  emoji('grad-cap', '🎓', 'Graduation cap', 'education', ['graduate', 'school', 'university', 'learn']),
  emoji('microscope', '🔬', 'Microscope', 'education', ['science', 'research', 'lab']),
  emoji('abacus', '🧮', 'Abacus', 'education', ['math', 'count', 'numbers']),
  emoji('globe', '🌍', 'Globe', 'education', ['world', 'geography', 'global', 'earth']),
  emoji('bulb', '💡', 'Light bulb', 'education', ['idea', 'insight', 'tip', 'innovation']),
  emoji('chart-up', '📈', 'Chart increasing', 'business', ['growth', 'revenue', 'trend', 'up', 'sales']),
  emoji('chart-down', '📉', 'Chart decreasing', 'business', ['decline', 'loss', 'down']),
  emoji('briefcase', '💼', 'Briefcase', 'business', ['work', 'job', 'office', 'career']),
  emoji('handshake', '🤝', 'Handshake', 'business', ['deal', 'partnership', 'agreement', 'team']),
  emoji('target', '🎯', 'Target', 'business', ['goal', 'aim', 'objective', 'focus']),
  emoji('calendar', '📅', 'Calendar', 'business', ['date', 'schedule', 'deadline', 'plan']),
  emoji('money', '💰', 'Money bag', 'business', ['finance', 'budget', 'revenue', 'cost']),
  emoji('check', '✅', 'Check mark', 'business', ['done', 'complete', 'yes', 'task']),
  emoji('memo', '📝', 'Memo', 'business', ['notes', 'plan', 'document']),
  emoji('seedling', '🌱', 'Seedling', 'nature', ['growth', 'plant', 'sustainability', 'start']),
  emoji('tree', '🌳', 'Tree', 'nature', ['forest', 'environment', 'green']),
  emoji('sun', '☀️', 'Sun', 'nature', ['weather', 'summer', 'energy', 'solar']),
  emoji('rainbow', '🌈', 'Rainbow', 'nature', ['weather', 'hope', 'diversity']),
  emoji('leaf', '🍃', 'Leaves', 'nature', ['wind', 'eco', 'green', 'autumn']),
  emoji('wave', '🌊', 'Water wave', 'nature', ['ocean', 'sea', 'water']),
  emoji('flower', '🌸', 'Cherry blossom', 'nature', ['spring', 'flower', 'bloom']),
  emoji('laptop', '💻', 'Laptop', 'technology', ['computer', 'work', 'coding', 'software']),
  emoji('robot', '🤖', 'Robot', 'technology', ['ai', 'automation', 'machine']),
  emoji('rocket', '🚀', 'Rocket', 'technology', ['launch', 'startup', 'fast', 'space']),
  emoji('gear', '⚙️', 'Gear', 'technology', ['settings', 'process', 'engineering']),
  emoji('phone', '📱', 'Mobile phone', 'technology', ['mobile', 'app', 'device']),
  emoji('satellite', '🛰️', 'Satellite', 'technology', ['space', 'network', 'signal']),
  emoji('lock', '🔒', 'Lock', 'technology', ['security', 'privacy', 'safe']),
  emoji('plane', '✈️', 'Airplane', 'travel', ['flight', 'trip', 'travel', 'journey']),
  emoji('map', '🗺️', 'World map', 'travel', ['map', 'route', 'explore']),
  emoji('compass', '🧭', 'Compass', 'travel', ['direction', 'navigate', 'strategy']),
  emoji('luggage', '🧳', 'Luggage', 'travel', ['trip', 'vacation', 'bag']),
  emoji('mountain', '⛰️', 'Mountain', 'travel', ['hike', 'challenge', 'peak', 'nature']),
  emoji('point-right', '👉', 'Pointing right', 'arrows', ['point', 'next', 'look', 'arrow']),
  emoji('arrow-right', '➡️', 'Right arrow', 'arrows', ['next', 'forward', 'arrow']),
  emoji('arrow-up', '⬆️', 'Up arrow', 'arrows', ['increase', 'up', 'arrow']),
  emoji('star', '⭐', 'Star', 'shapes', ['favourite', 'rating', 'highlight']),
  emoji('pin', '📌', 'Pushpin', 'shapes', ['important', 'note', 'pin'])
];

// Original sticker artwork on a 120×120 grid. Strokes and fills use the
// PreSync palette plus warm accents so they read on light and dark slides.
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${body}</svg>`;
const sticker = (id, name, category, tags, body, kind = 'sticker') => ({
  id: `${kind}-${id}`,
  kind,
  name,
  category,
  tags,
  svg: svg(body),
  license: ORIGINAL_LICENSE
});

const STICKERS = [
  sticker('starburst', 'Starburst badge', 'celebration', ['new', 'sale', 'badge', 'highlight', 'celebrate'],
    '<path d="M60 6l11 17 20-6 1 21 19 9-12 17 12 17-19 9-1 21-20-6-11 17-11-17-20 6-1-21-19-9 12-17-12-17 19-9 1-21 20 6z" fill="#E4B66A" stroke="#8a5a14" stroke-width="3"/><circle cx="60" cy="60" r="26" fill="#fff4dc"/><path d="M60 44l5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2z" fill="#8F2638"/>'),
  sticker('confetti', 'Confetti burst', 'celebration', ['party', 'celebrate', 'congratulations', 'launch'],
    '<path d="M24 100l20-58 36 36z" fill="#285C43"/><path d="M44 42l36 36" stroke="#A3D4B2" stroke-width="4"/><circle cx="78" cy="22" r="6" fill="#E4B66A"/><circle cx="100" cy="46" r="5" fill="#8F2638"/><rect x="88" y="70" width="10" height="10" rx="2" transform="rotate(25 93 75)" fill="#A3D4B2"/><path d="M62 14q6 8 0 16" stroke="#8F2638" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M96 20q8 4 6 14" stroke="#285C43" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="104" cy="96" r="4" fill="#E4B66A"/>'),
  sticker('trophy', 'Trophy', 'celebration', ['win', 'award', 'success', 'achievement', 'goal'],
    '<path d="M36 18h48v26a24 24 0 0 1-48 0z" fill="#E4B66A" stroke="#8a5a14" stroke-width="3"/><path d="M36 26H20v8a16 16 0 0 0 18 16M84 26h16v8a16 16 0 0 1-18 16" fill="none" stroke="#8a5a14" stroke-width="5"/><rect x="54" y="66" width="12" height="18" fill="#c99236"/><rect x="38" y="84" width="44" height="14" rx="3" fill="#285C43"/><path d="M60 28l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="#fff4dc"/>'),
  sticker('lightbulb', 'Idea bulb', 'education', ['idea', 'insight', 'tip', 'innovation', 'think'],
    '<path d="M60 14a32 32 0 0 0-18 58c4 3 6 8 6 12h24c0-4 2-9 6-12a32 32 0 0 0-18-58z" fill="#fff4dc" stroke="#c99236" stroke-width="4"/><rect x="48" y="88" width="24" height="8" rx="2" fill="#5d6b63"/><rect x="51" y="98" width="18" height="8" rx="3" fill="#5d6b63"/><path d="M52 66l8-14 8 14" stroke="#E4B66A" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M14 46h10M96 46h10M24 18l7 7M96 18l-7 7" stroke="#E4B66A" stroke-width="4" stroke-linecap="round"/>'),
  sticker('grad-cap', 'Graduation cap', 'education', ['graduate', 'school', 'university', 'learn', 'study'],
    '<path d="M60 22l50 22-50 22-50-22z" fill="#202522" stroke="#A3D4B2" stroke-width="3"/><path d="M32 56v22c0 8 56 8 56 0V56l-28 12z" fill="#285C43"/><path d="M98 48v28" stroke="#E4B66A" stroke-width="4"/><circle cx="98" cy="80" r="5" fill="#E4B66A"/>'),
  sticker('open-book', 'Open book', 'education', ['study', 'reading', 'learn', 'library', 'knowledge'],
    '<path d="M60 32c-14-10-32-10-46-6v64c14-4 32-4 46 6z" fill="#ffffff" stroke="#285C43" stroke-width="4"/><path d="M60 32c14-10 32-10 46-6v64c-14-4-32-4-46 6z" fill="#f3f7f2" stroke="#285C43" stroke-width="4"/><path d="M24 42h26M24 54h26M24 66h20M70 42h26M70 54h26M70 66h20" stroke="#A3D4B2" stroke-width="3" stroke-linecap="round"/>'),
  sticker('growth-chart', 'Growth chart', 'business', ['growth', 'revenue', 'chart', 'sales', 'up', 'kpi'],
    '<rect x="12" y="14" width="96" height="92" rx="10" fill="#ffffff" stroke="#285C43" stroke-width="3"/><rect x="26" y="70" width="14" height="24" rx="2" fill="#A3D4B2"/><rect x="48" y="58" width="14" height="36" rx="2" fill="#5fa37d"/><rect x="70" y="42" width="14" height="52" rx="2" fill="#285C43"/><path d="M26 54l22-14 16 8 26-22" stroke="#8F2638" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M80 24h12v12" stroke="#8F2638" stroke-width="4" fill="none" stroke-linecap="round"/>'),
  sticker('target', 'Target', 'business', ['goal', 'objective', 'aim', 'focus', 'strategy'],
    '<circle cx="56" cy="64" r="44" fill="#ffffff" stroke="#8F2638" stroke-width="4"/><circle cx="56" cy="64" r="30" fill="#F0A1AD"/><circle cx="56" cy="64" r="16" fill="#8F2638"/><path d="M56 64l46-46" stroke="#202522" stroke-width="4" stroke-linecap="round"/><path d="M90 14l14 2 2 14-10-4z" fill="#285C43"/>'),
  sticker('handshake-badge', 'Partnership badge', 'business', ['deal', 'partnership', 'team', 'agreement', 'collaboration'],
    '<circle cx="60" cy="60" r="50" fill="#285C43"/><path d="M26 62l18-16 16 8 16-8 18 16-22 20c-4 4-10 4-14 0z" fill="#fff4dc" stroke="#A3D4B2" stroke-width="3" stroke-linejoin="round"/><path d="M52 66l8 8M60 62l8 8M44 70l8 8" stroke="#c99236" stroke-width="3" stroke-linecap="round"/>'),
  sticker('checklist', 'Checklist', 'business', ['tasks', 'done', 'plan', 'todo', 'productivity'],
    '<rect x="22" y="12" width="76" height="96" rx="8" fill="#ffffff" stroke="#285C43" stroke-width="3"/><rect x="44" y="6" width="32" height="14" rx="4" fill="#285C43"/><path d="M34 42l6 6 10-12M34 66l6 6 10-12" stroke="#285C43" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M58 44h28M58 68h28M58 90h28" stroke="#b1bab3" stroke-width="4" stroke-linecap="round"/><rect x="34" y="84" width="14" height="12" rx="2" fill="none" stroke="#8F2638" stroke-width="3"/>'),
  sticker('leaf', 'Leaf', 'nature', ['eco', 'green', 'sustainability', 'nature', 'environment', 'growth'],
    '<path d="M100 16C40 16 16 52 22 96c44 6 78-20 78-80z" fill="#5fa37d" stroke="#285C43" stroke-width="4" stroke-linejoin="round"/><path d="M22 96C46 70 66 52 88 30" stroke="#285C43" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M50 66l-2-18M62 54l14 2M40 78l-12-4" stroke="#285C43" stroke-width="3" stroke-linecap="round"/>'),
  sticker('sun', 'Sunshine', 'nature', ['sun', 'summer', 'energy', 'solar', 'weather', 'happy'],
    '<circle cx="60" cy="60" r="24" fill="#E4B66A" stroke="#c99236" stroke-width="3"/><g stroke="#E4B66A" stroke-width="6" stroke-linecap="round"><path d="M60 10v14M60 96v14M10 60h14M96 60h14M25 25l10 10M85 85l10 10M25 95l10-10M85 35l10-10"/></g>'),
  sticker('mountain', 'Mountain peak', 'nature', ['mountain', 'challenge', 'goal', 'travel', 'adventure', 'peak'],
    '<path d="M6 100l38-58 18 26 14-18 38 50z" fill="#285C43"/><path d="M44 42l10 15-6 4-4-6-6 6-4-4z" fill="#ffffff"/><path d="M76 50l8 11-5 2-3-4-4 3z" fill="#ffffff"/><circle cx="92" cy="24" r="10" fill="#E4B66A"/><path d="M60 74l6-8M66 66l6 10" stroke="#8F2638" stroke-width="3" stroke-linecap="round"/><path d="M66 66v-14l12 5-12 5" fill="#8F2638"/>'),
  sticker('rocket', 'Launch rocket', 'technology', ['launch', 'startup', 'growth', 'fast', 'space', 'release'],
    '<path d="M60 8c22 14 28 40 20 66H40C32 48 38 22 60 8z" fill="#f3f7f2" stroke="#202522" stroke-width="4" stroke-linejoin="round"/><circle cx="60" cy="40" r="10" fill="#A3D4B2" stroke="#202522" stroke-width="3"/><path d="M40 60L24 80l18 2M80 60l16 20-18 2" fill="#8F2638" stroke="#202522" stroke-width="3" stroke-linejoin="round"/><path d="M48 76c0 14 12 30 12 30s12-16 12-30" fill="#E4B66A"/><path d="M54 76c0 8 6 18 6 18s6-10 6-18" fill="#8F2638"/>'),
  sticker('chip', 'Microchip', 'technology', ['ai', 'computer', 'hardware', 'technology', 'data'],
    '<rect x="30" y="30" width="60" height="60" rx="8" fill="#202522" stroke="#A3D4B2" stroke-width="3"/><rect x="46" y="46" width="28" height="28" rx="4" fill="#285C43"/><g stroke="#A3D4B2" stroke-width="4" stroke-linecap="round"><path d="M44 18v12M60 18v12M76 18v12M44 90v12M60 90v12M76 90v12M18 44h12M18 60h12M18 76h12M90 44h12M90 60h12M90 76h12"/></g><circle cx="60" cy="60" r="5" fill="#E4B66A"/>'),
  sticker('cloud-sync', 'Cloud sync', 'technology', ['cloud', 'sync', 'online', 'data', 'saas'],
    '<path d="M32 86a20 20 0 0 1 2-40 28 28 0 0 1 54 6 17 17 0 0 1-2 34z" fill="#ffffff" stroke="#285C43" stroke-width="4" stroke-linejoin="round"/><path d="M48 64a14 14 0 0 1 24-4M72 72a14 14 0 0 1-24 4" stroke="#285C43" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M70 52l3 9-9 1M50 84l-3-9 9-1" stroke="#285C43" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  sticker('paper-plane', 'Paper plane', 'travel', ['send', 'travel', 'message', 'launch', 'journey'],
    '<path d="M10 56L108 14 84 100 60 74z" fill="#ffffff" stroke="#285C43" stroke-width="4" stroke-linejoin="round"/><path d="M60 74l48-60-62 50 2 30z" fill="#A3D4B2" stroke="#285C43" stroke-width="4" stroke-linejoin="round"/><path d="M14 92q14-6 22 2t20 0" stroke="#8F2638" stroke-width="3" fill="none" stroke-dasharray="5 5" stroke-linecap="round"/>'),
  sticker('location-pin', 'Location pin', 'travel', ['map', 'place', 'location', 'office', 'destination'],
    '<path d="M60 8a32 32 0 0 0-32 32c0 26 32 68 32 68s32-42 32-68A32 32 0 0 0 60 8z" fill="#8F2638" stroke="#5a1522" stroke-width="3"/><circle cx="60" cy="40" r="13" fill="#ffffff"/>'),
  sticker('speech-bubble', 'Speech bubble', 'reactions', ['quote', 'comment', 'talk', 'feedback', 'say'],
    '<path d="M16 22h88a8 8 0 0 1 8 8v48a8 8 0 0 1-8 8H50l-22 20 4-20H16a8 8 0 0 1-8-8V30a8 8 0 0 1 8-8z" fill="#ffffff" stroke="#285C43" stroke-width="4" stroke-linejoin="round"/><circle cx="38" cy="54" r="6" fill="#285C43"/><circle cx="60" cy="54" r="6" fill="#285C43"/><circle cx="82" cy="54" r="6" fill="#285C43"/>'),
  sticker('heart-badge', 'Heart badge', 'reactions', ['love', 'like', 'favourite', 'care', 'thanks'],
    '<circle cx="60" cy="60" r="50" fill="#F0A1AD"/><path d="M60 92S26 70 26 48a17 17 0 0 1 34-4 17 17 0 0 1 34 4c0 22-34 44-34 44z" fill="#8F2638"/>'),
  sticker('curved-arrow', 'Curved arrow', 'arrows', ['arrow', 'next', 'point', 'direction', 'annotation'], '<path d="M16 92C24 44 60 22 96 30" stroke="#8F2638" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M82 14l18 16-20 12" stroke="#8F2638" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>', 'icon'),
  sticker('circle-highlight', 'Hand-drawn circle', 'arrows', ['highlight', 'circle', 'annotation', 'emphasis', 'hand-drawn'], '<path d="M64 18c30 2 46 18 42 40s-30 40-60 38S10 76 14 52 40 16 70 22" stroke="#8F2638" stroke-width="5" fill="none" stroke-linecap="round"/>', 'icon'),
  sticker('underline', 'Hand-drawn underline', 'arrows', ['underline', 'emphasis', 'annotation', 'hand-drawn'], '<path d="M8 70c20-8 44-10 64-8s30 2 40-4M20 84c18-5 40-6 62-4" stroke="#285C43" stroke-width="6" fill="none" stroke-linecap="round"/>', 'icon'),
  sticker('blob', 'Soft blob', 'shapes', ['background', 'decoration', 'shape', 'organic'], '<path d="M64 10c26 2 48 22 46 50s-20 50-50 50S8 92 10 62 38 8 64 10z" fill="#A3D4B2" opacity="0.85"/>', 'icon'),
  sticker('sparkle', 'Sparkle', 'shapes', ['sparkle', 'shine', 'new', 'magic', 'decoration'], '<path d="M60 8c4 30 22 48 52 52-30 4-48 22-52 52-4-30-22-48-52-52 30-4 48-22 52-52z" fill="#E4B66A"/><path d="M98 12c1 8 5 12 12 13-7 1-11 5-12 12-1-7-5-11-12-12 7-1 11-5 12-13z" fill="#A3D4B2"/>', 'icon'),
  sticker('dots', 'Dot grid', 'shapes', ['pattern', 'dots', 'decoration', 'background'], `${Array.from({ length: 25 }, (_, i) => `<circle cx="${20 + (i % 5) * 20}" cy="${20 + Math.floor(i / 5) * 20}" r="4" fill="#285C43"/>`).join('')}`, 'icon')
];

export const ASSETS = [...STICKERS, ...EMOJI];

const BY_ID = new Map(ASSETS.map((a) => [a.id, a]));

export function getAsset(id) {
  return BY_ID.get(id) || null;
}

function words(text) {
  return (text || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
}

// Ranks assets by how well their name, tags and category match the
// query. Returns [] for a query that matches nothing (no padding with
// unrelated assets).
export function searchAssets(query, { limit = 24, kinds, category } = {}) {
  const terms = words(query);
  const pool = ASSETS.filter((a) => (!kinds || kinds.includes(a.kind)) && (!category || a.category === category));
  if (!terms.length) return pool.slice(0, limit);
  const scored = pool
    .map((a) => {
      const name = words(a.name);
      const tags = a.tags.flatMap(words);
      const cat = words(a.category);
      let score = 0;
      for (const t of terms) {
        const stem = t.replace(/(ies|es|s)$/, '');
        const hit = (list) => list.some((w) => w === t || w === stem || (stem.length > 3 && w.startsWith(stem)));
        if (hit(name)) score += 3;
        if (hit(tags)) score += 2;
        if (hit(cat)) score += 1;
      }
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map((x) => x.a);
}

export function assetDataUrl(asset) {
  return asset?.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.svg)}` : null;
}

// SVG → PNG, so inserted stickers export to PDF and PPTX like any
// uploaded picture. Falls back to the SVG itself where there is no canvas.
function rasterize(svgUrl, size) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return resolve(svgUrl);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(svgUrl);
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(svgUrl);
      }
    };
    img.onerror = () => resolve(svgUrl);
    img.src = svgUrl;
  });
}

// A block for the editor's document model. Emoji become a text box (so
// they stay editable and use the platform font); artwork becomes an image.
export async function assetToBlock(asset, { id, x = 680, y = 300, size = 160 } = {}) {
  if (asset.kind === 'emoji') {
    return { id, type: 'textbox', x, y, width: Math.round(size * 1.2), fontSize: Math.round(size * 0.75), text: asset.emoji, textAlign: 'center' };
  }
  const imageUrl = await rasterize(assetDataUrl(asset), 360);
  return { id, type: 'image', x, y, width: size, height: size, fontSize: 16, text: '', imageUrl };
}
