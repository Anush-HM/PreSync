import { useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  BetweenHorizontalStart, BetweenVerticalStart, Bold, Grid3x3, PaintBucket, Baseline, TableCellsMerge, TableCellsSplit, Trash2
} from 'lucide-react';
import { ColorPopover } from './controls.jsx';
import {
  applyTableStyle, deleteColumn, deleteRow, formatCells, insertColumn, insertRow, isMerged, MAX_TABLE_COLS, MAX_TABLE_ROWS,
  mergeCells, ownerOf, pasteGrid, selectionRect, setBorders, setCellText, splitCell, stepCell, TABLE_STYLES
} from '../../data/tableOps.js';

const STYLE_LABELS = { forest: 'Forest', charcoal: 'Charcoal', crimson: 'Crimson', plain: 'Plain' };

// The table editor in the side panel: a grid of the table's cells to
// select (Shift-click or Shift+arrows for a range) and type into, with
// row, column, merge, colour, border and alignment tools.
function TableEditor({ block, onChange }) {
  const table = block.table;
  const [anchor, setAnchor] = useState({ r: 0, c: 0 });
  const [focus, setFocus] = useState({ r: 0, c: 0 });
  if (!table?.rows?.length) return null;
  const rows = table.rows.length;
  const cols = table.columns.length;
  const clampCell = (p) => ownerOf(table, Math.min(rows - 1, p.r), Math.min(cols - 1, p.c));
  const a = clampCell(anchor);
  const f = clampCell(focus);
  const rect = selectionRect(table, a, f);
  const inRect = (r, c) => r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1;
  const cell = table.rows[f.r].cells[f.c];
  const multi = rect.r0 !== rect.r1 || rect.c0 !== rect.c1;

  const select = (p, extend) => {
    if (!extend) setAnchor(p);
    setFocus(p);
  };
  const edit = (next, p) => {
    onChange(next);
    if (p) select(p, false);
  };
  const fmt = (patch) => onChange(formatCells(table, { r: rect.r0, c: rect.c0 }, { r: rect.r1, c: rect.c1 }, patch));

  function onCellKey(e, r, c) {
    const dir = { Tab: e.shiftKey ? 'prev' : 'next', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
    if (!dir) return;
    const field = e.currentTarget;
    const atStart = field.selectionStart === 0 && field.selectionEnd === 0;
    const atEnd = field.selectionStart === field.value.length;
    // Arrow keys move between cells only from the edge of a cell's text.
    if ((dir === 'left' || dir === 'up') && !atStart && e.key !== 'Tab') return;
    if ((dir === 'right' || dir === 'down') && !atEnd && e.key !== 'Tab') return;
    if (e.key === 'Tab' && dir === 'next' && r === rows - 1 && stepCell(table, r, c, 'next').r === r && stepCell(table, r, c, 'next').c === c) {
      // Tab in the last cell adds a row, as in a word processor.
      if (rows < MAX_TABLE_ROWS) {
        e.preventDefault();
        edit(insertRow(table, rows), { r: rows, c: 0 });
        requestAnimationFrame(() => document.querySelector(`[data-tcell="${block.id}-${rows}-0"]`)?.focus());
      }
      return;
    }
    e.preventDefault();
    const next = stepCell(table, r, c, dir);
    select(next, e.shiftKey && e.key !== 'Tab');
    // Move focus now, so the next key typed lands in the new cell.
    document.querySelector(`[data-tcell="${block.id}-${next.r}-${next.c}"]`)?.focus();
  }

  function onPaste(e, r, c) {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    onChange(pasteGrid(table, r, c, text));
  }

  const border = cell.borders?.top || { color: '#c9d4cc', width: 1 };

  return (
    <div className="table-editor">
      <div className="table-editor-grid" style={{ gridTemplateColumns: table.columns.map((w) => `minmax(48px, ${w}fr)`).join(' ') }}>
        {table.rows.map((row, r) =>
          row.cells.map((cl, c) =>
            cl.covered ? null : (
              <textarea
                key={`${r}-${c}`}
                data-tcell={`${block.id}-${r}-${c}`}
                className={`input table-editor-cell${inRect(r, c) ? ' is-selected' : ''}${f.r === r && f.c === c ? ' is-focus' : ''}`}
                style={{ gridRow: `${r + 1} / span ${cl.rowspan || 1}`, gridColumn: `${c + 1} / span ${cl.colspan || 1}`, fontWeight: cl.fontWeight === 'bold' ? 600 : 400, textAlign: cl.textAlign || 'left' }}
                rows={1}
                aria-label={`Row ${r + 1}, column ${c + 1}${cl.colspan > 1 || cl.rowspan > 1 ? ', merged' : ''}`}
                value={cl.text || ''}
                onMouseDown={(e) => {
                  if (e.shiftKey) {
                    e.preventDefault();
                    select({ r, c }, true);
                  }
                }}
                onFocus={() => {
                  if (!inRect(r, c) || !multi) select({ r, c }, false);
                }}
                onChange={(e) => onChange(setCellText(table, r, c, e.target.value))}
                onKeyDown={(e) => onCellKey(e, r, c)}
                onPaste={(e) => onPaste(e, r, c)}
              />
            )
          )
        )}
      </div>
      <p className="field-hint">
        {multi ? `${rect.r1 - rect.r0 + 1} × ${rect.c1 - rect.c0 + 1} cells selected. ` : ''}
        Tab moves to the next cell; Shift-click selects a range. Paste a range from a spreadsheet into any cell.
      </p>

      <h4 className="props-label">Rows and columns</h4>
      <div className="props-grid">
        <button type="button" className="btn btn-secondary btn-sm" disabled={rows >= MAX_TABLE_ROWS} onClick={() => edit(insertRow(table, rect.r0), { r: rect.r0, c: f.c })}><BetweenHorizontalStart aria-hidden="true" />Row above</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={rows >= MAX_TABLE_ROWS} onClick={() => edit(insertRow(table, rect.r1 + 1), { r: rect.r1 + 1, c: f.c })}><BetweenHorizontalStart aria-hidden="true" />Row below</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={cols >= MAX_TABLE_COLS} onClick={() => edit(insertColumn(table, rect.c0), { r: f.r, c: rect.c0 })}><BetweenVerticalStart aria-hidden="true" />Column left</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={cols >= MAX_TABLE_COLS} onClick={() => edit(insertColumn(table, rect.c1 + 1), { r: f.r, c: rect.c1 + 1 })}><BetweenVerticalStart aria-hidden="true" />Column right</button>
        <button type="button" className="btn btn-danger-ghost btn-sm" disabled={rows <= 1} onClick={() => {
          let t = table;
          for (let r = rect.r1; r >= rect.r0 && t.rows.length > 1; r--) t = deleteRow(t, r);
          edit(t, { r: Math.max(0, rect.r0 - 1), c: 0 });
        }}><Trash2 aria-hidden="true" />Delete row{rect.r1 > rect.r0 ? 's' : ''}</button>
        <button type="button" className="btn btn-danger-ghost btn-sm" disabled={cols <= 1} onClick={() => {
          let t = table;
          for (let c = rect.c1; c >= rect.c0 && t.columns.length > 1; c--) t = deleteColumn(t, c);
          edit(t, { r: 0, c: Math.max(0, rect.c0 - 1) });
        }}><Trash2 aria-hidden="true" />Delete column{rect.c1 > rect.c0 ? 's' : ''}</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!multi} onClick={() => edit(mergeCells(table, { r: rect.r0, c: rect.c0 }, { r: rect.r1, c: rect.c1 }), { r: rect.r0, c: rect.c0 })}><TableCellsMerge aria-hidden="true" />Merge cells</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!isMerged(table, f.r, f.c)} onClick={() => edit(splitCell(table, f.r, f.c), f)}><TableCellsSplit aria-hidden="true" />Split cell</button>
      </div>

      <h4 className="props-label">Cell style</h4>
      <div className="props-row">
        <ColorPopover label="Cell fill" icon={PaintBucket} value={cell.background} allowNone noneLabel="No fill" onPick={(c) => fmt({ background: c })} />
        <ColorPopover label="Cell text colour" icon={Baseline} value={cell.fill} onPick={(c) => fmt({ fill: c })} />
        <button type="button" className="icon-btn" aria-label="Bold cells" aria-pressed={cell.fontWeight === 'bold'} onClick={() => fmt({ fontWeight: cell.fontWeight === 'bold' ? null : 'bold' })}><Bold /></button>
        <div className="segbar" role="group" aria-label="Horizontal alignment">
          {[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]].map(([al, Icon]) => (
            <button key={al} type="button" className="icon-btn" aria-label={`Align ${al}`} aria-pressed={(cell.textAlign || 'left') === al} onClick={() => fmt({ textAlign: al })}><Icon /></button>
          ))}
        </div>
        <div className="segbar" role="group" aria-label="Vertical alignment">
          {[['top', AlignVerticalJustifyStart], ['middle', AlignVerticalJustifyCenter], ['bottom', AlignVerticalJustifyEnd]].map(([al, Icon]) => (
            <button key={al} type="button" className="icon-btn" aria-label={`Align ${al}`} aria-pressed={(cell.verticalAlign || 'top') === al} onClick={() => fmt({ verticalAlign: al })}><Icon /></button>
          ))}
        </div>
      </div>
      <div className="props-row">
        <label className="numfield">
          <span className="numfield-label">Text size</span>
          <input className="input numfield-input mono" type="number" min={6} max={96} key={`fs-${cell.fontSize}`} defaultValue={cell.fontSize || 16} onBlur={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 6 && n <= 96 && n !== cell.fontSize) fmt({ fontSize: n });
          }} />
        </label>
        <label className="numfield">
          <span className="numfield-label">Padding</span>
          <input className="input numfield-input mono" type="number" min={0} max={40} key={`pad-${(cell.padding || [6])[0]}`} defaultValue={(cell.padding || [6, 8, 6, 8])[0]} onBlur={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 0 && n <= 40) fmt({ padding: [n, Math.round(n * 1.4), n, Math.round(n * 1.4)] });
          }} />
        </label>
      </div>

      <h4 className="props-label">Borders</h4>
      <div className="props-row">
        <div className="segbar" role="group" aria-label="Border sides">
          {[['all', 'All'], ['outer', 'Outer'], ['inner', 'Inner'], ['none', 'None']].map(([sides, label]) => (
            <button key={sides} type="button" className="btn btn-quiet btn-sm" onClick={() => onChange(setBorders(table, { r: rect.r0, c: rect.c0 }, { r: rect.r1, c: rect.c1 }, { color: border.color, width: border.width, sides }))}>
              {label}
            </button>
          ))}
        </div>
        <ColorPopover label="Border colour" icon={Grid3x3} value={border.color} onPick={(c) => onChange(setBorders(table, { r: rect.r0, c: rect.c0 }, { r: rect.r1, c: rect.c1 }, { color: c || '#c9d4cc', width: border.width, sides: 'all' }))} />
        <select className="select select-sm" aria-label="Border width" value={border.width} onChange={(e) => onChange(setBorders(table, { r: rect.r0, c: rect.c0 }, { r: rect.r1, c: rect.c1 }, { color: border.color, width: Number(e.target.value), sides: 'all' }))}>
          {[0.5, 1, 2, 3, 4].map((w) => <option key={w} value={w}>{w}px</option>)}
        </select>
      </div>

      <h4 className="props-label">Table style</h4>
      <div className="table-styles">
        {Object.entries(TABLE_STYLES).map(([id, s]) => (
          <button key={id} type="button" className="table-style" onClick={() => onChange(applyTableStyle(table, id))} aria-label={`${STYLE_LABELS[id]} table style`}>
            <span style={{ background: s.header }} /><span style={{ background: s.band }} /><span style={{ background: s.body }} />
            <em>{STYLE_LABELS[id]}</em>
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={table.header ?? true} onChange={(e) => onChange(applyTableStyle(table, table.style || 'forest', { header: e.target.checked }))} />
        Header row
      </label>
    </div>
  );
}

export default TableEditor;
