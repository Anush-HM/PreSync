import { Ban } from 'lucide-react';
import Popover from '../ui/Popover.jsx';
import { keepCanvasFocus, PALETTE } from './palette.js';

// A colour grid in a popover. `onPick(null)` clears when `allowNone`.
export function ColorPopover({ label, icon: Icon, value, onPick, colors = PALETTE, allowNone = false, noneLabel = 'None', align = 'start', disabled }) {
  return (
    <Popover
      label={label}
      tip={label}
      disabled={disabled}
      align={align}
      triggerClassName="icon-btn tb-color"
      trigger={
        <>
          <Icon aria-hidden="true" />
          <span className="tb-color-bar" style={{ background: value || 'transparent' }} aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <div className="colorpop" onMouseDown={keepCanvasFocus}>
          <div className="colorpop-grid" role="group" aria-label={label}>
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch is-square"
                style={{ background: c }}
                aria-label={c}
                aria-pressed={value?.toLowerCase() === c}
                onClick={() => {
                  // Closing first, so a pick that focuses the text keeps it.
                  close();
                  onPick(c);
                }}
              />
            ))}
          </div>
          <div className="colorpop-foot">
            {allowNone && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { close(); onPick(null); }}>
                <Ban aria-hidden="true" />{noneLabel}
              </button>
            )}
            <label className="btn btn-ghost btn-sm colorpop-custom">
              <span className="colorpop-custom-chip" style={{ background: value || '#ffffff' }} aria-hidden="true" />
              Custom
              <input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'} onChange={(e) => onPick(e.target.value)} />
            </label>
          </div>
        </div>
      )}
    </Popover>
  );
}

// A labelled number field that commits on Enter or blur.
export function NumberField({ label, value, onCommit, min, max, step = 1, suffix, className = '' }) {
  return (
    <label className={`numfield ${className}`}>
      <span className="numfield-label">{label}</span>
      <input
        key={value}
        className="input numfield-input mono"
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={Number.isFinite(value) ? Math.round(value * 10) / 10 : ''}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n) && n !== value) onCommit(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      {suffix && <span className="numfield-suffix">{suffix}</span>}
    </label>
  );
}
