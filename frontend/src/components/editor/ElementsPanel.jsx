import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { ASSET_CATEGORIES, DEFAULT_ICON_COLOR, assetDataUrl, getAsset, searchAssets } from '../../data/assetLibrary.js';

const KINDS = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'sticker', label: 'Stickers', kinds: ['sticker'] },
  { id: 'icon', label: 'Icons', kinds: ['icon'] },
  { id: 'emoji', label: 'Emoji', kinds: ['emoji'] }
];

const ICON_COLORS = [DEFAULT_ICON_COLOR, '#171a19', '#ffffff', '#8f2638', '#2f6f9f', '#b07a2e', '#6b4fa0', '#858f88'];
const RECENTS_KEY = 'presync.recentAssets';
const MAX_RECENTS = 12;
const RESULTS = 96;

function readRecents() {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
    return Array.isArray(ids) ? ids.map(getAsset).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function rememberRecent(id) {
  try {
    const ids = [id, ...readRecents().map((a) => a.id).filter((x) => x !== id)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(ids));
  } catch {
    // storage blocked: recents are a convenience only
  }
}

function AssetTile({ asset, color, onPick }) {
  return (
    <button type="button" className={`asset-tile is-${asset.kind}`} aria-label={asset.name} data-tip={asset.name} onClick={() => onPick(asset)}>
      {asset.kind === 'emoji'
        ? <span className="asset-emoji" aria-hidden="true">{asset.emoji}</span>
        : <img src={assetDataUrl(asset, color)} alt="" draggable="false" />}
    </button>
  );
}

// Stickers, line icons, decorations and emoji from PreSync's own library,
// plus the pictures already used in this deck.
function ElementsPanel({ onInsert, deckImages = [], onDeckImage }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [category, setCategory] = useState(null);
  const [color, setColor] = useState(DEFAULT_ICON_COLOR);
  const [recents, setRecents] = useState(readRecents);
  const searchRef = useRef(null);
  useEffect(() => searchRef.current?.focus(), []);

  const kinds = KINDS.find((k) => k.id === kind).kinds;
  const results = useMemo(
    () => searchAssets(query, { limit: RESULTS, kinds, category: category || undefined }),
    [query, kinds, category]
  );
  const browsing = !query && !category;
  const showColors = kind === 'icon' || results.some((a) => a.recolor);

  function pick(asset) {
    rememberRecent(asset.id);
    setRecents(readRecents());
    onInsert(asset, color);
  }

  return (
    <div className="elements">
      <div className="elements-search">
        <Search aria-hidden="true" />
        <input
          ref={searchRef}
          className="input"
          type="search"
          placeholder="Search stickers, icons and emoji"
          aria-label="Search elements"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => setQuery('')}><X /></button>}
      </div>
      <div className="segmented elements-kinds" role="group" aria-label="Kind">
        {KINDS.map((k) => (
          <button key={k.id} type="button" className="segmented-item" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>
        ))}
      </div>
      <div className="elements-cats" role="group" aria-label="Category">
        {ASSET_CATEGORIES.map((c) => (
          <button key={c.id} type="button" className="chip" aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? null : c.id)}>{c.label}</button>
        ))}
      </div>
      {showColors && (
        <div className="elements-colors" role="group" aria-label="Icon colour">
          <span className="fontpick-heading">Icon colour</span>
          {ICON_COLORS.map((c) => (
            <button key={c} type="button" className="swatch is-square" style={{ background: c }} aria-label={`Icon colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />
          ))}
        </div>
      )}

      <div className="elements-scroll">
        {browsing && recents.length > 0 && (
          <section aria-label="Recently used">
            <h4 className="fontpick-heading">Recently used</h4>
            <div className="asset-grid">
              {recents.filter((a) => !kinds || kinds.includes(a.kind)).map((a) => <AssetTile key={a.id} asset={a} color={color} onPick={pick} />)}
            </div>
          </section>
        )}
        {browsing && kind === 'all' && deckImages.length > 0 && (
          <section aria-label="Pictures in this presentation">
            <h4 className="fontpick-heading">In this presentation</h4>
            <div className="asset-grid is-photos">
              {deckImages.map((img) => (
                <button key={img.key} type="button" className="asset-tile is-photo" aria-label={img.alt ? `Insert ${img.alt}` : 'Insert this picture again'} onClick={() => onDeckImage(img)}>
                  <img src={img.url} alt="" draggable="false" />
                </button>
              ))}
            </div>
          </section>
        )}
        <section aria-label="Results">
          {browsing && <h4 className="fontpick-heading">{kind === 'all' ? 'Library' : KINDS.find((k) => k.id === kind).label}</h4>}
          {results.length ? (
            <div className="asset-grid">
              {results.map((a) => <AssetTile key={a.id} asset={a} color={color} onPick={pick} />)}
            </div>
          ) : (
            <p className="field-hint elements-empty">Nothing matches “{query}”. Try a broader word like “growth”, “team” or “arrow”.</p>
          )}
        </section>
      </div>
      <p className="field-hint elements-licence">Original PreSync artwork. Emoji use your device’s own emoji font, so they look a little different on each system.</p>
    </div>
  );
}

export default ElementsPanel;
