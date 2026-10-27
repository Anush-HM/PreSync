import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, BringToFront, ChevronDown, ChevronUp, Copy,
  Italic, Minus, MousePointerClick, Plus, SendToBack, Trash2, Underline, X
} from 'lucide-react';
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_SLIDE_BACKGROUND,
  DEFAULT_TEXT_COLOR,
  FONT_FAMILIES,
  SLIDE_BACKGROUNDS,
  TEXT_ALIGNMENTS,
  TEXT_COLORS
} from '../../data/slideFormat.js';
import './editor.css';

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };
const LINE_HEIGHTS = [1, 1.16, 1.5, 2];
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
        <input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={value} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );
}

// Right zone: formatting for whatever is selected on the canvas, and the
// slide's own settings when nothing is.
function PropertiesPanel({
  slide, slideIndex, selectedBlocks, primary,
  onFormat, onToggle, onRestack, onDuplicate, onDelete, onBackground, onClose
}) {
  const textCount = selectedBlocks.filter((b) => b.type !== 'image').length;
  const imageCount = selectedBlocks.length - textCount;
  const hasText = textCount > 0;
  const single = selectedBlocks.length === 1;

  let heading = `Slide ${slideIndex + 1}`;
  if (selectedBlocks.length > 1) heading = `${selectedBlocks.length} elements`;
  else if (imageCount === 1) heading = 'Image';
  else if (hasText) heading = 'Text';

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

      <div className="props-body">
        {selectedBlocks.length === 0 && (
          <p className="props-empty">
            <MousePointerClick aria-hidden="true" />
            Select a text box or image on the slide to format it. Double-click text to edit.
          </p>
        )}

        {hasText && (
          <section className="props-section" aria-label="Text formatting">
            <h3 className="props-label">Typography</h3>
            <select
              className="select"
              aria-label="Font"
              value={primary?.fontFamily || DEFAULT_FONT_FAMILY}
              onChange={(e) => onFormat({ fontFamily: e.target.value })}
            >
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
                value={primary?.lineHeight || DEFAULT_LINE_HEIGHT}
                onChange={(e) => onFormat({ lineHeight: Number(e.target.value) })}
              >
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
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={onDelete} title="Delete"><Trash2 aria-hidden="true" />Delete</button>
            </div>
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
          </section>
        )}
      </div>
    </div>
  );
}

export default PropertiesPanel;
