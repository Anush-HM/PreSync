// PreSync's sticker, icon and emoji library.
//
// Export shape (kept stable; other editor features build on it):
//   ASSET_CATEGORIES: [{ id, label }]
//   ASSETS: [{ id, kind: 'emoji' | 'sticker' | 'icon', name, category, tags: [string],
//              emoji?: string, svg?: string, license: { name, source } }]
//   getAsset(id), searchAssets(query, { limit, kinds, category }), assetToBlock(asset, options)
//
// Licensing: emoji are the viewer's own platform emoji (inserted as text,
// no artwork is shipped). Stickers, line icons and decorations are
// original PreSync artwork drawn for this file and released under the
// repository's licence. Nothing here is copied from a third-party set.

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
  emoji('pin', '📌', 'Pushpin', 'shapes', ['important', 'note', 'pin']),
  emoji('laugh', '😂', 'Tears of joy', 'reactions', ['funny', 'laugh', 'lol', 'emotion']),
  emoji('wink', '😉', 'Winking face', 'reactions', ['joke', 'playful', 'emotion']),
  emoji('cool', '😎', 'Smiling face with sunglasses', 'reactions', ['cool', 'confident', 'emotion']),
  emoji('wow', '😮', 'Surprised face', 'reactions', ['surprise', 'wow', 'shock', 'emotion']),
  emoji('sad', '😢', 'Crying face', 'reactions', ['sad', 'sorry', 'emotion']),
  emoji('pray', '🙏', 'Folded hands', 'reactions', ['thanks', 'please', 'hope']),
  emoji('muscle', '💪', 'Flexed biceps', 'reactions', ['strong', 'effort', 'power', 'motivation']),
  emoji('raised-hands', '🙌', 'Raising hands', 'reactions', ['celebrate', 'hooray', 'yes']),
  emoji('wave-hand', '👋', 'Waving hand', 'reactions', ['hello', 'hi', 'bye', 'welcome']),
  emoji('hundred', '💯', 'Hundred points', 'reactions', ['perfect', 'score', 'full']),
  emoji('question', '❓', 'Question mark', 'reactions', ['question', 'ask', 'faq', 'help']),
  emoji('exclamation', '❗', 'Exclamation mark', 'reactions', ['important', 'warning', 'alert']),
  emoji('cake', '🎂', 'Birthday cake', 'celebration', ['birthday', 'party', 'anniversary']),
  emoji('champagne', '🍾', 'Bottle with popping cork', 'celebration', ['celebrate', 'cheers', 'launch']),
  emoji('crown', '👑', 'Crown', 'celebration', ['king', 'queen', 'best', 'winner']),
  emoji('fireworks', '🎆', 'Fireworks', 'celebration', ['new year', 'celebrate', 'festival']),
  emoji('ribbon', '🎀', 'Ribbon', 'celebration', ['gift', 'decoration']),
  emoji('backpack', '🎒', 'Backpack', 'education', ['school', 'student', 'bag']),
  emoji('ruler', '📏', 'Ruler', 'education', ['measure', 'math', 'geometry']),
  emoji('test-tube', '🧪', 'Test tube', 'education', ['science', 'experiment', 'chemistry', 'lab']),
  emoji('dna', '🧬', 'DNA', 'education', ['biology', 'science', 'genetics']),
  emoji('telescope', '🔭', 'Telescope', 'education', ['astronomy', 'vision', 'future', 'space']),
  emoji('brain', '🧠', 'Brain', 'education', ['think', 'mind', 'learn', 'smart', 'ai']),
  emoji('teacher', '🧑‍🏫', 'Teacher', 'education', ['teacher', 'class', 'lesson', 'school']),
  emoji('clipboard', '📋', 'Clipboard', 'business', ['list', 'tasks', 'checklist', 'agenda']),
  emoji('bar-chart', '📊', 'Bar chart', 'business', ['data', 'report', 'statistics', 'kpi']),
  emoji('office', '🏢', 'Office building', 'business', ['company', 'office', 'corporate']),
  emoji('clock', '⏰', 'Alarm clock', 'business', ['time', 'deadline', 'schedule', 'reminder']),
  emoji('hourglass', '⏳', 'Hourglass', 'business', ['time', 'wait', 'pending']),
  emoji('megaphone', '📣', 'Megaphone', 'business', ['announce', 'marketing', 'news']),
  emoji('key', '🔑', 'Key', 'business', ['access', 'key', 'solution', 'important']),
  emoji('puzzle', '🧩', 'Puzzle piece', 'business', ['problem', 'solution', 'fit', 'integration']),
  emoji('package', '📦', 'Package', 'business', ['delivery', 'shipping', 'product', 'release']),
  emoji('cactus', '🌵', 'Cactus', 'nature', ['desert', 'plant', 'dry']),
  emoji('maple', '🍁', 'Maple leaf', 'nature', ['autumn', 'fall', 'leaf']),
  emoji('snowflake', '❄️', 'Snowflake', 'nature', ['winter', 'cold', 'snow']),
  emoji('lightning', '⚡', 'High voltage', 'nature', ['power', 'energy', 'fast', 'electric']),
  emoji('earth-americas', '🌎', 'Globe showing the Americas', 'nature', ['earth', 'world', 'planet']),
  emoji('butterfly', '🦋', 'Butterfly', 'nature', ['change', 'transformation', 'insect']),
  emoji('bee', '🐝', 'Honeybee', 'nature', ['busy', 'work', 'insect']),
  emoji('battery', '🔋', 'Battery', 'technology', ['power', 'energy', 'charge']),
  emoji('desktop', '🖥️', 'Desktop computer', 'technology', ['computer', 'screen', 'monitor']),
  emoji('keyboard', '⌨️', 'Keyboard', 'technology', ['typing', 'computer', 'input']),
  emoji('cloud', '☁️', 'Cloud', 'technology', ['cloud', 'weather', 'online', 'storage']),
  emoji('link', '🔗', 'Link', 'technology', ['link', 'url', 'connection', 'chain']),
  emoji('magnifier', '🔍', 'Magnifying glass', 'technology', ['search', 'find', 'research', 'zoom']),
  emoji('wrench', '🔧', 'Wrench', 'technology', ['tool', 'fix', 'settings', 'maintenance']),
  emoji('signal', '📶', 'Signal bars', 'technology', ['network', 'wifi', 'mobile']),
  emoji('train', '🚆', 'Train', 'travel', ['rail', 'commute', 'journey']),
  emoji('car', '🚗', 'Car', 'travel', ['drive', 'road', 'trip']),
  emoji('ship', '🚢', 'Ship', 'travel', ['cruise', 'ocean', 'shipping']),
  emoji('beach', '🏖️', 'Beach with umbrella', 'travel', ['holiday', 'vacation', 'summer', 'beach']),
  emoji('city', '🏙️', 'Cityscape', 'travel', ['city', 'urban', 'skyline']),
  emoji('tent', '⛺', 'Tent', 'travel', ['camping', 'outdoors', 'retreat']),
  emoji('arrow-left', '⬅️', 'Left arrow', 'arrows', ['back', 'previous', 'arrow']),
  emoji('arrow-down', '⬇️', 'Down arrow', 'arrows', ['decrease', 'down', 'arrow']),
  emoji('arrows-cycle', '🔄', 'Counter-clockwise arrows', 'arrows', ['cycle', 'refresh', 'repeat', 'loop']),
  emoji('point-up', '☝️', 'Index pointing up', 'arrows', ['point', 'one', 'attention']),
  emoji('point-down', '👇', 'Pointing down', 'arrows', ['point', 'below', 'look']),
  emoji('circle-red', '🔴', 'Red circle', 'shapes', ['dot', 'status', 'live', 'circle']),
  emoji('circle-green', '🟢', 'Green circle', 'shapes', ['dot', 'status', 'go', 'circle']),
  emoji('square-blue', '🟦', 'Blue square', 'shapes', ['square', 'block', 'shape']),
  emoji('diamond', '🔶', 'Orange diamond', 'shapes', ['diamond', 'shape', 'bullet']),
  emoji('heart-green', '💚', 'Green heart', 'shapes', ['love', 'eco', 'heart'])
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

