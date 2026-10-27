import { attr, child, children, find, num } from './ooxml.js';
import { colorFrom, fillFrom, isHexColor, lineFrom, mixHex, representativeColor, styleRefFill } from './drawingml.js';

// PowerPoint tables (a:tbl inside a graphic frame) -> the editor's table
// block: column widths, row heights, and per-cell text, fill, borders,
// alignment and merges. Cell appearance comes from the table style
// (ppt/tableStyles.xml, or PowerPoint's built-in styles, which decks
// reference by id without including) overlaid with the cell's own
// properties, the same order PowerPoint applies them.

const PARTS = ['wholeTbl', 'band1H', 'band2H', 'band1V', 'band2V', 'firstCol', 'lastCol', 'lastRow', 'firstRow'];
const EDGES = ['left', 'right', 'top', 'bottom', 'insideH', 'insideV'];

// --- table styles ------------------------------------------------------------

function parseBorder(node, theme) {
  if (!node) return undefined;
  const ln = child(node, 'a:ln');
  if (ln) {
    const line = lineFrom(ln, theme);
    if (!line || line.none || !line.color) return { none: true };
    return { color: line.color, width: line.width ?? 12700 };
  }
  const ref = child(node, 'a:lnRef');
  if (ref) {
    const color = colorFrom(ref, theme);
    const idx = num(ref, 'idx') || 0;
    const entry = theme.lineStyles[idx - 1];
    return color && idx > 0 ? { color, width: num(entry, 'w') ?? 12700 } : { none: true };
  }
  return undefined;
}

function parseStylePart(node, theme) {
  if (!node) return null;
  const part = { text: {}, borders: {} };
  const tx = child(node, 'a:tcTxStyle');
  if (tx) {
    if (attr(tx, 'b') === 'on') part.text.bold = true;
    if (attr(tx, 'b') === 'off') part.text.bold = false;
    if (attr(tx, 'i') === 'on') part.text.italic = true;
    const color = colorFrom(tx, theme) || colorFrom(child(tx, 'a:fontRef'), theme);
    if (color) part.text.color = color;
  }
  const tc = child(node, 'a:tcStyle');
  const bdr = child(tc, 'a:tcBdr');
  for (const edge of EDGES) {
    const b = parseBorder(child(bdr, `a:${edge}`), theme);
    if (b) part.borders[edge] = b;
  }
  const fill = child(tc, 'a:fill');
  const fillRef = child(tc, 'a:fillRef');
  if (fill) {
    const f = fillFrom(fill, theme);
    part.fill = f?.type === 'none' ? null : representativeColor(f);
  } else if (fillRef) {
    part.fill = representativeColor(styleRefFill(fillRef, theme.fillStyles, theme));
  }
  return part;
}

export function parseTableStyles(root, theme) {
  const styles = new Map();
  for (const s of children(root, 'a:tblStyle')) {
    const parsed = {};
    for (const name of PARTS) parsed[name] = parseStylePart(child(s, `a:${name}`), theme);
    styles.set(attr(s, 'styleId'), parsed);
  }
  return styles;
}

// PowerPoint's built-in "Medium Style 2" family, which most decks use
// (it's the default for new tables). Decks reference it by id only.
const MEDIUM_STYLE_2 = {
  '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}': 'dk1',
  '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}': 'accent1',
  '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}': 'accent2',
  '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}': 'accent3',
  '{00A15C55-8517-42AA-B614-E9B94910E393}': 'accent4',
  '{7DF18680-E054-41AD-8BC1-D1AEF772440D}': 'accent5',
  '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}': 'accent6'
};

function builtInStyle(id, theme) {
  const key = MEDIUM_STYLE_2[id];
  if (!key) return null;
  const accent = theme.colors[key];
  const light = theme.colors.lt1 || '#ffffff';
  const dark = theme.colors.dk1 || '#000000';
  if (!isHexColor(accent)) return null;
  const thin = { color: light, width: 12700 };
  const thick = { color: light, width: 38100 };
  const header = { text: { bold: true, color: light }, fill: accent, borders: {} };
  return {
    wholeTbl: {
      text: { color: dark },
      fill: mixHex(light, accent, 0.2),
      borders: { left: thin, right: thin, top: thin, bottom: thin, insideH: thin, insideV: thin }
    },
    band1H: { text: {}, fill: mixHex(light, accent, 0.4), borders: {} },
    band2H: null,
    band1V: { text: {}, fill: mixHex(light, accent, 0.4), borders: {} },
    band2V: null,
    firstCol: header,
    lastCol: header,
    lastRow: { ...header, borders: { top: thick } },
    firstRow: { ...header, borders: { bottom: thick } }
  };
}

// --- table -> block -----------------------------------------------------------

