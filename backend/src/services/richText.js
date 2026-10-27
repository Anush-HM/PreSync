// Turns styled runs into the editor's text block shape: plain `text`,
// block-level formatting taken from the most common style, and `styles`:
// the ranges that differ from the block, in Fabric.js's serialised form
// ([{ start, end, style }], indices counting characters but not line
// breaks — what fabric.util.stylesFromArray reads).
//
// Used by every importer so mixed formatting inside one text box — a
// bold label followed by normal text, a larger first line — survives.

export const STYLE_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'underline', 'linethrough', 'fill'];

// What a character without that property renders as.
const IMPLICIT = { fontWeight: 'normal', fontStyle: 'normal', underline: false, linethrough: false };

function norm(key, value) {
  if (value === undefined || value === null) return IMPLICIT[key];
  return value;
}

// paragraphs: [{ runs: [{ text, style }] }] where style holds any of
// STYLE_KEYS. Paragraphs are joined with "\n"; a run may contain "\n"
// for a soft line break.
export function buildRichText(paragraphs) {
  const chars = []; // { line, index, ch, style }
  let line = 0;
  let index = 0;
  paragraphs.forEach((p, pi) => {
    if (pi > 0) {
      line += 1;
      index = 0;
    }
    for (const run of p.runs) {
      for (const ch of Array.from(run.text)) {
        if (ch === '\n') {
          line += 1;
          index = 0;
          continue;
        }
        chars.push({ line, index, ch, style: run.style || {} });
        index += 1;
      }
    }
  });

  const lines = Array.from({ length: line + 1 }, () => []);
  for (const c of chars) lines[c.line].push(c.ch);
  const text = lines.map((l) => l.join('')).join('\n');

  // Block style: the value most characters carry (spaces count less, so
  // a bold label's trailing space doesn't tip the balance).
  const base = {};
  for (const key of STYLE_KEYS) {
    const counts = new Map();
    for (const c of chars) {
      const v = norm(key, c.style[key]);
      if (v === undefined) continue;
      const weight = /\s/.test(c.ch) ? 0.25 : 1;
      counts.set(v, (counts.get(v) || 0) + weight);
    }
    let best;
    let bestCount = -1;
    for (const [v, n] of counts) {
      if (n > bestCount) {
        best = v;
        bestCount = n;
      }
    }
    if (best !== undefined && best !== IMPLICIT[key]) base[key] = best;
  }

  const styles = [];
  let open = null;
  chars.forEach((c, i) => {
    const diff = {};
    for (const key of STYLE_KEYS) {
      const v = norm(key, c.style[key]);
      const b = norm(key, base[key]);
      if (v !== undefined && v !== b) diff[key] = v;
    }
    const sig = JSON.stringify(diff);
    if (sig === '{}') {
      open = null;
      return;
    }
    if (open && open.sig === sig && open.range.end === i) open.range.end = i + 1;
    else {
      open = { sig, range: { start: i, end: i + 1, style: diff } };
      styles.push(open.range);
    }
  });

  return { text, base, styles: styles.length ? styles : null };
}