// Original line icons on a 24×24 grid, drawn in `currentColor` so they
// take whatever colour the author picks when inserting them.
const LINE_ATTRS = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const lineIcon = (id, name, category, tags, body) => ({
  id: `icon-${id}`,
  kind: 'icon',
  name,
  category,
  tags: [...tags, 'icon', 'line'],
  recolor: true,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${LINE_ATTRS}>${body}</svg>`,
  license: ORIGINAL_LICENSE
});

const LINE_ICONS = [
  lineIcon('check-circle', 'Check circle', 'business', ['done', 'complete', 'yes', 'success', 'tick'], '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.6L16 9.5"/>'),
  lineIcon('x-circle', 'Cross circle', 'business', ['no', 'cancel', 'wrong', 'fail', 'close'], '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  lineIcon('alert', 'Warning', 'business', ['warning', 'risk', 'alert', 'caution', 'issue'], '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>'),
  lineIcon('info', 'Information', 'business', ['info', 'about', 'note', 'help'], '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>'),
  lineIcon('bar-chart', 'Bar chart', 'business', ['chart', 'data', 'report', 'statistics', 'kpi', 'analytics'], '<path d="M4 20h16"/><path d="M7 16v-5M12 16V7M17 16v-8"/>'),
  lineIcon('pie-chart', 'Pie chart', 'business', ['chart', 'share', 'percentage', 'data', 'analytics'], '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>'),
  lineIcon('trend-up', 'Trend up', 'business', ['growth', 'increase', 'up', 'revenue', 'improve'], '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
  lineIcon('trend-down', 'Trend down', 'business', ['decline', 'decrease', 'down', 'loss'], '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>'),
  lineIcon('target', 'Target', 'business', ['goal', 'objective', 'aim', 'focus'], '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  lineIcon('flag', 'Flag', 'business', ['milestone', 'goal', 'finish', 'report'], '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  lineIcon('briefcase', 'Briefcase', 'business', ['work', 'job', 'career', 'business'], '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>'),
  lineIcon('calendar', 'Calendar', 'business', ['date', 'schedule', 'event', 'deadline', 'plan'], '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  lineIcon('clock', 'Clock', 'business', ['time', 'hour', 'schedule', 'duration'], '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
  lineIcon('dollar', 'Money', 'business', ['money', 'price', 'cost', 'budget', 'finance', 'dollar'], '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 2.9 5.6 1.4 5.6 4.3 0 1.3-1.2 2.1-2.8 2.1-1.3 0-2.4-.6-2.9-1.5M12 6v1.8M12 16.3V18"/>'),
  lineIcon('cart', 'Shopping cart', 'business', ['shop', 'buy', 'ecommerce', 'retail', 'cart'], '<path d="M3 4h2.5l2.2 11h10.6L20.5 8H6.5"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>'),
  lineIcon('user', 'Person', 'business', ['person', 'user', 'profile', 'customer', 'people'], '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'),
  lineIcon('users', 'People', 'business', ['team', 'people', 'group', 'community', 'audience'], '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.3c2.1.7 3.5 2.8 3.5 5.7"/>'),
  lineIcon('mail', 'Email', 'business', ['email', 'mail', 'message', 'contact', 'letter'], '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6l8.5 7 8.5-7"/>'),
  lineIcon('chat', 'Chat', 'reactions', ['chat', 'comment', 'talk', 'message', 'feedback'], '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>'),
  lineIcon('heart', 'Heart', 'reactions', ['love', 'like', 'favourite', 'care'], '<path d="M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.2 12 20 12 20z"/>'),
  lineIcon('star', 'Star', 'reactions', ['star', 'rating', 'favourite', 'quality', 'review'], '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  lineIcon('thumbs-up', 'Thumbs up', 'reactions', ['like', 'approve', 'good', 'yes'], '<path d="M7 10v10H4V10z"/><path d="M7 10l4-7c1.7 0 2.6 1.2 2.2 2.9L12.6 9H19a2 2 0 0 1 2 2.3l-1.2 6.9A2 2 0 0 1 17.8 20H7"/>'),
  lineIcon('bulb', 'Light bulb', 'education', ['idea', 'insight', 'tip', 'innovation', 'think'], '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>'),
  lineIcon('book', 'Book', 'education', ['book', 'read', 'study', 'learn', 'guide'], '<path d="M12 6.5C10 5 7 4.5 3.5 5v13.5C7 18 10 18.5 12 20c2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5V20"/>'),
  lineIcon('pen', 'Pen', 'education', ['write', 'edit', 'pen', 'sign', 'draft'], '<path d="M15.5 4.5l4 4L8 20H4v-4z"/><path d="M13 7l4 4"/>'),
  lineIcon('graduation', 'Graduation', 'education', ['graduate', 'school', 'degree', 'university', 'learn'], '<path d="M2.5 9.5L12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5v4.5c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3v-4.5M21.5 9.5v5"/>'),
  lineIcon('puzzle', 'Puzzle', 'education', ['problem', 'solution', 'fit', 'integration', 'piece'], '<path d="M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4v-4a2 2 0 1 0 0-4z"/>'),
  lineIcon('globe', 'Globe', 'travel', ['world', 'global', 'international', 'web', 'language'], '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'),
  lineIcon('map-pin', 'Map pin', 'travel', ['location', 'place', 'address', 'map', 'office'], '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  lineIcon('compass', 'Compass', 'travel', ['direction', 'navigate', 'explore', 'strategy'], '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  lineIcon('home', 'Home', 'travel', ['home', 'house', 'start', 'property'], '<path d="M3.5 11L12 4l8.5 7"/><path d="M6 9.5V20h12V9.5M10 20v-5h4v5"/>'),
  lineIcon('leaf', 'Leaf', 'nature', ['eco', 'green', 'sustainability', 'environment', 'organic'], '<path d="M20 4C10 4 4 8.5 4 15.5c0 1.6.4 3 1 4.5C12 20 20 15 20 4z"/><path d="M5 20c3-5 7-8.5 11-11"/>'),
  lineIcon('sun', 'Sun', 'nature', ['sun', 'day', 'summer', 'energy', 'solar'], '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  lineIcon('cloud', 'Cloud', 'technology', ['cloud', 'storage', 'online', 'weather', 'saas'], '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.6a4.5 4.5 0 0 1-.5 8.9z"/>'),
  lineIcon('lock', 'Lock', 'technology', ['security', 'privacy', 'safe', 'password', 'locked'], '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2"/>'),
  lineIcon('shield', 'Shield', 'technology', ['security', 'protection', 'safe', 'trust', 'compliance'], '<path d="M12 3l8 3v5.5c0 4.8-3.4 8.3-8 9.5-4.6-1.2-8-4.7-8-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-4.5"/>'),
  lineIcon('gear', 'Settings', 'technology', ['settings', 'gear', 'configure', 'engineering', 'process'], '<circle cx="12" cy="12" r="3"/><path d="M12 2.5l1.6 2.6 3-.6.6 3 2.6 1.6-1.5 2.9 1.5 2.9-2.6 1.6-.6 3-3-.6L12 21.5l-1.6-2.6-3 .6-.6-3-2.6-1.6 1.5-2.9-1.5-2.9 2.6-1.6.6-3 3 .6z"/>'),
  lineIcon('search', 'Search', 'technology', ['search', 'find', 'magnify', 'research', 'look'], '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>'),
  lineIcon('code', 'Code', 'technology', ['code', 'developer', 'programming', 'software', 'engineering'], '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>'),
  lineIcon('monitor', 'Monitor', 'technology', ['computer', 'screen', 'desktop', 'display'], '<rect x="3" y="4" width="18" height="12.5" rx="1.5"/><path d="M8.5 20.5h7M12 16.5v4"/>'),
  lineIcon('phone', 'Phone', 'technology', ['mobile', 'phone', 'app', 'device', 'call'], '<rect x="6.5" y="2.5" width="11" height="19" rx="2"/><path d="M11 18.5h2"/>'),
  lineIcon('link', 'Link', 'technology', ['link', 'url', 'connect', 'chain', 'web'], '<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.2-1.2"/>'),
  lineIcon('download', 'Download', 'technology', ['download', 'save', 'export', 'get'], '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15"/>'),
  lineIcon('upload', 'Upload', 'technology', ['upload', 'share', 'import', 'send'], '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M4.5 19.5h15"/>'),
  lineIcon('play', 'Play', 'technology', ['video', 'play', 'start', 'media', 'demo'], '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>'),
  lineIcon('camera', 'Camera', 'technology', ['photo', 'camera', 'picture', 'image'], '<path d="M3.5 8.5h3.5l1.5-2.5h7l1.5 2.5h3.5V19h-17z"/><circle cx="12" cy="13" r="3.5"/>'),
  lineIcon('arrow-right', 'Arrow right', 'arrows', ['arrow', 'next', 'forward', 'right'], '<path d="M4 12h16M14 6l6 6-6 6"/>'),
  lineIcon('arrow-up-right', 'Arrow up right', 'arrows', ['arrow', 'growth', 'external', 'diagonal'], '<path d="M6.5 17.5l11-11M8.5 6.5h9v9"/>'),
  lineIcon('arrows-cycle', 'Cycle arrows', 'arrows', ['cycle', 'loop', 'repeat', 'refresh', 'iterate'], '<path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1"/><path d="M17.5 3v4h-4M6.5 21v-4h4"/>'),
  lineIcon('chevrons', 'Double chevron', 'arrows', ['next', 'fast', 'forward', 'chevron'], '<path d="M6 6l6 6-6 6M13 6l6 6-6 6"/>')
];

export const ASSETS = [...STICKERS, ...LINE_ICONS, ...EMOJI];

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

// The asset's SVG markup, with recolourable icons painted in `color`.
export function assetSvg(asset, color) {
  if (!asset?.svg) return null;
  if (!asset.recolor) return asset.svg;
  const safe = /^#[0-9a-f]{3,8}$/i.test(color || '') ? color : DEFAULT_ICON_COLOR;
  return asset.svg.replace(/currentColor/g, safe);
}

export const DEFAULT_ICON_COLOR = '#285c43';

export function assetDataUrl(asset, color) {
  const markup = assetSvg(asset, color);
  return markup ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}` : null;
}

const RASTERIZE_TIMEOUT_MS = 3000;

// SVG → PNG, so inserted stickers export to PDF and PPTX like any
// uploaded picture. Falls back to the SVG itself where there is no canvas.
function rasterize(svgUrl, size) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return resolve(svgUrl);
    const img = new Image();
    // Never leave an insert hanging on a picture that doesn't decode.
    const timer = setTimeout(() => resolve(svgUrl), RASTERIZE_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
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
    img.onerror = () => {
      clearTimeout(timer);
      resolve(svgUrl);
    };
    img.src = svgUrl;
  });
}

// A block for the editor's document model. Emoji become a text box (so
// they stay editable and use the platform font); artwork becomes an image.
export async function assetToBlock(asset, { id, x = 680, y = 300, size = 160, color } = {}) {
  if (asset.kind === 'emoji') {
    return { id, type: 'textbox', x, y, width: Math.round(size * 1.2), fontSize: Math.round(size * 0.75), text: asset.emoji, textAlign: 'center' };
  }
  const imageUrl = await rasterize(assetDataUrl(asset, color), 360);
  return { id, type: 'image', x, y, width: size, height: size, fontSize: 16, text: '', imageUrl, alt: asset.name };
}
