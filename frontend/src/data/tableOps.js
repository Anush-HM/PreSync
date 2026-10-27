// Pure edits on a table block's `table` field:
//   { columns: [width], rows: [{ height, cells: [cell] }] }
// where a cell carries its own text and formatting, and merged areas are
// one cell with colspan/rowspan plus `covered: true` cells under it.
// Every function returns a new table and leaves its input alone.

export const MAX_TABLE_ROWS = 60;
export const MAX_TABLE_COLS = 20;
const DEFAULT_PADDING = [6, 8, 6, 8];
const r1 = (v) => Math.round(v * 10) / 10;

function cloneTable(table) {
  return {
    ...table,
    columns: [...table.columns],
    rows: table.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c })) }))
  };
}

// PreSync's own table look: a forest header row and light banding.
export const TABLE_STYLES = {
  forest: { header: '#2e5e4e', headerText: '#ffffff', band: '#eef3ef', body: '#ffffff', border: '#c9d4cc', text: '#1a1a2e' },
  charcoal: { header: '#232826', headerText: '#f2f4f0', band: '#f2f3f1', body: '#ffffff', border: '#cfd3cf', text: '#1a1a2e' },
  crimson: { header: '#8f2632', headerText: '#ffffff', band: '#f8eeee', body: '#ffffff', border: '#e0c5c8', text: '#1a1a2e' },
  plain: { header: '#ffffff', headerText: '#1a1a2e', band: '#ffffff', body: '#ffffff', border: '#8a8f88', text: '#1a1a2e' }
};

function styledCell(style, r, { header }) {
  const isHeader = header && r === 0;
  const border = { color: style.border, width: 1 };
  return {
    text: '',
    fontSize: 16,
    fill: isHeader ? style.headerText : style.text,
    ...(isHeader ? { fontWeight: 'bold' } : {}),
    background: isHeader ? style.header : (header ? r - 1 : r) % 2 ? style.band : style.body,
    verticalAlign: 'middle',
    padding: [...DEFAULT_PADDING],
    borders: { top: border, right: border, bottom: border, left: border }
  };
}

// A new table of rows × cols filling width × height.
export function makeTable(rows, cols, { width = 640, height, header = true, style = 'forest' } = {}) {
  const nRows = Math.max(1, Math.min(MAX_TABLE_ROWS, rows));
  const nCols = Math.max(1, Math.min(MAX_TABLE_COLS, cols));
  const s = TABLE_STYLES[style] || TABLE_STYLES.forest;
  const rowH = height ? height / nRows : 40;
  return {
    columns: Array(nCols).fill(r1(width / nCols)),
    rows: Array.from({ length: nRows }, (_, r) => ({
      height: r1(rowH),
      cells: Array.from({ length: nCols }, () => styledCell(s, r, { header }))
    })),
    header: !!header,
    style: TABLE_STYLES[style] ? style : 'forest'
  };
}

// The cell that draws over (r, c): itself, or the merged cell covering it.
export function ownerOf(table, r, c) {
  for (let rr = r; rr >= 0; rr--) {
    for (let cc = c; cc >= 0; cc--) {
      const cell = table.rows[rr]?.cells[cc];
      if (!cell || cell.covered) continue;
      if (rr + (cell.rowspan || 1) > r && cc + (cell.colspan || 1) > c) return { r: rr, c: cc };
    }
  }
  return { r, c };
}

// Swaps rows and columns, so column edits can reuse the row edits.
function transpose(table) {
  const nRows = table.rows.length;
  const nCols = table.columns.length;
  const rows = Array.from({ length: nCols }, (_, c) => ({
    height: table.columns[c],
    cells: Array.from({ length: nRows }, (_, r) => {
      const cell = { ...table.rows[r].cells[c] };
      const { colspan, rowspan } = cell;
      delete cell.colspan;
      delete cell.rowspan;
      if (rowspan > 1) cell.colspan = rowspan;
      if (colspan > 1) cell.rowspan = colspan;
      return cell;
    })
  }));
  return { ...table, columns: table.rows.map((row) => row.height || 0), rows };
}

