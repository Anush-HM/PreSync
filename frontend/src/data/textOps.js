import { LIST_PREFIX } from './slideFormat.js';

// Paragraph-level edits on a text block's `text` + `styles` (style
// ranges count characters but not line breaks, Fabric's format). Lists
// follow the import convention the renderers understand: optional
// non-breaking-space indent, a marker, then non-breaking spaces, so
// wrapped lines hang under the text.

const NBSP = '\u00a0';
const INDENT = NBSP.repeat(4);
export const BULLET_MARKERS = ['•', '◦', '▪'];
export const MAX_LIST_LEVEL = 4;

// Splits a paragraph into its list prefix (indent + marker + gap) and body.
export function parseListLine(line) {
  const m = LIST_PREFIX.exec(line);
  if (!m) {
    const indent = /^\u00a0*/.exec(line)[0];
    return { indent: Math.floor(indent.length / 4), kind: null, prefixLength: 0, body: line };
  }
  const prefix = m[0];
  const indent = /^\u00a0*/.exec(prefix)[0].length;
  const marker = prefix.slice(indent).replace(/\u00a0+$/, '');
  const kind = /^\(?[\dA-Za-z]+[.)]$/.test(marker) ? 'number' : 'bullet';
  return { indent: Math.floor(indent / 4), kind, marker, prefixLength: Array.from(prefix).length, body: line.slice(prefix.length) };
}

function markerFor(kind, level, n) {
  if (kind === 'bullet') return `${BULLET_MARKERS[level % BULLET_MARKERS.length]}${NBSP}`;
  if (level % 3 === 1) return `${String.fromCharCode(96 + ((n - 1) % 26) + 1)}.${NBSP}`;
  if (level % 3 === 2) return `${['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][(n - 1) % 10]}.${NBSP}`;
  return `${n}.${NBSP}`;
}

// Rewrites each paragraph's leading characters: `edit(info, i)` returns
// the new prefix for paragraph i (info from parseListLine). Style ranges
// shift with the text so formatting stays on the same words.
function rewritePrefixes(text, styles, edit, lines = null) {
  const paras = String(text || '').split('\n');
  const which = lines ? new Set(lines) : null;
  const shifts = []; // [{ at, remove, insert }] in character indices (no line breaks)
  let index = 0;
  const out = paras.map((line, i) => {
    const info = parseListLine(line);
    const len = Array.from(line).length;
    if (which && !which.has(i)) {
      index += len;
      return line;
    }
    const oldPrefix = Array.from(line).slice(0, info.prefixLength || Array.from(/^\u00a0*/.exec(line)[0]).length).join('');
    const nextPrefix = edit(info, i);
    if (nextPrefix === null) {
      index += len;
      return line;
    }
    const oldLen = Array.from(oldPrefix).length;
    shifts.push({ at: index, remove: oldLen, insert: Array.from(nextPrefix).length });
    index += len;
    return nextPrefix + Array.from(line).slice(oldLen).join('');
  });
  const map = (pos, isEnd) => {
    let delta = 0;
    for (const s of shifts) {
      if (pos < s.at || (isEnd && pos === s.at)) break;
      if (pos <= s.at + s.remove) {
        // Inside the old prefix: snap to the start of the body.
        return s.at + delta + s.insert;
      }
      delta += s.insert - s.remove;
    }
    return pos + delta;
  };
  const nextStyles = Array.isArray(styles)
    ? styles.map((r) => ({ ...r, start: map(r.start, false), end: map(r.end, true) })).filter((r) => r.end > r.start)
    : styles;
  return { text: out.join('\n'), styles: nextStyles?.length ? nextStyles : null };
}

// The list kind every chosen paragraph shares, or null.
export function listKindOf(text, lines = null) {
  const paras = String(text || '').split('\n');
  const chosen = (lines || paras.map((_, i) => i)).map((i) => paras[i]).filter((l) => l !== undefined && l.trim());
  if (!chosen.length) return null;
  const kinds = new Set(chosen.map((l) => parseListLine(l).kind));
  return kinds.size === 1 ? [...kinds][0] : null;
}

// Turns paragraphs into a bulleted or numbered list, or back to plain
// paragraphs when they already are that kind of list.
export function toggleList(text, styles, kind, lines = null) {
  const off = listKindOf(text, lines) === kind;
  const counters = [];
  return rewritePrefixes(text, styles, (info, i) => {
    const body = String(text).split('\n')[i];
    if (!body.trim()) return null;
    if (off) return INDENT.repeat(info.indent);
    const level = info.indent;
    counters.length = level + 1;
    counters[level] = (counters[level] || 0) + 1;
    return INDENT.repeat(level) + markerFor(kind, level, counters[level]);
  }, lines);
}

// Indents or outdents paragraphs by one level, renumbering lists.
export function indentLines(text, styles, delta, lines = null) {
  const paras = String(text || '').split('\n');
  const levels = paras.map((l) => parseListLine(l));
  const which = lines ? new Set(lines) : null;
  const counters = [];
  return rewritePrefixes(text, styles, (info, i) => {
    const level = which && !which.has(i) ? info.indent : Math.max(0, Math.min(MAX_LIST_LEVEL, info.indent + delta));
    levels[i] = { ...info, indent: level };
    if (!info.kind) return INDENT.repeat(level);
    counters.length = level + 1;
    counters[level] = (counters[level] || 0) + 1;
    return INDENT.repeat(level) + markerFor(info.kind, level, counters[level]);
  });
}

// Paragraph indexes touched by a character selection (Fabric selection
// indices count line breaks).
export function linesInSelection(text, start, end) {
  const paras = String(text || '').split('\n');
  const out = [];
  let pos = 0;
  paras.forEach((p, i) => {
    const len = p.length;
    const pStart = pos;
    const pEnd = pos + len;
    if (end >= pStart && start <= pEnd) out.push(i);
    pos = pEnd + 1;
  });
  return out;
}

// Character formatting keys a format painter copies.
export const PAINT_KEYS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'underline', 'linethrough', 'fill',
  'textBackgroundColor', 'textAlign', 'lineHeight', 'paragraphSpacing', 'charSpacing'
];

export function formatOf(block) {
  const out = {};
  for (const k of PAINT_KEYS) if (block[k] !== undefined) out[k] = block[k];
  return out;
}

// The patch that makes a block look like `format`, clearing what the
// source didn't set.
export function paintPatch(format) {
  const patch = {};
  for (const k of PAINT_KEYS) patch[k] = format[k] ?? null;
  patch.styles = null;
  return patch;
}

export const CLEAR_FORMAT_PATCH = {
  fontWeight: null, fontStyle: null, underline: null, linethrough: null, fill: null, textBackgroundColor: null,
  charSpacing: null, styles: null
};
