import { useState } from 'react';
import { BarChart3, ImagePlus, LayoutTemplate, Minus, Plus, Shapes, Smile, Table2, Type } from 'lucide-react';
import Popover from '../ui/Popover.jsx';
import LayoutThumb from './LayoutThumb.jsx';
import ElementsPanel from './ElementsPanel.jsx';
import { SHAPE_GROUPS } from '../../data/shapes.js';
import { CHART_KIND_LABELS, CHART_KINDS } from '../../data/chartLayout.js';
import { LAYOUTS } from '../../data/layouts.js';
import { TEXT_PRESETS } from '../../data/textPresets.js';

const TABS = [
  { id: 'text', label: 'Text', icon: Type },
  { id: 'elements', label: 'Elements', icon: Smile },
  { id: 'shapes', label: 'Shapes', icon: Shapes },
  { id: 'table', label: 'Table', icon: Table2 },
  { id: 'chart', label: 'Chart', icon: BarChart3 },
  { id: 'media', label: 'Picture', icon: ImagePlus },
  { id: 'slide', label: 'Slide', icon: LayoutTemplate }
];

function ShapeIcon({ preset }) {
  return (
    <svg viewBox="-40 -40 1080 1080" aria-hidden="true" className="shape-icon">
      {preset.shape === 'rect' && <rect x="0" y="120" width="1000" height="760" />}
      {preset.shape === 'roundRect' && <rect x="0" y="120" width="1000" height="760" rx="160" />}
      {preset.shape === 'ellipse' && <ellipse cx="500" cy="500" rx="500" ry="400" />}
      {preset.shape === 'line' && <line x1="0" y1="1000" x2="1000" y2="0" className="is-line" />}
      {preset.path && <path d={preset.path} />}
    </svg>
  );
}

const GRID_ROWS = 8;
const GRID_COLS = 10;

function TableSizePicker({ onPick }) {
  const [hover, setHover] = useState({ r: 2, c: 3 });
  return (
    <div className="tablepick">
      <div
        className="tablepick-grid"
        role="grid"
        aria-label="Table size"
        style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }}
        onKeyDown={(e) => {
          const moves = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
          if (moves[e.key]) {
            e.preventDefault();
            const r = Math.max(0, Math.min(GRID_ROWS - 1, hover.r + moves[e.key][0]));
            const c = Math.max(0, Math.min(GRID_COLS - 1, hover.c + moves[e.key][1]));
            setHover({ r, c });
            e.currentTarget.querySelector(`[data-cell="${r}-${c}"]`)?.focus();
          }
        }}
      >
        {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => {
          const r = Math.floor(i / GRID_COLS);
          const c = i % GRID_COLS;
          const on = r <= hover.r && c <= hover.c;
          return (
            <button
              key={i}
              type="button"
              data-cell={`${r}-${c}`}
              className={`tablepick-cell${on ? ' is-on' : ''}`}
              aria-label={`${r + 1} by ${c + 1} table`}
              tabIndex={r === hover.r && c === hover.c ? 0 : -1}
              onMouseEnter={() => setHover({ r, c })}
              onFocus={() => setHover({ r, c })}
              onClick={() => onPick(r + 1, c + 1)}
            />
          );
        })}
      </div>
      <p className="tablepick-label mono" aria-live="polite">{hover.r + 1} rows × {hover.c + 1} columns</p>
    </div>
  );
}

// Insert: text styles, stickers, icons and emoji, shapes, tables, charts,
// pictures, dividers and new slides from a layout. A new `request`
// ({ tab }) opens the menu on that tab, for the command palette.
function InsertMenu({ disabled, onText, onAsset, deckImages, onDeckImage, onShape, onTable, onChart, onImage, onDivider, onSlide, request }) {
  const [tab, setTab] = useState('text');
  const [lastRequest, setLastRequest] = useState(request);
  if (request !== lastRequest) {
    setLastRequest(request);
    if (request?.tab) setTab(request.tab);
  }
  return (
    <Popover
      label="Insert"
      tip="Insert"
      disabled={disabled}
      triggerClassName="btn btn-ghost btn-sm"
      trigger={<><Plus aria-hidden="true" /><span className="menu-trigger-text">Insert</span></>}
      panelClassName="insert-pop"
      openSignal={request}
    >
      {(close) => {
        const done = (fn) => (...args) => {
          fn(...args);
          close();
        };
        return (
          <div className="insert">
            <div className="insert-tabs" role="tablist" aria-label="Insert">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="insert-tab" onClick={() => setTab(t.id)}>
                    <Icon aria-hidden="true" />{t.label}
                  </button>
                );
              })}
            </div>
            <div className="insert-body" role="tabpanel">
              {tab === 'text' && (
                <div className="insert-list">
                  {TEXT_PRESETS.map((p) => (
                    <button key={p.id} type="button" className="insert-text" onClick={done(() => onText(p))}>
                      <span style={{ fontSize: Math.min(26, Math.max(13, p.fontSize * 0.6)), fontWeight: p.fontWeight || 400, fontStyle: p.fontStyle || 'normal' }}>{p.label}</span>
                    </button>
                  ))}
                  <button type="button" className="insert-text" onClick={done(onDivider)}>
                    <Minus aria-hidden="true" /> Divider line
                  </button>
                </div>
              )}
              {tab === 'elements' && (
                <ElementsPanel
                  onInsert={(asset, color) => { onAsset(asset, color); close(); }}
                  deckImages={deckImages}
                  onDeckImage={(img) => { onDeckImage(img); close(); }}
                />
              )}
              {tab === 'shapes' && SHAPE_GROUPS.map((g) => (
                <div key={g.id} className="insert-group">
                  <h4 className="fontpick-heading">{g.label}</h4>
                  <div className="shape-grid">
                    {g.shapes.map((s) => (
                      <button key={s.id} type="button" className="shape-btn" aria-label={s.label} data-tip={s.label} onClick={done(() => onShape(s))}>
                        <ShapeIcon preset={s} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {tab === 'table' && <TableSizePicker onPick={done(onTable)} />}
              {tab === 'chart' && (
                <div className="insert-list is-grid">
                  {CHART_KINDS.map((k) => (
                    <button key={k} type="button" className="insert-text" onClick={done(() => onChart(k))}>
                      <BarChart3 aria-hidden="true" />{CHART_KIND_LABELS[k]}
                    </button>
                  ))}
                  <p className="field-hint">Starts with sample data you can edit or paste from a spreadsheet.</p>
                </div>
              )}
              {tab === 'media' && (
                <div className="insert-list">
                  <button type="button" className="btn btn-secondary" onClick={done(onImage)}><ImagePlus aria-hidden="true" />Upload a picture…</button>
                  <p className="field-hint">PNG, JPEG or GIF up to 1.5 MB. You can also drag a picture onto the slide or paste one.</p>
                </div>
              )}
              {tab === 'slide' && (
                <div className="layout-grid">
                  {LAYOUTS.map((l) => (
                    <button key={l.id} type="button" className="layout-card" onClick={done(() => onSlide(l.id))}>
                      <LayoutThumb layout={l} />
                      <span>{l.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      }}
    </Popover>
  );
}

export default InsertMenu;
