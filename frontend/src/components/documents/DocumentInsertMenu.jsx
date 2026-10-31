import { useRef, useState } from 'react';
import { ImagePlus, List, ListOrdered, Minus, Plus, Quote, Scissors, Shapes, Table2, Type } from 'lucide-react';
import Popover from '../ui/Popover.jsx';
import { useToast } from '../ui/Toast.jsx';
import { CALLOUT_TONES } from './documentExtensions.js';
import { DOCUMENT_SHAPES } from './documentShapes.js';
import ShapeGlyph from './ShapeGlyph.jsx';
import { readPicture } from './documentPictures.js';

const MAX_ROWS = 50;
const MAX_COLS = 12;
const GRID_ROWS = 8;
const GRID_COLS = 10;

const TABS = [
  { id: 'text', label: 'Text', icon: Type },
  { id: 'table', label: 'Table', icon: Table2 },
  { id: 'image', label: 'Image', icon: ImagePlus },
  { id: 'elements', label: 'Elements', icon: Shapes }
];

const setBlock = (chain, type, attrs) => chain.focus().clearNodes()[type === 'paragraph' ? 'setParagraph' : 'setHeading'](attrs);

const TEXT_ITEMS = [
  { id: 'title', label: 'Title', style: { fontSize: 24, fontWeight: 700 }, run: (e) => setBlock(e.chain(), 'paragraph').updateAttributes('paragraph', { blockStyle: 'title' }).run() },
  { id: 'h1', label: 'Heading 1', style: { fontSize: 20, fontWeight: 700 }, run: (e) => setBlock(e.chain(), 'heading', { level: 1 }).run() },
  { id: 'h2', label: 'Heading 2', style: { fontSize: 17, fontWeight: 700 }, run: (e) => setBlock(e.chain(), 'heading', { level: 2 }).run() },
  { id: 'h3', label: 'Subheading', style: { fontSize: 14, fontWeight: 600 }, run: (e) => setBlock(e.chain(), 'heading', { level: 3 }).run() },
  { id: 'body', label: 'Body text', style: { fontSize: 13 }, run: (e) => setBlock(e.chain(), 'paragraph').updateAttributes('paragraph', { blockStyle: null }).run() },
  { id: 'bullets', label: 'Bulleted list', icon: List, run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'numbers', label: 'Numbered list', icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'quote', label: 'Blockquote', icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: 'caption', label: 'Caption', style: { fontSize: 12, fontStyle: 'italic' }, run: (e) => setBlock(e.chain(), 'paragraph').updateAttributes('paragraph', { blockStyle: 'caption' }).run() },
  { id: 'divider', label: 'Horizontal divider line', icon: Minus, run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: 'break', label: 'Page break', icon: Scissors, run: (e) => e.chain().focus().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run() }
];

const tableCount = (value, max) => Math.max(1, Math.min(max, parseInt(value, 10) || 1));

