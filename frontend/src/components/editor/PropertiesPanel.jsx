import { useEffect, useRef } from 'react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, BringToFront, ChevronDown, ChevronUp, Copy,
  Eye, EyeOff, ImagePlus, Italic, Lock, Minus, MousePointerClick, Plus, Ratio, SendToBack, Trash2, Underline, Unlock, X
} from 'lucide-react';
import TableEditor from './TableEditor.jsx';
import ChartEditor from './ChartEditor.jsx';
import LayoutThumb from './LayoutThumb.jsx';
import { ThemeChooser } from './ContextToolbar.jsx';
import { NumberField } from './controls.jsx';
import { PALETTE } from './palette.js';
import { LAYOUTS } from '../../data/layouts.js';
import { cropInsets, keepsAspect } from '../../data/imageOps.js';
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_SLIDE_BACKGROUND,
  DEFAULT_TEXT_COLOR,
  FONT_FAMILIES,
  fontOption,
  primaryFont,
  SLIDE_BACKGROUNDS,
  TEXT_ALIGNMENTS,
  TEXT_COLORS
} from '../../data/slideFormat.js';
import './editor.css';

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };
const LINE_HEIGHTS = [1, 1.16, 1.5, 2];
const SHAPE_FILLS = ['#ffffff', '#1a1a2e', '#1f3864', '#2e5e4e', '#c89b3c', '#e74c3c', '#f3f4f2'];

function isText(b) {
  return (b.type || 'textbox') === 'textbox';
}

// Keeps panel buttons from taking focus, so a text selection being
// edited on the canvas stays selected while it is formatted.
function keepCanvasFocus(e) {
  if (e.target.closest('button')) e.preventDefault();
}

const MIN_SIZE = 8;
const MAX_SIZE = 200;

function Swatches({ colors, value, onPick, label, square }) {
  return (
    <div className="swatches" role="group" aria-label={label}>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          className={`swatch${square ? ' is-square' : ''}`}
          style={{ background: c }}
          aria-label={`${label} ${c}`}
          aria-pressed={value?.toLowerCase() === c.toLowerCase()}
          onClick={() => onPick(c)}
        />
      ))}
      <label className="swatch swatch-custom" data-tip="Custom colour">
        <input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );
}

// Right zone: formatting for whatever is selected on the canvas, and the
// slide's own settings when nothing is.
function GeometrySection({ block, onGeometry, onBlockPatch }) {
  const isText = (block.type || 'textbox') === 'textbox';
  return (
    <section className="props-section" aria-label="Position and size">
      <h3 className="props-label">Position and size</h3>
      <div className="props-geo">
        <NumberField label="X" value={block.x} onCommit={(x) => onGeometry({ x })} />
        <NumberField label="Y" value={block.y} onCommit={(y) => onGeometry({ y })} />
        <NumberField label="W" value={block.width} min={4} max={4000} onCommit={(width) => onGeometry({ width })} />
        {!isText && block.type !== 'table' && <NumberField label="H" value={block.height} min={4} max={4000} onCommit={(height) => onGeometry({ height })} />}
        <NumberField label="↻" value={block.rotation || 0} min={-360} max={360} suffix="°" onCommit={(rotation) => onGeometry({ rotation: ((rotation % 360) + 360) % 360 || null })} />
      </div>
      {(block.type === 'image' || block.type === 'shape') && (
        <label className="check">
          <input type="checkbox" checked={keepsAspect(block)} onChange={(e) => onBlockPatch({ lockAspect: e.target.checked ? (block.type === 'image' ? null : true) : false })} />
          <Ratio aria-hidden="true" />Keep proportions when resizing
        </label>
      )}
    </section>
  );
}

