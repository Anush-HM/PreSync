import { useState } from 'react';
import Dialog from '../ui/Dialog.jsx';
import { BORDER_COLORS, BORDER_STYLES, BORDER_WIDTHS, borderStyle, MAX_BORDER_INSET, NUMBER_POSITIONS } from './pageLayout.js';

const ALL_SIDES = { top: true, right: true, bottom: true, left: true };
const SETTINGS = [
  { id: 'none', label: 'None' },
  { id: 'box', label: 'Box' },
  { id: 'topBottom', label: 'Top & bottom' },
  { id: 'custom', label: 'Custom' }
];
const SCOPES = [
  { id: 'all', label: 'Entire document' },
  { id: 'first', label: 'First page only' },
  { id: 'exceptFirst', label: 'All except first page' },
  { id: 'pages', label: 'Specific pages' }
];

function settingOf(border) {
  if (!border) return 'none';
  const { top, right, bottom, left } = border.sides;
  if (top && right && bottom && left) return 'box';
  if (top && bottom && !left && !right) return 'topBottom';
  return 'custom';
}

export function PageBorderDialog({ border, onApply, onClose }) {
  const [setting, setSetting] = useState(settingOf(border));
  const [sides, setSides] = useState(border?.sides || ALL_SIDES);
  const [style, setStyle] = useState(border?.style || 'solid');
  const [width, setWidth] = useState(border?.width || 1);
  const [color, setColor] = useState(border?.color || '#000000');
  const [inset, setInset] = useState(border?.inset ?? 24);
  const [scope, setScope] = useState(border?.scope || 'all');
  const [pages, setPages] = useState(border?.pages || '');

  const chosenSides = setting === 'box' ? ALL_SIDES : setting === 'topBottom' ? { top: true, right: false, bottom: true, left: false } : sides;
  const preview = { sides: chosenSides, style, width, color, inset: inset / 3 };

  function apply() {
    if (setting === 'none' || !Object.values(chosenSides).some(Boolean)) onApply(null);
    else onApply({ sides: chosenSides, style, width, color, inset: Math.max(0, Math.min(MAX_BORDER_INSET, Number(inset) || 0)), scope, pages });
  }

  return (
    <Dialog
      title="Page border"
      description="Frames each page, measured from the edge of the paper."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={apply}>Apply</button>
        </>
      }
    >
      <div className="doc-dialog">
        <div className="field">
          <span className="field-label">Setting</span>
          <div className="segmented" role="group" aria-label="Border setting">
            {SETTINGS.map((s) => <button key={s.id} type="button" className="segmented-item" aria-pressed={setting === s.id} onClick={() => setSetting(s.id)}>{s.label}</button>)}
          </div>
        </div>
        {setting !== 'none' && (
          <>
            {setting === 'custom' && (
              <div className="doc-dialog-row" role="group" aria-label="Sides">
                {['top', 'bottom', 'left', 'right'].map((s) => (
                  <label key={s} className="doc-check">
                    <input type="checkbox" checked={sides[s]} onChange={(e) => setSides({ ...sides, [s]: e.target.checked })} />
                    {s[0].toUpperCase() + s.slice(1)}
                  </label>
                ))}
              </div>
            )}
            <div className="doc-dialog-grid">
              <label className="field">
                <span className="field-label">Style</span>
                <select className="select" value={style} onChange={(e) => setStyle(e.target.value)}>
                  {BORDER_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Width</span>
                <select className="select" value={width} onChange={(e) => setWidth(Number(e.target.value))}>
                  {BORDER_WIDTHS.map((w) => <option key={w} value={w}>{w} pt</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Distance from page edge (pt)</span>
                <input className="input" type="number" min="0" max={MAX_BORDER_INSET} value={inset} onChange={(e) => setInset(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Apply to</span>
                <select className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
                  {SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
            </div>
            {scope === 'pages' && (
              <label className="field">
                <span className="field-label">Pages</span>
                <input className="input" value={pages} placeholder="e.g. 1, 3-5" onChange={(e) => setPages(e.target.value)} />
                <span className="field-hint">Shown exactly in the editor and PDF. Word cannot border chosen pages, so a .docx puts it on every page.</span>
              </label>
            )}
            <div className="field">
              <span className="field-label">Colour</span>
              <div className="doc-dialog-row" role="group" aria-label="Border colour">
                {BORDER_COLORS.map((c) => (
                  <button key={c.id} type="button" className="swatch is-square" style={{ background: c.id }} aria-label={c.label} aria-pressed={color === c.id} onClick={() => setColor(c.id)} />
                ))}
                <label className="btn btn-ghost btn-sm colorpop-custom">
                  Custom
                  <input type="color" aria-label="Custom border colour" value={color} onChange={(e) => setColor(e.target.value)} />
                </label>
              </div>
            </div>
            <div className="doc-border-preview" aria-hidden="true"><div className="doc-sheet-border" style={borderStyle(preview)} /></div>
          </>
        )}
      </div>
    </Dialog>
  );
}

export function PageNumbersDialog({ numbers, onApply, onClose }) {
  const [position, setPosition] = useState(numbers?.position || 'bottom-center');
  const [format, setFormat] = useState(numbers?.format || 'plain');
  const [hideOnFirst, setHideOnFirst] = useState(!!numbers?.hideOnFirst);
  return (
    <Dialog
      title="Page numbers"
      onClose={onClose}
      footer={
        <>
          {numbers && <button type="button" className="btn btn-ghost" onClick={() => onApply(null)}>Remove numbers</button>}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onApply({ position, format, hideOnFirst })}>Apply</button>
        </>
      }
    >
      <div className="doc-dialog">
        <label className="field">
          <span className="field-label">Position</span>
          <select className="select" value={position} onChange={(e) => setPosition(e.target.value)}>
            {NUMBER_POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <div className="field">
          <span className="field-label">Format</span>
          <div className="segmented" role="group" aria-label="Number format">
            <button type="button" className="segmented-item" aria-pressed={format === 'plain'} onClick={() => setFormat('plain')}>1, 2, 3</button>
            <button type="button" className="segmented-item" aria-pressed={format === 'pageOf'} onClick={() => setFormat('pageOf')}>Page 1 of 5</button>
          </div>
        </div>
        <label className="doc-check">
          <input type="checkbox" checked={hideOnFirst} onChange={(e) => setHideOnFirst(e.target.checked)} />
          Hide on the first page
        </label>
      </div>
    </Dialog>
  );
}
