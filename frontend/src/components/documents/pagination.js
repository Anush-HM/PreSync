import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Splits one continuous editor into pages. The text stays a single
// ProseMirror document; spacer widgets push whatever would overflow a
// page down onto the next sheet, which PageSheets.jsx draws behind it.
//
// Each run takes the spacers out, measures the text as one column, then
// puts new spacers in, all within one task so nothing paints in between.
// Paragraphs break between lines, lists between items, and tables between
// rows; images, shapes and callouts move to the next page whole.

const key = new PluginKey('pagination');
const DELAY_MS = 80;
const SAFETY_STEPS = [6, 24, 60];
const NESTED = new Set(['bulletList', 'orderedList', 'listItem', 'blockquote']);

// Blocks in reading order. `anchor` is where a spacer goes to move the
// block: a first child moves with its parent, so a list marker never
// stays behind on the previous page.
export function layoutBlocks(doc) {
  const out = [];
  function walk(node, start, inherited) {
    node.forEach((child, offset, index) => {
      const pos = start + offset;
      const anchor = index === 0 && inherited !== null ? inherited : pos;
      if (NESTED.has(child.type.name)) walk(child, pos + 1, anchor);
      else if (child.type.name === 'table') {
        child.forEach((row, rowOffset, rowIndex) => {
          const rowPos = pos + 1 + rowOffset;
          out.push({ pos: rowPos, anchor: rowIndex === 0 ? anchor : rowPos, node: row, kind: rowIndex === 0 ? 'block' : 'row' });
        });
      } else out.push({ pos, anchor, node: child, kind: child.isTextblock ? 'text' : 'block' });
    });
  }
  walk(doc, 0, null);
  return out;
}

function spacerDom({ kind, height, target, columns }) {
  const inner = document.createElement(kind === 'inline' ? 'span' : 'div');
  inner.className = 'doc-page-spacer';
  inner.style.height = `${height}px`;
  inner.contentEditable = 'false';
  inner.dataset.target = target;
  if (kind !== 'row') return inner;
  const row = document.createElement('tr');
  row.className = 'doc-page-spacer-row';
  row.contentEditable = 'false';
  const cell = document.createElement('td');
  cell.colSpan = columns; // more than the table has would add empty columns
  cell.appendChild(inner);
  row.appendChild(cell);
  return row;
}

// Where a paragraph's first line past `limit` starts, null if that is its
// first line, or undefined if every line fits (its box can be taller than
// its text). Positions run down the page, so bisection finds it.
function firstLineBeyond(view, pos, node, from, limit, origin) {
  let lo = Math.max(from, pos + 1);
  let hi = pos + node.nodeSize - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (view.coordsAtPos(mid, 1).bottom - origin > limit) hi = mid;
    else lo = mid + 1;
  }
  if (view.coordsAtPos(lo, 1).bottom - origin <= limit) return undefined;
  return lo <= pos + 1 ? null : lo;
}

