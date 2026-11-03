import { useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { AlignCenter, AlignLeft, AlignRight, AlignVerticalSpaceAround, Move, TextWrap } from 'lucide-react';
import { keepCanvasFocus, PALETTE } from '../editor/palette.js';
import ShapeGlyph from './ShapeGlyph.jsx';

const MIN_WIDTH = 32;
const DRAG_START = 4; // px of travel before a press becomes a move
const ALIGNS = [
  { id: 'left', label: 'Align left', icon: AlignLeft },
  { id: 'center', label: 'Align centre', icon: AlignCenter },
  { id: 'right', label: 'Align right', icon: AlignRight }
];
const WRAP_OPTIONS = [
  { id: 'inline', label: 'In line with text', icon: AlignVerticalSpaceAround },
  { id: 'square', label: 'Wrap text around', icon: TextWrap },
  { id: 'front', label: 'Free: drag anywhere, arrow keys nudge', icon: Move }
];
const SHAPE_COLORS = PALETTE.filter((_, i) => i % 7 === 1 || i % 7 === 2);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The text column the figure sits in, and how far past it a free
// picture may go: up to the edges of the page.
function columnOf(el) {
  const prose = el.closest('.doc-prose') || el.parentElement;
  const rect = prose.getBoundingClientRect();
  const sheet = el.closest('.doc-sheets')?.getBoundingClientRect();
  return {
    rect,
    marginLeft: sheet ? Math.max(0, rect.left - sheet.left) : 0,
    marginRight: sheet ? Math.max(0, sheet.right - rect.right) : 0
  };
}

// Where a moved figure lands: before or after the top-level block under
// the pointer, whichever edge is nearer.
function dropPosition(view, x, y, from, to) {
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return null;
  const $pos = view.state.doc.resolve(hit.pos);
  if ($pos.depth === 0) return hit.pos;
  const before = $pos.before(1);
  const after = $pos.after(1);
  const dom = view.nodeDOM(before);
  let pos = after;
  if (dom instanceof Element) {
    const r = dom.getBoundingClientRect();
    if (y < r.top + r.height / 2) pos = before;
  }
  // Dropping onto itself, or right next to itself, is no move.
  if (pos >= from && pos <= to) return null;
  return pos;
}

// Image or shape in the document. Drag the corner to resize, keeping
// proportions; the bar above sets alignment and, for pictures, how text
// flows around them. Pictures can be dragged: in line or wrapped, to a
// new place in the text (the side they are dropped on sets their
// alignment); placed freely, to any spot on the page.
function Figure({ node, updateAttributes, selected, label, naturalRatio, tools, children, editor, getPos, movable = false }) {
  const { width, height, align, wrap, offsetX, offsetY } = node.attrs;
  const mode = movable ? wrap || 'inline' : 'inline';
  const ratio = width > 0 && height > 0 ? height / width : naturalRatio || 1;
  const boxRef = useRef(null);
  const [drag, setDrag] = useState(null); // { dx, dy } while moving

  function startResize(e) {
    e.preventDefault();
    e.stopPropagation();
    const figure = e.currentTarget.parentElement;
    const startX = e.clientX;
    const startWidth = figure.getBoundingClientRect().width;
    const room = mode === 'front' ? columnOf(figure).rect.width : figure.closest('.doc-figure')?.getBoundingClientRect().width || startWidth;
    const dir = mode === 'front' ? 1 : align === 'right' ? -1 : align === 'center' && mode === 'inline' ? 2 : 1;
    const onMove = (ev) => {
      const next = Math.round(Math.max(MIN_WIDTH, Math.min(room, startWidth + dir * (ev.clientX - startX))));
      updateAttributes({ width: next, height: Math.round(next * ratio) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function select() {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos === null || pos === undefined || !editor) return;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  }

  function startMove(e) {
    if (!movable || !editor?.isEditable || e.button !== 0) return;
    if (e.target.closest('button, .doc-figure-handle')) return;
    e.preventDefault();
    select();
    const startX = e.clientX;
    const startY = e.clientY;
    const box = boxRef.current;
    const boxRect = box.getBoundingClientRect();
    let moved = false;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < DRAG_START) return;
      moved = true;
      setDrag({ dx, dy });
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDrag(null);
      if (!moved || ev.type === 'pointercancel') return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (mode === 'front') {
        const { rect, marginLeft, marginRight } = columnOf(box);
        const w = boxRect.width;
        const x = clamp(Math.round((offsetX || 0) + dx), -marginLeft, Math.max(-marginLeft, rect.width + marginRight - w));
        updateAttributes({ offsetX: x, offsetY: Math.round((offsetY || 0) + dy) });
        return;
      }
      placeInText(boxRect.left + dx + boxRect.width / 2, ev.clientX, ev.clientY);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // Moves the picture to where it was dropped in the text, aligned to the
  // side of the column it was dropped on.
  function placeInText(centerX, x, y) {
    const { view } = editor;
    const from = getPos();
    const to = from + node.nodeSize;
    const { rect } = columnOf(boxRef.current);
    const third = (centerX - rect.left) / rect.width;
    const side = mode === 'square' ? (third < 0.5 ? 'left' : 'right') : third < 1 / 3 ? 'left' : third > 2 / 3 ? 'right' : 'center';
    // The dragged picture is under the pointer: look through it.
    const box = boxRef.current;
    box.style.pointerEvents = 'none';
    const target = dropPosition(view, x, y, from, to);
    box.style.pointerEvents = '';
    const attrs = { ...node.attrs, align: side };
    if (target === null) {
      if (side !== (align || 'left')) updateAttributes({ align: side });
      return;
    }
    const tr = view.state.tr.delete(from, to);
    const at = tr.mapping.map(target);
    tr.insert(at, node.type.create(attrs));
    if (tr.doc.nodeAt(at)?.type === node.type) tr.setSelection(NodeSelection.create(tr.doc, at));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  function setWrap(next) {
    if (next === mode) return;
    if (next === 'front') {
      // Start where the picture is now, so switching doesn't move it.
      const box = boxRef.current;
      const { rect } = columnOf(box);
      const r = box.getBoundingClientRect();
      updateAttributes({ wrap: 'front', offsetX: Math.round(r.left - rect.left), offsetY: 0 });
    } else {
      updateAttributes({ wrap: next === 'inline' ? null : next, offsetX: null, offsetY: null, align: next === 'square' && align === 'center' ? 'left' : align });
    }
  }

  const aligns = mode === 'square' ? ALIGNS.filter((a) => a.id !== 'center') : ALIGNS;
  const boxStyle = { width: width ? `${width}px` : undefined };
  if (mode === 'front') {
    boxStyle.left = `${(offsetX || 0) + (drag?.dx || 0)}px`;
    boxStyle.top = `${(offsetY || 0) + (drag?.dy || 0)}px`;
  } else if (drag) {
    boxStyle.transform = `translate(${drag.dx}px, ${drag.dy}px)`;
  }
  const classes = ['doc-figure', `is-${mode === 'front' ? 'left' : align || 'left'}`, `wrap-${mode}`];
  if (selected) classes.push('is-selected');
  if (drag) classes.push('is-moving');
  if (movable) classes.push('is-movable');

  return (
    <NodeViewWrapper className={classes.join(' ')}>
      <div className="doc-figure-box" ref={boxRef} style={boxStyle} onPointerDown={startMove}>
        {selected && !drag && (
          <div className="doc-figure-tools" role="group" aria-label={`${label} options`} contentEditable={false} onMouseDown={keepCanvasFocus}>
            {mode !== 'front' && aligns.map((a) => {
              const Icon = a.icon;
              return (
                <button key={a.id} type="button" className="icon-btn icon-btn-sm" aria-label={a.label} title={a.label} aria-pressed={(align || 'left') === a.id} onClick={() => updateAttributes({ align: a.id })}>
                  <Icon />
                </button>
              );
            })}
            {movable && (
              <>
                {mode !== 'front' && <span className="doc-figure-sep" aria-hidden="true" />}
                {WRAP_OPTIONS.map((o) => {
                  const Icon = o.icon;
                  return (
                    <button key={o.id} type="button" className="icon-btn icon-btn-sm" aria-label={o.label} title={o.label} aria-pressed={mode === o.id} onClick={() => setWrap(o.id)}>
                      <Icon />
                    </button>
                  );
                })}
              </>
            )}
            {tools}
          </div>
        )}
        {children}
        {selected && <span className="doc-figure-handle" role="presentation" onPointerDown={startResize} />}
      </div>
    </NodeViewWrapper>
  );
}

export function ImageFigure(props) {
  const { src, alt } = props.node.attrs;
  return (
    <Figure {...props} label="Image" movable>
      <img src={src} alt={alt || ''} draggable={false} />
    </Figure>
  );
}

export function ShapeFigure(props) {
  const { shape, color, width, height } = props.node.attrs;
  const tools = SHAPE_COLORS.map((c) => (
    <button key={c} type="button" className="swatch is-square doc-figure-swatch" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => props.updateAttributes({ color: c })} />
  ));
  return (
    <Figure {...props} label="Shape" tools={tools}>
      <div style={{ height: height || 100, width: width || 160, maxWidth: '100%' }}><ShapeGlyph shape={shape} color={color} /></div>
    </Figure>
  );
}
