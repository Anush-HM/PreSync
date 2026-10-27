import { describe, expect, it } from 'vitest';
import { indentLines, linesInSelection, listKindOf, parseListLine, toggleList } from './textOps.js';
import { LIST_PREFIX } from './slideFormat.js';

const N = ' ';

describe('textOps lists', () => {
  it('turns paragraphs into a bulleted list the renderers hang', () => {
    const { text } = toggleList('Alpha\nBeta', null, 'bullet');
    expect(text).toBe(`•${N}Alpha\n•${N}Beta`);
    expect(LIST_PREFIX.test(text.split('\n')[1])).toBe(true);
    expect(listKindOf(text)).toBe('bullet');
  });

  it('numbers paragraphs and removes the list again', () => {
    const numbered = toggleList('One\nTwo\nThree', null, 'number');
    expect(numbered.text.split('\n').map((l) => parseListLine(l).marker)).toEqual(['1.', '2.', '3.']);
    expect(toggleList(numbered.text, null, 'number').text).toBe('One\nTwo\nThree');
  });

  it('switches a bulleted list to numbers', () => {
    const { text } = toggleList(`•${N}A\n•${N}B`, null, 'number');
    expect(text).toBe(`1.${N}A\n2.${N}B`);
  });

  it('keeps style ranges on the same words', () => {
    // "Beta" is bold: characters 5–9 of "AlphaBeta" (line breaks not counted).
    const { text, styles } = toggleList('Alpha\nBeta', [{ start: 5, end: 9, style: { fontWeight: 'bold' } }], 'bullet');
    const flat = Array.from(text.replace(/\n/g, ''));
    expect(flat.slice(styles[0].start, styles[0].end).join('')).toBe('Beta');
  });

  it('indents a line into a sub-level with its own numbering', () => {
    const start = toggleList('One\nTwo\nThree', null, 'number').text;
    const { text } = indentLines(start, null, 1, [1]);
    const lines = text.split('\n').map(parseListLine);
    expect(lines.map((l) => [l.indent, l.marker])).toEqual([[0, '1.'], [1, 'a.'], [0, '2.']]);
    expect(indentLines(text, null, -1, [1]).text).toBe(start);
  });

  it('only touches the selected paragraphs', () => {
    expect(linesInSelection('ab\ncd\nef', 4, 5)).toEqual([1]);
    expect(toggleList('ab\ncd\nef', null, 'bullet', [1]).text).toBe(`ab\n•${N}cd\nef`);
  });
});