// The spacers a document needs, and how many pages it fills.
export function measureBreaks(view, { pageHeight, gap, marginTop, marginBottom, safety = 0 }) {
  const origin = view.dom.getBoundingClientRect().top;
  const pitch = pageHeight + gap;
  const contentHeight = pageHeight - marginTop - marginBottom - safety;
  const breaks = [];
  let page = 0;
  let shift = 0; // how far everything so far has been pushed down
  let forced = false;

  const pageEnd = () => page * pitch + contentHeight;
  const breakAt = (pos, kind, top, columns = 1) => {
    const target = (page + 1) * pitch;
    breaks.push({ pos, kind, height: Math.max(0, target - (top + shift)), target, columns });
    shift = target - top;
    page += 1;
  };

  for (const block of layoutBlocks(view.state.doc)) {
    const dom = view.nodeDOM(block.pos);
    if (!(dom instanceof Element)) continue;
    const rect = dom.getBoundingClientRect();
    const top = rect.top - origin;
    const bottom = rect.bottom - origin;
    const moveWhole = () => {
      if (block.kind !== 'row') breakAt(block.anchor, 'block', top);
      else {
        let columns = 0;
        block.node.forEach((cell) => { columns += cell.attrs.colspan || 1; });
        breakAt(block.anchor, 'row', top, columns);
      }
    };

    if (forced) {
      moveWhole();
      forced = false;
    }
    if (block.kind === 'text') {
      let from = block.pos + 1;
      while (bottom + shift > pageEnd()) {
        const pos = firstLineBeyond(view, block.pos, block.node, from, pageEnd() - shift, origin);
        if (pos === undefined) break;
        if (pos === null || pos <= from) {
          if (pos === null && from === block.pos + 1) breakAt(block.anchor, 'block', top);
          break;
        }
        breakAt(pos, 'inline', view.coordsAtPos(pos, 1).top - origin);
        from = pos + 1;
      }
    } else if (bottom + shift > pageEnd()) moveWhole();
    // Something taller than a page runs over; the next block starts after it.
    while (bottom + shift > pageEnd()) page += 1;
    if (block.node.type.name === 'pageBreak') forced = true;
  }
  return { breaks, pages: page + 1 };
}

const TAB_GRID = 48; // Word's default stops, every half inch

// CSS has only evenly spaced tab stops, so tabs in a paragraph with Word
// stops are sized one by one: each is set to reach its stop, measured
// from the text around it. Stops count from the column's left edge.
function tabDecorations(view) {
  const out = [];
  view.state.doc.descendants((node, pos) => {
    const stops = node.attrs?.tabStops;
    if (!node.isTextblock) return true;
    if (!stops?.length || !node.textContent.includes('\t')) return false;
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof Element)) return false;
    const left = dom.getBoundingClientRect().left - parseFloat(getComputedStyle(dom).marginLeft || 0);
    const tabs = [];
    node.descendants((child, offset) => {
      if (!child.isText) return;
      [...child.text].forEach((ch, i) => { if (ch === '\t') tabs.push(pos + 1 + offset + i); });
    });
    const end = pos + node.nodeSize - 1;
    let x = null;
    let lineTop = null;
    tabs.forEach((tab, i) => {
      const at = view.coordsAtPos(tab, 1);
      if (x === null || Math.abs(at.top - lineTop) > 2) x = at.left - left;
      lineTop = at.top;
      const after = view.coordsAtPos(tab + 1, -1);
      const nextEdge = view.coordsAtPos(tabs[i + 1] ?? end, -1);
      const text = Math.abs(nextEdge.top - after.top) > 2 ? 0 : Math.max(0, nextEdge.left - after.left);
      const stop = stops.find((t) => t.pos > x + 1);
      let width = stop ? stop.pos - x : (Math.floor(x / TAB_GRID) + 1) * TAB_GRID - x;
      // A pixel short of the stop: text ending on the margin would wrap.
      if (stop?.type === 'right' || stop?.type === 'end' || stop?.type === 'decimal') width -= text + 1;
      else if (stop?.type === 'center') width -= text / 2;
      width = Math.max(1, width);
      const leader = stop?.leader && stop.leader !== 'none' ? ' has-leader' : '';
      out.push(Decoration.inline(tab, tab + 1, { class: `doc-tab${leader}`, style: `width: ${width}px` }));
      x += width + text;
    });
    return false;
  });
  return out;
}

function decorations(doc, tabs, breaks) {
  return DecorationSet.create(doc, [
    ...tabs,
    ...breaks.map((b, i) => Decoration.widget(b.pos, () => spacerDom(b), { side: -1, ignoreSelection: true, key: `page-${i}-${b.height}` }))
  ]);
}

