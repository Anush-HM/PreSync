import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Star } from 'lucide-react';
import Popover from '../ui/Popover.jsx';
import {
  FONT_CATEGORIES, favoriteFonts, fontEntry, FONTS, loadFont, recentFonts, rememberFont, searchFonts, toggleFavoriteFont, weightName
} from '../../data/fonts.js';
import { primaryFont } from '../../data/slideFormat.js';

function FontRow({ font, current, favourite, onPick, onFavourite }) {
  useEffect(() => {
    loadFont(font.stack);
  }, [font.stack]);
  return (
    <li className={`fontpick-row${current ? ' is-current' : ''}`}>
      <button
        type="button"
        className="fontpick-pick"
        role="option"
        aria-selected={current}
        onClick={() => onPick(font)}
        style={{ fontFamily: font.stack }}
      >
        <span className="fontpick-name">{font.label}</span>
        <span className="fontpick-meta">{font.weights.length > 2 ? `${font.weights.length} weights` : font.weights.map(weightName).join(' · ')}</span>
      </button>
      <button
        type="button"
        className={`icon-btn icon-btn-sm fontpick-star${favourite ? ' is-on' : ''}`}
        aria-label={favourite ? `Remove ${font.label} from favourites` : `Add ${font.label} to favourites`}
        aria-pressed={favourite}
        onClick={() => onFavourite(font)}
      >
        <Star />
      </button>
    </li>
  );
}

// Font menu for the format bar: search, categories, favourites and
// recently used fonts, each drawn in its own typeface.
function FontPicker({ value, onPick }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(null);
  const [favs, setFavs] = useState(() => favoriteFonts());
  const [recents, setRecents] = useState(() => recentFonts());
  const listRef = useRef(null);
  const current = fontEntry(value);
  const label = current?.label || primaryFont(value) || 'Font';

  const results = useMemo(() => searchFonts(query, category), [query, category]);
  const byStack = (stacks) => stacks.map((s) => FONTS.find((f) => f.stack === s)).filter(Boolean);
  const showShortcuts = !query && !category;

  function pick(font, close) {
    rememberFont(font.stack);
    setRecents(recentFonts());
    loadFont(font.stack);
    onPick(font.stack);
    close();
  }

  function onListKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(listRef.current?.querySelectorAll('.fontpick-pick') || [])];
    const i = items.indexOf(document.activeElement);
    e.preventDefault();
    items[e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
  }

  const section = (title, fonts, close) =>
    fonts.length > 0 && (
      <div className="fontpick-section">
        <h4 className="fontpick-heading">{title}</h4>
        <ul className="fontpick-list" role="listbox" aria-label={title}>
          {fonts.map((f) => (
            <FontRow
              key={`${title}-${f.stack}`}
              font={f}
              current={current?.stack === f.stack}
              favourite={favs.includes(f.stack)}
              onPick={(font) => pick(font, close)}
              onFavourite={(font) => setFavs(toggleFavoriteFont(font.stack))}
            />
          ))}
        </ul>
      </div>
    );

  return (
    <Popover
      label={`Font: ${label}`}
      tip="Font"
      triggerClassName="btn btn-ghost btn-sm fontpick-trigger"
      trigger={<><span className="fontpick-current" style={{ fontFamily: value }}>{label}</span><ChevronDown aria-hidden="true" /></>}
      panelClassName="fontpick"
    >
      {(close) => (
        <div onKeyDown={onListKey}>
          <label className="fontpick-search">
            <Search aria-hidden="true" />
            <input
              className="input"
              type="search"
              placeholder="Search fonts"
              aria-label="Search fonts"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  listRef.current?.querySelector('.fontpick-pick')?.focus();
                }
                if (e.key === 'Enter' && results[0]) pick(results[0], close);
              }}
            />
          </label>
          <div className="fontpick-cats" role="group" aria-label="Font categories">
            <button type="button" className="chip" aria-pressed={!category} onClick={() => setCategory(null)}>All</button>
            {FONT_CATEGORIES.map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? null : c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="fontpick-scroll" ref={listRef}>
            {showShortcuts && section('Favourites', byStack(favs), close)}
            {showShortcuts && section('Recent', byStack(recents), close)}
            {section(showShortcuts ? 'All fonts' : `${results.length} font${results.length === 1 ? '' : 's'}`, results, close)}
            {results.length === 0 && <p className="fontpick-empty">No fonts match “{query}”.</p>}
          </div>
          <p className="fontpick-note">Web fonts are open-licence families loaded from Google Fonts when used. Office fonts use the device's copy or an open look-alike.</p>
        </div>
      )}
    </Popover>
  );
}

export default FontPicker;