function ImageSection({ block, onCrop, onBlockPatch, onReplaceImage, onResetAspect }) {
  const insets = cropInsets(block);
  const pct = (v) => Math.round(v * 100);
  const shadow = block.shadow;
  const cropSlider = (key, label) => (
    <label className="tb-range" key={key}>
      <span className="props-label">{label}</span>
      <input type="range" min={0} max={90} value={pct(insets[key])} aria-label={`Crop ${label.toLowerCase()}`} onChange={(e) => onCrop({ [key]: Number(e.target.value) / 100 })} />
      <span className="mono">{pct(insets[key])}%</span>
    </label>
  );
  return (
    <section className="props-section" aria-label="Image" data-section="image">
      <h3 className="props-label">Crop</h3>
      {cropSlider('left', 'Left')}
      {cropSlider('right', 'Right')}
      {cropSlider('top', 'Top')}
      {cropSlider('bottom', 'Bottom')}
      <div className="props-row">
        <button type="button" className="btn btn-ghost btn-sm" disabled={!block.crop} onClick={() => onCrop({ left: 0, right: 0, top: 0, bottom: 0 })}>Reset crop</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onResetAspect}>Original proportions</button>
      </div>
      <h3 className="props-label">Border</h3>
      <div className="props-row">
        <Swatches colors={PALETTE.slice(0, 7)} value={block.stroke} onPick={(c) => onBlockPatch({ stroke: c, strokeWidth: block.strokeWidth || 3 })} label="Image border" square />
      </div>
      <div className="props-row">
        <select className="select select-sm" aria-label="Border width" value={block.stroke ? block.strokeWidth || 3 : 0} onChange={(e) => {
          const w = Number(e.target.value);
          onBlockPatch(w ? { strokeWidth: w, stroke: block.stroke || '#171a19' } : { stroke: null, strokeWidth: null });
        }}>
          {[0, 1, 2, 3, 4, 6, 8, 12].map((w) => <option key={w} value={w}>{w ? `${w}px border` : 'No border'}</option>)}
        </select>
      </div>
      <h3 className="props-label">Shadow</h3>
      <div className="props-row">
        <select className="select select-sm" aria-label="Shadow" value={shadow ? (shadow.blur >= 24 ? 'soft' : shadow.blur >= 12 ? 'medium' : 'close') : 'none'} onChange={(e) => {
          const presets = { none: null, close: { color: '#000000', blur: 6, x: 0, y: 3, opacity: 0.35 }, medium: { color: '#000000', blur: 14, x: 0, y: 8, opacity: 0.3 }, soft: { color: '#000000', blur: 28, x: 0, y: 14, opacity: 0.25 } };
          onBlockPatch({ shadow: presets[e.target.value] });
        }}>
          <option value="none">No shadow</option>
          <option value="close">Close</option>
          <option value="medium">Medium</option>
          <option value="soft">Soft</option>
        </select>
      </div>
      <h3 className="props-label">Alt text</h3>
      <textarea
        key={block.id}
        className="textarea props-alt"
        rows={2}
        maxLength={1000}
        aria-label="Alt text"
        placeholder="Describe the picture for people using screen readers"
        defaultValue={block.alt || ''}
        onBlur={(e) => {
          const alt = e.target.value.trim();
          if (alt !== (block.alt || '')) onBlockPatch({ alt: alt || null });
        }}
      />
      <button type="button" className="btn btn-secondary btn-sm" onClick={onReplaceImage}><ImagePlus aria-hidden="true" />Replace picture…</button>
    </section>
  );
}

function SlideSection({ slide, slideIndex, onSlidePatch, onApplyLayout, onApplyTheme }) {
  return (
    <section className="props-section" aria-label="Slide">
      <label className="field-stack">
        <span className="props-label">Slide name</span>
        <input
          key={slide.id}
          className="input input-sm"
          maxLength={200}
          placeholder={`Slide ${slideIndex + 1} (uses its title)`}
          defaultValue={slide.name || ''}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name !== (slide.name || '')) onSlidePatch({ name: name || null });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </label>
      <button type="button" className="btn btn-ghost btn-sm" aria-pressed={!!slide.hidden} onClick={() => onSlidePatch({ hidden: slide.hidden ? null : true })}>
        {slide.hidden ? <><Eye aria-hidden="true" />Show slide when presenting</> : <><EyeOff aria-hidden="true" />Hide slide when presenting</>}
      </button>
      {slide.hidden && <p className="field-hint">Hidden slides stay in the deck but are skipped when presenting and left out of PDF exports.</p>}
      <h3 className="props-label">Layout</h3>
      <div className="layout-grid is-panel">
        {LAYOUTS.map((l) => (
          <button key={l.id} type="button" className="layout-card" aria-pressed={slide.layout === l.id} onClick={() => onApplyLayout(l.id)}>
            <LayoutThumb layout={l} />
            <span>{l.name}</span>
          </button>
        ))}
      </div>
      <h3 className="props-label">Theme</h3>
      <ThemeChooser current={slide.theme} onApply={onApplyTheme} />
    </section>
  );
}

