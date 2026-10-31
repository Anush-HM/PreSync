import { NodeViewWrapper } from '@tiptap/react';
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import { keepCanvasFocus, PALETTE } from '../editor/palette.js';
import ShapeGlyph from './ShapeGlyph.jsx';

const MIN_WIDTH = 32;
const ALIGNS = [
  { id: 'left', label: 'Align left', icon: AlignLeft },
  { id: 'center', label: 'Align centre', icon: AlignCenter },
  { id: 'right', label: 'Align right', icon: AlignRight }
];
const SHAPE_COLORS = PALETTE.filter((_, i) => i % 7 === 1 || i % 7 === 2);

// Picture or shape in the document: drag the corner to resize, keeping
// proportions; the bar above sets alignment.
function Figure({ node, updateAttributes, selected, label, naturalRatio, tools, children }) {
  const { width, height, align } = node.attrs;
  const ratio = width > 0 && height > 0 ? height / width : naturalRatio || 1;

  function startResize(e) {
    e.preventDefault();
    e.stopPropagation();
    const figure = e.currentTarget.parentElement;
    const startX = e.clientX;
    const startWidth = figure.getBoundingClientRect().width;
    const room = figure.closest('.doc-figure')?.getBoundingClientRect().width || startWidth;
    const dir = align === 'right' ? -1 : align === 'center' ? 2 : 1;
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

  return (
    <NodeViewWrapper className={`doc-figure is-${align || 'left'}${selected ? ' is-selected' : ''}`}>
      <div className="doc-figure-box" style={{ width: width ? `${width}px` : undefined }}>
        {selected && (
          <div className="doc-figure-tools" role="group" aria-label={`${label} options`} contentEditable={false} onMouseDown={keepCanvasFocus}>
            {ALIGNS.map((a) => {
              const Icon = a.icon;
              return (
                <button key={a.id} type="button" className="icon-btn icon-btn-sm" aria-label={a.label} aria-pressed={(align || 'left') === a.id} onClick={() => updateAttributes({ align: a.id })}>
                  <Icon />
                </button>
              );
            })}
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
    <Figure {...props} label="Picture">
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