function TablePicker({ onPick }) {
  const [hover, setHover] = useState({ r: 2, c: 3 });
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('3');
  return (
    <div className="tablepick">
      <div
        className="tablepick-grid"
        role="grid"
        aria-label="Table size"
        style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }}
        onKeyDown={(e) => {
          const moves = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
          if (!moves[e.key]) return;
          e.preventDefault();
          const r = Math.max(0, Math.min(GRID_ROWS - 1, hover.r + moves[e.key][0]));
          const c = Math.max(0, Math.min(GRID_COLS - 1, hover.c + moves[e.key][1]));
          setHover({ r, c });
          e.currentTarget.querySelector(`[data-cell="${r}-${c}"]`)?.focus();
        }}
      >
        {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => {
          const r = Math.floor(i / GRID_COLS);
          const c = i % GRID_COLS;
          return (
            <button
              key={i}
              type="button"
              data-cell={`${r}-${c}`}
              className={`tablepick-cell${r <= hover.r && c <= hover.c ? ' is-on' : ''}`}
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
      <form className="tablepick-custom" onSubmit={(e) => { e.preventDefault(); onPick(tableCount(rows, MAX_ROWS), tableCount(cols, MAX_COLS)); }}>
        <label className="tablepick-custom-label">
          <span>Rows</span>
          <input type="number" min="1" max={MAX_ROWS} value={rows} className="tablepick-custom-input" onChange={(e) => setRows(e.target.value)} onBlur={() => setRows(String(tableCount(rows, MAX_ROWS)))} />
        </label>
        <span className="tablepick-custom-sep">×</span>
        <label className="tablepick-custom-label">
          <span>Cols</span>
          <input type="number" min="1" max={MAX_COLS} value={cols} className="tablepick-custom-input" onChange={(e) => setCols(e.target.value)} onBlur={() => setCols(String(tableCount(cols, MAX_COLS)))} />
        </label>
        <button type="submit" className="btn btn-primary btn-sm tablepick-custom-btn">Insert</button>
      </form>
    </div>
  );
}

// Insert: text styles, tables, pictures, and shapes, badges and callouts.
function DocumentInsertMenu({ editor }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [tab, setTab] = useState('text');

  function insertTable(rows, cols) {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run();
  }

  async function insertPicture(file) {
    try {
      const attrs = await readPicture(file, editor.view.dom.clientWidth);
      editor.chain().focus().setImage(attrs).run();
    } catch (err) {
      toast.error(err.message);
    }
  }

  function insertShape(shape) {
    editor.chain().focus().insertContent([{ type: 'shape', attrs: { shape: shape.id, color: '#285c43', width: shape.width, height: shape.height } }, { type: 'paragraph' }]).run();
  }

  function insertBadge(tone) {
    editor.chain().focus().insertContent([{ type: 'text', text: tone.label, marks: [{ type: 'badge', attrs: { tone: tone.id } }] }, { type: 'text', text: ' ' }]).run();
  }

  function insertCallout(tone) {
    editor.chain().focus().insertContent([
      { type: 'callout', attrs: { tone: tone.id }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `${tone.label} note` }] }] },
      { type: 'paragraph' }
    ]).run();
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        hidden
        aria-label="Upload picture"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) insertPicture(file);
        }}
      />
      <Popover
        label="Insert"
        tip="Insert"
        triggerClassName="btn btn-ghost btn-sm"
        trigger={<><Plus aria-hidden="true" /><span className="menu-trigger-text">Insert</span></>}
        panelClassName="insert-pop"
      >
        {(close) => {
          const done = (fn) => (...args) => {
            close();
            fn(...args);
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
                    {TEXT_ITEMS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button key={item.id} type="button" className="insert-text" onClick={done(() => item.run(editor))}>
                          {Icon && <Icon aria-hidden="true" />}
                          <span style={item.style}>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {tab === 'table' && <TablePicker onPick={done(insertTable)} />}
                {tab === 'image' && (
                  <div className="insert-list">
                    <button type="button" className="btn btn-secondary" onClick={done(() => fileRef.current?.click())}><ImagePlus aria-hidden="true" />Upload picture…</button>
                    <p className="field-hint">PNG, JPEG or GIF up to 1.5 MB. Select a picture to resize or align it. You can also paste or drop one onto the page.</p>
                  </div>
                )}
                {tab === 'elements' && (
                  <>
                    <div className="insert-group">
                      <h4 className="fontpick-heading">Shapes</h4>
                      <div className="doc-shape-grid">
                        {DOCUMENT_SHAPES.map((s) => (
                          <button key={s.id} type="button" className="shape-btn" aria-label={s.label} data-tip={s.label} onClick={done(() => insertShape(s))}>
                            <ShapeGlyph shape={s.id} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="insert-group">
                      <h4 className="fontpick-heading">Badges</h4>
                      <div className="doc-element-row">
                        {CALLOUT_TONES.map((t) => (
                          <button key={t.id} type="button" className="doc-badge doc-element-btn" data-tone={t.id} aria-label={`${t.label} badge`} onClick={done(() => insertBadge(t))}>{t.label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="insert-group">
                      <h4 className="fontpick-heading">Callout cards</h4>
                      <div className="insert-list">
                        {CALLOUT_TONES.map((t) => (
                          <button key={t.id} type="button" className="doc-callout doc-element-card" data-tone={t.id} aria-label={`${t.label} callout`} onClick={done(() => insertCallout(t))}>{t.label} note</button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        }}
      </Popover>
    </>
  );
}

export default DocumentInsertMenu;