function PropertiesPanel({
  slide, slideIndex, selectedBlocks, primary,
  onFormat, onToggle, onRestack, onDuplicate, onDelete, onBackground, onShapeStyle, onClose,
  onGeometry, onBlockPatch, onTableChange, onChartChange, onCrop, onReplaceImage, onResetAspect,
  onSlidePatch, onApplyLayout, onApplyTheme, onLock, focusSection
}) {
  const bodyRef = useRef(null);
  useEffect(() => {
    if (!focusSection) return;
    bodyRef.current?.querySelector(`[data-section="${focusSection.name}"]`)?.scrollIntoView?.({ block: 'start' });
  }, [focusSection]);
  const textCount = selectedBlocks.filter(isText).length;
  const shapes = selectedBlocks.filter((b) => b.type === 'shape');
  const table = selectedBlocks.length === 1 && selectedBlocks[0].type === 'table' ? selectedBlocks[0] : null;
  const chart = selectedBlocks.length === 1 && selectedBlocks[0].type === 'chart' ? selectedBlocks[0] : null;
  const image = selectedBlocks.length === 1 && selectedBlocks[0].type === 'image' ? selectedBlocks[0] : null;
  const locked = selectedBlocks.length > 0 && selectedBlocks.every((b) => b.locked);
  const hasText = textCount > 0;
  const single = selectedBlocks.length === 1;
  const kind = single ? selectedBlocks[0].type || 'textbox' : null;

  let heading = `Slide ${slideIndex + 1}`;
  if (selectedBlocks.length > 1) heading = `${selectedBlocks.length} elements`;
  else if (kind === 'image') heading = 'Image';
  else if (kind === 'shape') heading = 'Shape';
  else if (kind === 'table') heading = 'Table';
  else if (kind === 'chart') heading = 'Chart';
  else if (hasText) heading = 'Text';

  const font = primary?.fontFamily || DEFAULT_FONT_FAMILY;
  const knownFont = fontOption(font);
  const lineHeight = primary?.lineHeight || DEFAULT_LINE_HEIGHT;

  const size = primary ? Math.round(primary.fontSize) : '';
  const setSize = (n) => {
    if (Number.isFinite(n) && n >= MIN_SIZE && n <= MAX_SIZE) onFormat({ fontSize: n });
  };

  return (
    <div className="props">
      <div className="props-head">
        <h2 className="ed-zone-title">{heading}</h2>
        {onClose && (
          <button type="button" className="icon-btn icon-btn-sm props-close" aria-label="Close panel" onClick={onClose}>
            <X />
          </button>
        )}
      </div>

      <div className="props-body" ref={bodyRef}>
        {selectedBlocks.length === 0 && (
          <p className="props-empty">
            <MousePointerClick aria-hidden="true" />
            Select a text box or image on the slide to format it. Double-click text to edit.
          </p>
        )}

        {hasText && (
          <section className="props-section" aria-label="Text formatting" onMouseDown={keepCanvasFocus}>
            <h3 className="props-label">Typography</h3>
            <select
              className="select"
              aria-label="Font"
              value={knownFont ? knownFont.value : font}
              onChange={(e) => onFormat({ fontFamily: e.target.value })}
            >
              {!knownFont && <option value={font}>{primaryFont(font)}</option>}
              {FONT_FAMILIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>

            <div className="props-row">
              <div className="stepper">
                <button type="button" className="icon-btn icon-btn-sm" aria-label="Decrease font size" onClick={() => setSize(size - 2)} disabled={size <= MIN_SIZE}>
                  <Minus />
                </button>
                <input
                  className="input stepper-input mono"
                  type="number"
                  aria-label="Font size"
                  min={MIN_SIZE}
                  max={MAX_SIZE}
                  value={size}
                  onChange={(e) => setSize(parseInt(e.target.value, 10))}
                />
                <button type="button" className="icon-btn icon-btn-sm" aria-label="Increase font size" onClick={() => setSize(size + 2)} disabled={size >= MAX_SIZE}>
                  <Plus />
                </button>
              </div>
              <select
                className="select props-lh"
                aria-label="Line spacing"
                value={lineHeight}
                onChange={(e) => onFormat({ lineHeight: Number(e.target.value) })}
              >
                {!LINE_HEIGHTS.includes(lineHeight) && (
                  <option value={lineHeight}>{(lineHeight * 1.13 / 1.2).toFixed(2)} spacing</option>
                )}
                {LINE_HEIGHTS.map((lh) => (
                  <option key={lh} value={lh}>{lh === DEFAULT_LINE_HEIGHT ? '1.15' : lh.toFixed(1)} spacing</option>
                ))}
              </select>
            </div>

            <div className="props-row">
              <div className="segbar" role="group" aria-label="Text style">
                <button type="button" className="icon-btn" aria-label="Bold" aria-pressed={primary?.fontWeight === 'bold'} onClick={() => onToggle('fontWeight', 'bold', 'normal')}><Bold /></button>
                <button type="button" className="icon-btn" aria-label="Italic" aria-pressed={primary?.fontStyle === 'italic'} onClick={() => onToggle('fontStyle', 'italic', 'normal')}><Italic /></button>
                <button type="button" className="icon-btn" aria-label="Underline" aria-pressed={!!primary?.underline} onClick={() => onToggle('underline', true, false)}><Underline /></button>
              </div>
              <div className="segbar" role="group" aria-label="Alignment">
                {TEXT_ALIGNMENTS.map((align) => {
                  const Icon = ALIGN_ICONS[align];
                  return (
                    <button
                      key={align}
                      type="button"
                      className="icon-btn"
                      aria-label={`Align ${align}`}
                      aria-pressed={(primary?.textAlign || 'left') === align}
                      onClick={() => onFormat({ textAlign: align })}
                    >
                      <Icon />
                    </button>
                  );
                })}
              </div>
            </div>

            <h3 className="props-label">Text colour</h3>
            <Swatches colors={TEXT_COLORS} value={primary?.fill || DEFAULT_TEXT_COLOR} onPick={(c) => onFormat({ fill: c })} label="Text colour" />
          </section>
        )}

        {shapes.length > 0 && (
          <section className="props-section" aria-label="Shape style">
            <h3 className="props-label">Fill</h3>
            <Swatches
              colors={SHAPE_FILLS}
              value={shapes[0].background || '#ffffff'}
              onPick={(c) => onShapeStyle({ background: c, fillGradient: null, opacity: null })}
              label="Shape fill"
              square
            />
            <h3 className="props-label">Outline</h3>
            <Swatches
              colors={SHAPE_FILLS}
              value={shapes[0].stroke || '#1a1a2e'}
              onPick={(c) => onShapeStyle({ stroke: c, strokeWidth: shapes[0].strokeWidth || 1 })}
              label="Shape outline"
              square
            />
            {shapes.some((b) => b.stroke) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onShapeStyle({ stroke: null, strokeWidth: null, dash: null })}>
                Remove outline
              </button>
            )}
          </section>
        )}

        {table && onTableChange && (
          <section className="props-section" aria-label="Table" data-section="table">
            <h3 className="props-label">Cells</h3>
            <TableEditor block={table} onChange={onTableChange} />
          </section>
        )}

        {chart && onChartChange && (
          <section className="props-section" aria-label="Chart data" data-section="chart">
            <h3 className="props-label">Chart data</h3>
            <ChartEditor block={chart} onChange={onChartChange} />
          </section>
        )}

        {image && onCrop && (
          <ImageSection block={image} onCrop={onCrop} onBlockPatch={onBlockPatch} onReplaceImage={onReplaceImage} onResetAspect={onResetAspect} />
        )}

        {selectedBlocks.length === 1 && onGeometry && (
          <GeometrySection block={selectedBlocks[0]} onGeometry={onGeometry} onBlockPatch={onBlockPatch} />
        )}

        {selectedBlocks.length > 0 && (
          <section className="props-section" aria-label="Arrange">
            <h3 className="props-label">Arrange</h3>
            <div className="props-grid">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRestack('front')} disabled={!single}><BringToFront aria-hidden="true" />To front</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRestack('back')} disabled={!single}><SendToBack aria-hidden="true" />To back</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRestack('forward')} disabled={!single}><ChevronUp aria-hidden="true" />Forward</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRestack('backward')} disabled={!single}><ChevronDown aria-hidden="true" />Backward</button>
            </div>
            {!single && <p className="field-hint">Select a single element to change its stacking order.</p>}
            <div className="props-row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onDuplicate} title="Ctrl+D"><Copy aria-hidden="true" />Duplicate</button>
              {onLock && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onLock(!locked)} aria-pressed={locked}>
                  {locked ? <><Unlock aria-hidden="true" />Unlock</> : <><Lock aria-hidden="true" />Lock</>}
                </button>
              )}
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={onDelete} title="Delete" disabled={locked}><Trash2 aria-hidden="true" />Delete</button>
            </div>
            {locked && <p className="field-hint">Locked elements can't be moved, resized or deleted until unlocked.</p>}
          </section>
        )}

        {slide && (
          <section className="props-section" aria-label="Slide settings">
            <h3 className="props-label">Slide background</h3>
            <Swatches
              colors={SLIDE_BACKGROUNDS}
              value={slide.backgroundColor || DEFAULT_SLIDE_BACKGROUND}
              onPick={onBackground}
              label="Slide background"
              square
            />
            {slide.backgroundImageUrl && (
              <p className="field-hint">This slide has a background image from its original file, which covers the colour.</p>
            )}
            {!slide.backgroundImageUrl && slide.backgroundGradient && (
              <p className="field-hint">This slide has a gradient from its original file. Picking a colour replaces it.</p>
            )}
          </section>
        )}

        {slide && selectedBlocks.length === 0 && onSlidePatch && (
          <SlideSection slide={slide} slideIndex={slideIndex} onSlidePatch={onSlidePatch} onApplyLayout={onApplyLayout} onApplyTheme={onApplyTheme} />
        )}
      </div>
    </div>
  );
}

export default PropertiesPanel;
