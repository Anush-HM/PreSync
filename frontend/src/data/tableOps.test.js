import { describe, expect, it } from 'vitest';
import {
  applyTableStyle, deleteColumn, deleteRow, formatCells, insertColumn, insertRow, makeTable,
  mergeCells, ownerOf, pasteGrid, setBorders, splitCell, stepCell, tableSize, tableText
} from './tableOps.js';

const texts = (t) => t.rows.map((row) => row.cells.map((c) => (c.covered ? '·' : c.text)));

function filled(rows, cols) {
  let t = makeTable(rows, cols, { width: cols * 100 });
  t = pasteGrid(t, 0, 0, Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `${r}${c}`).join('\t')).join('\n'));
  return t;
}

describe('tableOps', () => {
  it('makes a styled table with a header row', () => {
    const t = makeTable(3, 2, { width: 400 });
    expect(t.columns).toEqual([200, 200]);
    expect(t.rows[0].cells[0]).toMatchObject({ fontWeight: 'bold', background: '#2e5e4e', fill: '#ffffff' });
    expect(t.rows[1].cells[0].fontWeight).toBeUndefined();
    expect(t.rows[1].cells[0].background).not.toBe(t.rows[2].cells[0].background);
  });

  it('adds and removes rows and columns', () => {
    let t = filled(2, 2);
    t = insertRow(t, 1);
    expect(texts(t)).toEqual([['00', '01'], ['', ''], ['10', '11']]);
    t = insertColumn(t, 0);
    expect(texts(t)[0]).toEqual(['', '00', '01']);
    expect(tableSize(t).width).toBeCloseTo(200, 0);
    t = deleteRow(deleteColumn(t, 0), 1);
    expect(texts(t)).toEqual([['00', '01'], ['10', '11']]);
  });

  it('merges and splits cells, keeping the text', () => {
    let t = filled(3, 3);
    t = mergeCells(t, { r: 0, c: 0 }, { r: 1, c: 1 });
    expect(t.rows[0].cells[0]).toMatchObject({ rowspan: 2, colspan: 2, text: '00\n01\n10\n11' });
    expect(texts(t)[1]).toEqual(['·', '·', '12']);
    expect(ownerOf(t, 1, 1)).toEqual({ r: 0, c: 0 });
    t = splitCell(t, 1, 1);
    expect(texts(t)[1]).toEqual(['', '', '12']);
  });

  it('grows and shrinks merged cells when rows and columns change around them', () => {
    let t = mergeCells(filled(3, 2), { r: 0, c: 0 }, { r: 2, c: 0 });
    t = insertRow(t, 1);
    expect(t.rows[0].cells[0].rowspan).toBe(4);
    expect(t.rows[1].cells[0].covered).toBe(true);
    t = deleteRow(t, 0);
    // The merged cell's content moves to the next row.
    expect(t.rows[0].cells[0]).toMatchObject({ rowspan: 3, text: '00\n10\n20' });
    t = deleteColumn(t, 0);
    expect(texts(t)).toEqual([[''], ['11'], ['21']]);
  });

  it('formats and borders a selection, and restyles without losing text', () => {
    let t = filled(2, 2);
    t = formatCells(t, { r: 0, c: 0 }, { r: 1, c: 0 }, { background: '#ff0000', textAlign: 'center' });
    expect(t.rows[1].cells[0]).toMatchObject({ background: '#ff0000', textAlign: 'center' });
    expect(t.rows[1].cells[1].background).not.toBe('#ff0000');
    t = setBorders(t, { r: 0, c: 0 }, { r: 1, c: 1 }, { color: '#000000', width: 2, sides: 'outer' });
    expect(t.rows[0].cells[0].borders.top).toEqual({ color: '#000000', width: 2 });
    expect(t.rows[0].cells[0].borders.right).not.toEqual({ color: '#000000', width: 2 });
    t = applyTableStyle(t, 'crimson');
    expect(t.rows[0].cells[0].background).toBe('#8f2632');
    expect(tableText(t)).toBe('00\t01\n10\t11');
  });

  it('pastes spreadsheet data, growing the table', () => {
    const t = pasteGrid(makeTable(1, 1), 0, 0, 'a\tb\tc\n1\t2\t3\n');
    expect(texts(t)).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('moves between cells with the keyboard, skipping merged ones', () => {
    const t = mergeCells(filled(2, 3), { r: 0, c: 0 }, { r: 0, c: 1 });
    expect(stepCell(t, 0, 0, 'next')).toEqual({ r: 0, c: 2 });
    expect(stepCell(t, 0, 2, 'next')).toEqual({ r: 1, c: 0 });
    expect(stepCell(t, 1, 0, 'prev')).toEqual({ r: 0, c: 2 });
    expect(stepCell(t, 1, 1, 'up')).toEqual({ r: 0, c: 0 });
  });
});