function blankLike(cell) {
  const out = { ...cell, text: '' };
  delete out.styles;
  delete out.colspan;
  delete out.rowspan;
  delete out.covered;
  return out;
}

// Inserts an empty row at index `at` (0 … rows.length), styled like its
// neighbour. A merged cell that spans the gap grows to cover it.
export function insertRow(table, at) {
  if (table.rows.length >= MAX_TABLE_ROWS) return table;
  const t = cloneTable(table);
  const index = Math.max(0, Math.min(t.rows.length, at));
  const model = t.rows[Math.min(t.rows.length - 1, Math.max(0, index === 0 ? 0 : index - 1))];
  // Don't copy header styling into a new body row.
  const modelRow = index > 0 && t.header && index - 1 === 0 && t.rows[1] ? t.rows[1] : model;
  const cells = t.columns.map((_, c) => {
    if (index > 0 && index < t.rows.length) {
      const o = ownerOf(t, index, c);
      if (o.r < index) {
        if (o.c === c) {
          const owner = t.rows[o.r].cells[o.c];
          owner.rowspan = (owner.rowspan || 1) + 1;
        }
        return { ...blankLike(modelRow.cells[c] || {}), covered: true };
      }
    }
    return blankLike(modelRow.cells[c] || {});
  });
  t.rows.splice(index, 0, { height: model?.height || 40, cells });
  return t;
}

// Removes row `r`. Merged cells starting there move down a row; ones
// spanning across it shrink.
export function deleteRow(table, r) {
  if (table.rows.length <= 1 || r < 0 || r >= table.rows.length) return table;
  const t = cloneTable(table);
  t.columns.forEach((_, c) => {
    const o = ownerOf(t, r, c);
    if (o.c !== c) return;
    const owner = t.rows[o.r].cells[o.c];
    const span = owner.rowspan || 1;
    if (span <= 1) return;
    if (o.r < r) owner.rowspan = span - 1;
    else {
      // The owner itself is deleted: hand its content to the row below.
      const below = { ...owner, rowspan: span - 1 };
      if (below.rowspan <= 1) delete below.rowspan;
      delete below.covered;
      t.rows[r + 1].cells[c] = below;
    }
  });
  t.rows.splice(r, 1);
  t.rows.forEach((row) => row.cells.forEach((cell) => {
    if (cell.rowspan <= 1) delete cell.rowspan;
  }));
  return t;
}

export function insertColumn(table, at) {
  if (table.columns.length >= MAX_TABLE_COLS) return table;
  const out = transpose(insertRow(transpose(table), at));
  // Keep the table's overall width: the new column takes an even share.
  const total = table.columns.reduce((a, w) => a + w, 0);
  const k = total / out.columns.reduce((a, w) => a + w, 0);
  out.columns = out.columns.map((w) => r1(w * k));
  return out;
}

export function deleteColumn(table, c) {
  if (table.columns.length <= 1) return table;
  const total = table.columns.reduce((a, w) => a + w, 0);
  const out = transpose(deleteRow(transpose(table), c));
  const k = total / (out.columns.reduce((a, w) => a + w, 0) || 1);
  out.columns = out.columns.map((w) => r1(w * k));
  return out;
}

// Normalises a selection to its corners, grown to include whole merges.
export function selectionRect(table, a, b = a) {
  let r0 = Math.min(a.r, b.r);
  let r1_ = Math.max(a.r, b.r);
  let c0 = Math.min(a.c, b.c);
  let c1 = Math.max(a.c, b.c);
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = r0; r <= r1_; r++) {
      for (let c = c0; c <= c1; c++) {
        const o = ownerOf(table, r, c);
        const cell = table.rows[o.r].cells[o.c];
        const er = o.r + (cell.rowspan || 1) - 1;
        const ec = o.c + (cell.colspan || 1) - 1;
        if (o.r < r0 || o.c < c0 || er > r1_ || ec > c1) {
          r0 = Math.min(r0, o.r);
          c0 = Math.min(c0, o.c);
          r1_ = Math.max(r1_, er);
          c1 = Math.max(c1, ec);
          changed = true;
        }
      }
    }
  }
  return { r0, c0, r1: r1_, c1 };
}