// The style parts that apply to a cell, in the order they layer.
function partsFor(style, flags, r, c, rows, cols) {
  if (!style) return [];
  const out = [style.wholeTbl];
  const bodyRow = r - (flags.firstRow ? 1 : 0);
  const bodyCol = c - (flags.firstCol ? 1 : 0);
  if (flags.bandCol && bodyCol >= 0) out.push(bodyCol % 2 === 0 ? style.band1V : style.band2V);
  if (flags.bandRow && bodyRow >= 0) out.push(bodyRow % 2 === 0 ? style.band1H : style.band2H);
  if (flags.firstCol && c === 0) out.push(style.firstCol);
  if (flags.lastCol && c === cols - 1) out.push(style.lastCol);
  if (flags.lastRow && r === rows - 1) out.push(style.lastRow);
  if (flags.firstRow && r === 0) out.push(style.firstRow);
  return out.filter(Boolean);
}

const ANCHOR = { t: 'top', ctr: 'middle', b: 'bottom' };
const BORDER_TAG = { left: 'a:lnL', right: 'a:lnR', top: 'a:lnT', bottom: 'a:lnB' };

// frame: the graphic frame's canvas box. textFields(txBody, opts) is the
// importer's text extractor, so cell text keeps per-run formatting.
export function tableBlock(tbl, { box, theme, tableStyles, emuToPx, textFields, warnings }) {
  const tblPr = child(tbl, 'a:tblPr');
  const flags = {};
  for (const f of ['firstRow', 'firstCol', 'lastRow', 'lastCol', 'bandRow', 'bandCol']) flags[f] = attr(tblPr, f) === '1';
  const styleId = (find(tblPr, 'a:tableStyleId')?.textContent || '').trim();
  let style = null;
  if (styleId) {
    style = tableStyles.get(styleId) || builtInStyle(styleId, theme);
    if (!style) warnings.add('table-style');
  }
  const tableFill = representativeColor(fillFrom(tblPr, theme));

  const columns = children(find(tbl, 'a:tblGrid'), 'a:gridCol').map((g) => emuToPx(num(g, 'w') || 0));
  const trs = children(tbl, 'a:tr');
  const rows = [];
  trs.forEach((tr, r) => {
    const cells = [];
    children(tr, 'a:tc').forEach((tc, c) => {
      const tcPr = child(tc, 'a:tcPr');
      const parts = partsFor(style, flags, r, c, trs.length, columns.length);
      const textStyle = Object.assign({}, ...parts.map((p) => p.text));
      let background = tableFill || null;
      for (const p of parts) if (p.fill !== undefined) background = p.fill;
      const own = fillFrom(tcPr, theme);
      if (own) background = own.type === 'none' ? null : representativeColor(own);

      const borders = {};
      for (const edge of ['left', 'right', 'top', 'bottom']) {
        const isOuter =
          (edge === 'top' && r === 0) || (edge === 'bottom' && r === trs.length - 1) ||
          (edge === 'left' && c === 0) || (edge === 'right' && c === columns.length - 1);
        const inside = edge === 'top' || edge === 'bottom' ? 'insideH' : 'insideV';
        let b;
        for (const p of parts) {
          const v = isOuter ? p.borders[edge] : p.borders[edge] ?? p.borders[inside];
          if (v) b = v;
        }
        const ownLine = child(tcPr, BORDER_TAG[edge]);
        if (ownLine) {
          const l = lineFrom(ownLine, theme);
          b = !l || l.none || !l.color ? { none: true } : { color: l.color, width: l.width ?? 12700 };
        }
        borders[edge] = b && !b.none ? { color: b.color, width: Math.max(0.5, Math.round(emuToPx(b.width) * 10) / 10) } : null;
      }

      const fields = textFields(child(tc, 'a:txBody'), {
        overrides: {
          ...(textStyle.bold !== undefined ? { b: textStyle.bold } : {}),
          ...(textStyle.italic !== undefined ? { i: textStyle.italic } : {}),
          ...(textStyle.color ? { color: textStyle.color } : {})
        }
      });
      const marL = num(tcPr, 'marL') ?? 91440;
      const marR = num(tcPr, 'marR') ?? 91440;
      const marT = num(tcPr, 'marT') ?? 45720;
      const marB = num(tcPr, 'marB') ?? 45720;
      const cell = {
        ...fields,
        verticalAlign: ANCHOR[attr(tcPr, 'anchor')] || 'top',
        padding: [marT, marR, marB, marL].map((v) => Math.round(emuToPx(v) * 10) / 10),
        background,
        borders
      };
      const gridSpan = num(tc, 'gridSpan');
      const rowSpan = num(tc, 'rowSpan');
      if (gridSpan > 1) cell.colspan = gridSpan;
      if (rowSpan > 1) cell.rowspan = rowSpan;
      if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') cell.covered = true;
      cells.push(cell);
    });
    rows.push({ height: emuToPx(num(tr, 'h') || 0), cells });
  });

  // Rows grow to fit their text in PowerPoint; the stored heights are
  // minimums. Renderers lay the table out from these and let rows grow.
  const height = Math.max(box.height, rows.reduce((s, r) => s + r.height, 0));
  return {
    type: 'table',
    x: box.x,
    y: box.y,
    width: Math.max(box.width, Math.round(columns.reduce((s, w) => s + w, 0))),
    height: Math.round(height),
    fontSize: 16,
    text: rows.map((row) => row.cells.filter((c) => !c.covered).map((c) => c.text).join('\t')).join('\n'),
    table: { columns: columns.map((w) => Math.round(w * 10) / 10), rows }
  };
}
