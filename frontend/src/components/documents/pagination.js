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

// Where a paragraph's first line past `limit` starts, or null if that is
// its first line. Positions run down the page, so bisection finds it.
function firstLineBeyond(view, pos, node, from, limit, origin) {
  let lo = Math.max(from, pos + 1);
  let hi = pos + node.nodeSize - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (view.coordsAtPos(mid, 1).bottom - origin > limit) hi = mid;
    else lo = mid + 1;
  }
  return lo <= pos + 1 ? null : lo;
}

// The spacers a document needs, and how many pages it fills.
export function measureBreaks(view, { pageHeight, gap, marginTop, marginBottom }) {
  const origin = view.dom.getBoundingClientRect().top;
  const pitch = pageHeight + gap;
  const contentHeight = pageHeight - marginTop - marginBottom;
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

function decorations(doc, breaks) {
  return DecorationSet.create(doc, breaks.map((b, i) =>
    Decoration.widget(b.pos, () => spacerDom(b), { side: -1, ignoreSelection: true, key: `page-${i}-${b.height}` })));
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

function run(view, storage) {
  if (!storage.geometry || view.composing) return;
  const scroller = view.dom.closest('.doc-scroll');
  const scrollTop = scroller?.scrollTop;
  view.dispatch(view.state.tr.setMeta(key, DecorationSet.empty).setMeta('addToHistory', false));
  const { breaks, pages } = measureBreaks(view, storage.geometry);
  view.dispatch(view.state.tr.setMeta(key, decorations(view.state.doc, breaks)).setMeta('addToHistory', false));
  settle(view);
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