// Merges the rectangle into its top-left cell; text from the other cells
// is kept, one line each.
export function mergeCells(table, a, b) {
  const { r0, c0, r1: re, c1 } = selectionRect(table, a, b);
  if (r0 === re && c0 === c1) return table;
  const t = cloneTable(table);
  const texts = [];
  for (let r = r0; r <= re; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = t.rows[r].cells[c];
      if (!cell.covered && cell.text?.trim()) texts.push(cell.text);
      if (r !== r0 || c !== c0) {
        t.rows[r].cells[c] = { ...blankLike(cell), covered: true };
      }
    }
  }
  const top = t.rows[r0].cells[c0];
  top.text = texts.join('\n');
  if (texts.length > 1) delete top.styles;
  top.colspan = c1 - c0 + 1;
  top.rowspan = re - r0 + 1;
  if (top.colspan === 1) delete top.colspan;
  if (top.rowspan === 1) delete top.rowspan;
  return t;
}

// Splits a merged cell back into single cells (the text stays in the first).
export function splitCell(table, r, c) {
  const o = ownerOf(table, r, c);
  const t = cloneTable(table);
  const cell = t.rows[o.r].cells[o.c];
  const rs = cell.rowspan || 1;
  const cs = cell.colspan || 1;
  if (rs === 1 && cs === 1) return table;
  for (let rr = o.r; rr < o.r + rs; rr++) {
    for (let cc = o.c; cc < o.c + cs; cc++) {
      if (rr === o.r && cc === o.c) continue;
      t.rows[rr].cells[cc] = blankLike(cell);
    }
  }
  delete cell.rowspan;
  delete cell.colspan;
  return t;
}

export function isMerged(table, r, c) {
  const o = ownerOf(table, r, c);
  const cell = table.rows[o.r]?.cells[o.c];
  return !!cell && ((cell.rowspan || 1) > 1 || (cell.colspan || 1) > 1);
}

// Applies `patch` to every cell in the rectangle (null removes a key).
export function formatCells(table, a, b, patch) {
  const { r0, c0, r1: re, c1 } = selectionRect(table, a, b);
  const t = cloneTable(table);
  for (let r = r0; r <= re; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = t.rows[r].cells[c];
      if (cell.covered) continue;
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined) delete cell[k];
        else cell[k] = v;
        // A cell-wide change wins over the same key inside its text.
        if (Array.isArray(cell.styles)) {
          cell.styles = cell.styles.map((s) => {
            const style = { ...s.style };
            delete style[k];
            return { ...s, style };
          }).filter((s) => Object.keys(s.style).length);
          if (!cell.styles.length) delete cell.styles;
        }
      }
    }
  }
  return t;
}

// Borders on the rectangle: `sides` is 'all', 'outer', 'inner' or 'none'.
export function setBorders(table, a, b, { color = '#8a8f88', width = 1, sides = 'all' } = {}) {
  const { r0, c0, r1: re, c1 } = selectionRect(table, a, b);
  const t = cloneTable(table);
  const line = sides === 'none' ? null : { color, width };
  for (let r = r0; r <= re; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = t.rows[r].cells[c];
      if (cell.covered) continue;
      const er = r + (cell.rowspan || 1) - 1;
      const ec = c + (cell.colspan || 1) - 1;
      const outer = { top: r === r0, bottom: er === re, left: c === c0, right: ec === c1 };
      const borders = { ...(cell.borders || {}) };
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const apply = sides === 'all' || sides === 'none' || (sides === 'outer' ? outer[side] : !outer[side]);
        if (!apply) continue;
        if (line) borders[side] = line;
        else delete borders[side];
      }
      cell.borders = borders;
    }
  }
  return t;
}