// Margins between blocks collapse differently around a spacer, so each is
// trimmed to land exactly on its page. Going in order, one fix carries on.
function settle(view) {
  const origin = view.dom.getBoundingClientRect().top;
  for (const spacer of view.dom.querySelectorAll('.doc-page-spacer')) {
    const outer = spacer.closest('.doc-page-spacer-row') || spacer;
    const next = outer.nextElementSibling;
    const edge = (next?.getBoundingClientRect().top ?? spacer.getBoundingClientRect().bottom) - origin;
    const off = Number(spacer.dataset.target) - edge;
    if (Math.abs(off) > 0.25) spacer.style.height = `${Math.max(0, spacer.getBoundingClientRect().height + off)}px`;
  }
}

// Whether any line of text runs past the end of its page, as laid out.
function overflows(view, { pageHeight, gap, marginTop, marginBottom }) {
  const origin = view.dom.getBoundingClientRect().top;
  const pitch = pageHeight + gap;
  const contentHeight = pageHeight - marginTop - marginBottom;
  const walker = document.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  while (walker.nextNode()) {
    range.selectNodeContents(walker.currentNode);
    for (const rect of range.getClientRects()) {
      const top = rect.top - origin;
      if (rect.bottom - origin > Math.floor(top / pitch) * pitch + contentHeight + 1) return true;
    }
  }
  return false;
}

// Older tables can be wider than the page. Columns keep their proportions.
function fitTables(view) {
  for (const table of view.dom.querySelectorAll('table')) {
    const cols = [...table.querySelectorAll('col')];
    const widths = cols.map((col) => (col.style.width.endsWith('px') ? parseFloat(col.style.width) : 0));
    const total = widths.reduce((sum, w) => sum + w, 0);
    if (widths.every(Boolean) && total > view.dom.clientWidth + 1) cols.forEach((col, i) => { col.style.width = `${(widths[i] / total) * 100}%`; });
  }
}

function run(view, storage) {
  if (!storage.geometry || view.composing) return;
  const scroller = view.dom.closest('.doc-scroll');
  const scrollTop = scroller?.scrollTop;
  let pages = 1;
  // Measured line boxes can differ a little from real ones, so check the
  // result and leave more room at the page bottom until nothing crosses it.
  for (const safety of SAFETY_STEPS) {
    view.dispatch(view.state.tr.setMeta(key, DecorationSet.empty).setMeta('addToHistory', false));
    fitTables(view);
    const tabs = tabDecorations(view);
    if (tabs.length) {
      view.dispatch(view.state.tr.setMeta(key, decorations(view.state.doc, tabs, [])).setMeta('addToHistory', false));
      fitTables(view);
    }
    const measured = measureBreaks(view, { ...storage.geometry, safety });
    view.dispatch(view.state.tr.setMeta(key, decorations(view.state.doc, tabs, measured.breaks)).setMeta('addToHistory', false));
    fitTables(view); // redrawing a table restores its pixel widths
    settle(view);
    pages = measured.pages;
    if (!overflows(view, storage.geometry)) break;
  }
  if (scroller) scroller.scrollTop = scrollTop;
  storage.onPages?.(pages);
}

export const Pagination = Extension.create({
  name: 'pagination',
  addStorage() {
    return { geometry: null, onPages: null, repaginate: null };
  },
  addProseMirrorPlugins() {
    const { storage } = this;
    return [
      new Plugin({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => tr.getMeta(key) ?? set.map(tr.mapping, tr.doc)
        },
        props: { decorations: (state) => key.getState(state) },
        view(view) {
          let timer = null;
          const schedule = () => {
            clearTimeout(timer);
            timer = setTimeout(() => run(view, storage), DELAY_MS);
          };
          storage.repaginate = schedule;
          // Images and web fonts change heights after they load.
          view.dom.addEventListener('load', schedule, true);
          document.fonts?.ready?.then(schedule);
          document.fonts?.addEventListener?.('loadingdone', schedule);
          return {
            update(_, prev) {
              if (prev.doc !== view.state.doc) schedule();
            },
            destroy() {
              clearTimeout(timer);
              storage.repaginate = null;
              view.dom.removeEventListener('load', schedule, true);
              document.fonts?.removeEventListener?.('loadingdone', schedule);
            }
          };
        }
      })
    ];
  }
});