export function setCellText(table, r, c, text) {
  const t = cloneTable(table);
  const cell = t.rows[r]?.cells[c];
  if (!cell || cell.covered) return table;
  const len = Array.from(text.replace(/\n/g, '')).length;
  const styles = (cell.styles || []).map((st) => ({ ...st, end: Math.min(st.end, len) })).filter((st) => st.start < st.end);
  cell.text = text;
  if (styles.length) cell.styles = styles;
  else delete cell.styles;
  return t;
}

// Pastes tab-separated text (from a spreadsheet) starting at (r, c),
// adding rows and columns as needed.
export function pasteGrid(table, r, c, tsv) {
  const lines = String(tsv).replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
  if (!lines.length) return table;
  let t = table;
  const needRows = Math.min(MAX_TABLE_ROWS, r + lines.length);
  while (t.rows.length < needRows) t = insertRow(t, t.rows.length);
  const needCols = Math.min(MAX_TABLE_COLS, c + Math.max(...lines.map((l) => l.length)));
  while (t.columns.length < needCols) t = insertColumn(t, t.columns.length);
  lines.forEach((cells, i) => cells.forEach((text, j) => {
    const rr = r + i;
    const cc = c + j;
    if (rr >= t.rows.length || cc >= t.columns.length) return;
    const o = ownerOf(t, rr, cc);
    if (o.r === rr && o.c === cc) t = setCellText(t, rr, cc, text.trim());
  }));
  return t;
}

export function setColumnWidth(table, c, width) {
  const t = cloneTable(table);
  if (c < 0 || c >= t.columns.length) return table;
  t.columns[c] = r1(Math.max(16, width));
  return t;
}

export function setRowHeight(table, r, height) {
  const t = cloneTable(table);
  if (!t.rows[r]) return table;
  t.rows[r].height = r1(Math.max(12, height));
  return t;
}

// Restyles the whole table with one of TABLE_STYLES, keeping its text.
export function applyTableStyle(table, styleName, { header = table.header ?? true } = {}) {
  const s = TABLE_STYLES[styleName] || TABLE_STYLES.forest;
  const t = cloneTable(table);
  t.header = header;
  t.style = TABLE_STYLES[styleName] ? styleName : 'forest';
  t.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
    const look = styledCell(s, r, { header });
    const next = { ...cell, fill: look.fill, background: look.background, borders: look.borders };
    if (look.fontWeight) next.fontWeight = 'bold';
    else delete next.fontWeight;
    row.cells[c] = next;
  }));
  return t;
}

// Plain text of a table, as stored in the block's `text` for search and
// screen readers.
export function tableText(table) {
  return table.rows.map((row) => row.cells.filter((c) => !c.covered).map((c) => c.text || '').join('\t')).join('\n');
}

export function tableSize(table) {
  return {
    width: r1(table.columns.reduce((a, w) => a + w, 0)),
    height: r1(table.rows.reduce((a, r) => a + (r.height || 0), 0))
  };
}

// Next cell for keyboard movement, skipping covered cells.
export function stepCell(table, r, c, dir) {
  const nR = table.rows.length;
  const nC = table.columns.length;
  let rr = r;
  let cc = c;
  for (let guard = 0; guard < nR * nC; guard++) {
    if (dir === 'next') { cc += 1; if (cc >= nC) { cc = 0; rr = (rr + 1) % nR; } }
    else if (dir === 'prev') { cc -= 1; if (cc < 0) { cc = nC - 1; rr = (rr - 1 + nR) % nR; } }
    else if (dir === 'down') rr = Math.min(nR - 1, rr + 1);
    else if (dir === 'up') rr = Math.max(0, rr - 1);
    else if (dir === 'right') cc = Math.min(nC - 1, cc + 1);
    else if (dir === 'left') cc = Math.max(0, cc - 1);
    const o = ownerOf(table, rr, cc);
    if (o.r !== r || o.c !== c) return o;
    if (dir === 'down' || dir === 'up' || dir === 'left' || dir === 'right') return o;
  }
  return { r, c };
}
