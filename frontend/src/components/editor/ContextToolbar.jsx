import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, BarChart3, Bold, Crop, FlipHorizontal2, FlipVertical2,
  Highlighter, ImagePlus, IndentDecrease, IndentIncrease, Italic, LayoutTemplate, List, ListOrdered, Lock, Minus,
  PaintBucket, Paintbrush, Palette, Plus, RemoveFormatting, Square, Strikethrough, Subscript, Superscript, Table2,
  Underline, Unlock
} from 'lucide-react';
import Popover from '../ui/Popover.jsx';
import FontPicker from './FontPicker.jsx';
import ArrangeMenu from './ArrangeMenu.jsx';
import { ColorPopover } from './controls.jsx';
import { HIGHLIGHTS, keepCanvasFocus, PALETTE } from './palette.js';
import { DEFAULT_FONT_FAMILY, DEFAULT_LINE_HEIGHT, DEFAULT_TEXT_COLOR, TEXT_ALIGNMENTS } from '../../data/slideFormat.js';
import { listKindOf } from '../../data/textOps.js';
import { CHART_KIND_LABELS, CHART_KINDS } from '../../data/chartLayout.js';
import { LAYOUTS } from '../../data/layouts.js';
import { THEMES } from '../../data/themes.js';
import LayoutThumb from './LayoutThumb.jsx';

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 200;
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 54, 64, 80, 96];
// Fabric line height multipliers and the spacing names people know.
const LINE_SPACINGS = [
  { value: 0.9, label: '0.9' },
  { value: 1, label: '1.0' },
  { value: DEFAULT_LINE_HEIGHT, label: '1.15' },
  { value: 1.35, label: '1.35' },
  { value: 1.5, label: '1.5' },
  { value: 2, label: '2.0' }
];

function Btn({ label, icon: Icon, onClick, pressed, disabled, tip }) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      data-tip={tip || label}
      aria-pressed={pressed === undefined ? undefined : !!pressed}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon />
    </button>
  );
}

const Sep = () => <span className="tb-sep" aria-hidden="true" />;

function SizeStepper({ size, onSize }) {
  const step = (dir) => {
    const next = dir > 0 ? SIZES.find((s) => s > size) ?? size + 8 : [...SIZES].reverse().find((s) => s < size) ?? size - 1;
    onSize(Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, next)));
  };
  return (
    <div className="stepper tb-size">
      <button type="button" className="icon-btn icon-btn-sm" aria-label="Decrease font size" data-tip="Smaller" onClick={() => step(-1)} disabled={size <= MIN_FONT_SIZE}>
        <Minus />
      </button>
      <input
        key={size}
        className="input stepper-input mono"
        type="number"
        aria-label="Font size"
        list="tb-font-sizes"
        min={MIN_FONT_SIZE}
        max={MAX_FONT_SIZE}
        defaultValue={size}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n) && n !== size) onSize(Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, n)));
        }}
      />
      <datalist id="tb-font-sizes">
        {SIZES.map((s) => <option key={s} value={s} />)}
      </datalist>
      <button type="button" className="icon-btn icon-btn-sm" aria-label="Increase font size" data-tip="Larger" onClick={() => step(1)} disabled={size >= MAX_FONT_SIZE}>
        <Plus />
      </button>
    </div>
  );
}

function TextTools({ primary, selection, a, painting }) {
  const size = Math.round(selection.fontSize || primary.fontSize || 16);
  const align = primary.textAlign || 'left';
  const AlignIcon = ALIGN_ICONS[align] || AlignLeft;
  const list = listKindOf(primary.text);
  const lineHeight = primary.lineHeight || DEFAULT_LINE_HEIGHT;
  return (
    <>
      <FontPicker value={selection.fontFamily || primary.fontFamily || DEFAULT_FONT_FAMILY} onPick={(stack) => a.format({ fontFamily: stack })} />
      <SizeStepper size={size} onSize={(n) => a.format({ fontSize: n })} />
      <Sep />
      <Btn label="Bold" tip="Bold (Ctrl+B)" icon={Bold} pressed={(selection.fontWeight || primary.fontWeight) === 'bold'} onClick={() => a.toggle('fontWeight', 'bold', 'normal')} />
      <Btn label="Italic" tip="Italic (Ctrl+I)" icon={Italic} pressed={(selection.fontStyle || primary.fontStyle) === 'italic'} onClick={() => a.toggle('fontStyle', 'italic', 'normal')} />
      <Btn label="Underline" tip="Underline (Ctrl+U)" icon={Underline} pressed={selection.underline ?? primary.underline} onClick={() => a.toggle('underline', true, false)} />
      <Btn label="Strikethrough" icon={Strikethrough} pressed={selection.linethrough ?? primary.linethrough} onClick={() => a.toggle('linethrough', true, false)} />
      <ColorPopover label="Text colour" icon={Baseline} value={selection.fill || primary.fill || DEFAULT_TEXT_COLOR} onPick={(c) => a.format({ fill: c || DEFAULT_TEXT_COLOR })} />
      <ColorPopover
        label="Highlight"
        icon={Highlighter}
        value={selection.textBackgroundColor || primary.textBackgroundColor}
        colors={[...HIGHLIGHTS, ...PALETTE.slice(7, 14)]}
        allowNone
        noneLabel="No highlight"
        onPick={(c) => a.format({ textBackgroundColor: c })}
      />
      <Sep />
      <Popover label={`Alignment: ${align}`} tip="Align" trigger={<AlignIcon aria-hidden="true" />}>
        {(close) => (
          <div className="segbar" role="group" aria-label="Alignment" onMouseDown={keepCanvasFocus}>
            {TEXT_ALIGNMENTS.map((al) => {
              const Icon = ALIGN_ICONS[al];
              return (
                <button key={al} type="button" className="icon-btn" aria-label={`Align ${al}`} aria-pressed={align === al} onClick={() => { a.format({ textAlign: al }); close(); }}>
                  <Icon />
                </button>
              );
            })}
          </div>
        )}
      </Popover>
      <Popover label="Line spacing" tip="Line spacing" triggerClassName="btn btn-ghost btn-sm tb-text-btn" trigger={<span className="mono">{(LINE_SPACINGS.find((l) => l.value === lineHeight)?.label) || lineHeight.toFixed(2)}×</span>}>
        {(close) => (
          <div className="tb-list" role="group" aria-label="Line spacing" onMouseDown={keepCanvasFocus}>
            {LINE_SPACINGS.map((l) => (
              <button key={l.value} type="button" className="menu-item" aria-pressed={lineHeight === l.value} onClick={() => { a.format({ lineHeight: l.value }); close(); }}>
                {l.label}
              </button>
            ))}
            <div className="menu-sep" />
            <p className="props-label">Space between paragraphs</p>
            <div className="segbar">
              {[0, 6, 12, 18].map((p) => (
                <button key={p} type="button" className="btn btn-quiet btn-sm" aria-pressed={(primary.paragraphSpacing || 0) === p} onClick={() => a.format({ paragraphSpacing: p || null })}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </Popover>
      <Btn label="Bulleted list" icon={List} pressed={list === 'bullet'} onClick={() => a.list('bullet')} />
      <Btn label="Numbered list" icon={ListOrdered} pressed={list === 'number'} onClick={() => a.list('number')} />
      <Btn label="Decrease indent" tip="Decrease indent (Shift+Tab)" icon={IndentDecrease} onClick={() => a.indent(-1)} />
      <Btn label="Increase indent" tip="Increase indent (Tab)" icon={IndentIncrease} onClick={() => a.indent(1)} />
      <Sep />
      <Btn label="Superscript" icon={Superscript} pressed={selection.deltaY < 0} onClick={() => a.script('super')} />
      <Btn label="Subscript" icon={Subscript} pressed={selection.deltaY > 0} onClick={() => a.script('sub')} />
      <Btn label="Clear formatting" icon={RemoveFormatting} onClick={a.clearFormat} />
      <Btn label={painting ? 'Format painter on: click a text box to paint' : 'Format painter'} tip="Copy formatting" icon={Paintbrush} pressed={painting} onClick={a.togglePainter} />
    </>
  );
}

function ShapeTools({ shape, a }) {
  const opacity = Math.round((shape.opacity ?? 1) * 100);
  return (
    <>
      <ColorPopover label="Fill" icon={PaintBucket} value={shape.background} allowNone noneLabel="No fill" onPick={(c) => a.shapeStyle({ background: c, fillGradient: null })} />
      <ColorPopover label="Outline" icon={Square} value={shape.stroke} allowNone noneLabel="No outline" onPick={(c) => a.shapeStyle(c ? { stroke: c, strokeWidth: shape.strokeWidth || 2 } : { stroke: null, strokeWidth: null, dash: null })} />
      <Popover label="Outline style" tip="Outline style" triggerClassName="btn btn-ghost btn-sm tb-text-btn" trigger={<span className="mono">{shape.stroke ? `${shape.strokeWidth || 1}px` : 'No line'}</span>}>
        {(close) => (
          <div className="tb-list">
            {[1, 2, 3, 4, 6, 8].map((w) => (
              <button key={w} type="button" className="menu-item" aria-pressed={shape.stroke && (shape.strokeWidth || 1) === w} onClick={() => { a.shapeStyle({ stroke: shape.stroke || '#171a19', strokeWidth: w }); close(); }}>
                <span className="tb-line-sample" style={{ height: w }} aria-hidden="true" />{w}px
              </button>
            ))}
            <div className="menu-sep" />
            <button type="button" className="menu-item" aria-pressed={!!shape.dash} onClick={() => { a.shapeStyle({ dash: shape.dash ? null : true, stroke: shape.stroke || '#171a19', strokeWidth: shape.strokeWidth || 2 }); close(); }}>
              Dashed line
            </button>
          </div>
        )}
      </Popover>
      <OpacityPopover value={opacity} onChange={(v) => a.shapeStyle({ opacity: v >= 100 ? null : v / 100 })} />
    </>
  );
}

function OpacityPopover({ value, onChange }) {
  return (
    <Popover label="Transparency" tip="Opacity" triggerClassName="btn btn-ghost btn-sm tb-text-btn" trigger={<span className="mono">{value}%</span>}>
      <label className="tb-range">
        <span className="props-label">Opacity</span>
        <input type="range" min={5} max={100} step={5} value={value} aria-label="Opacity" onChange={(e) => onChange(Number(e.target.value))} />
        <span className="mono">{value}%</span>
      </label>
    </Popover>
  );
}

function ImageTools({ image, a }) {
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={a.replaceImage}><ImagePlus aria-hidden="true" />Replace</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => a.openPanel('image')}><Crop aria-hidden="true" />Crop & style</button>
      <Btn label="Flip horizontally" icon={FlipHorizontal2} pressed={image.flipH} onClick={() => a.blockPatch({ flipH: image.flipH ? null : true })} />
      <Btn label="Flip vertically" icon={FlipVertical2} pressed={image.flipV} onClick={() => a.blockPatch({ flipV: image.flipV ? null : true })} />
      <OpacityPopover value={Math.round((image.opacity ?? 1) * 100)} onChange={(v) => a.blockPatch({ opacity: v >= 100 ? null : v / 100 })} />
    </>
  );
}

function SlideTools({ slide, a }) {
  return (
    <>
      <Popover label="Layout" tip="Apply a layout" triggerClassName="btn btn-ghost btn-sm" trigger={<><LayoutTemplate aria-hidden="true" />Layout</>} panelClassName="tb-layouts">
        {(close) => (
          <>
            <p className="props-label">Rearranges this slide's content into the layout. Nothing is deleted.</p>
            <div className="layout-grid">
              {LAYOUTS.map((l) => (
                <button key={l.id} type="button" className="layout-card" aria-pressed={slide.layout === l.id} onClick={() => { a.applyLayout(l.id); close(); }}>
                  <LayoutThumb layout={l} />
                  <span>{l.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Popover>
      <Popover label="Theme" tip="Colours and fonts" triggerClassName="btn btn-ghost btn-sm" trigger={<><Palette aria-hidden="true" />Theme</>} panelClassName="tb-themes">
        {(close) => <ThemeChooser current={slide.theme} onApply={(id, all) => { a.applyTheme(id, all); close(); }} />}
      </Popover>
      <ColorPopover label="Slide background" icon={PaintBucket} value={slide.backgroundColor} onPick={(c) => a.background(c)} />
    </>
  );
}

export function ThemeChooser({ current, onApply }) {
  return (
    <div className="theme-chooser">
      <p className="props-label">Changes colours and fonts only. Your content and layout stay as they are.</p>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <div key={t.id} className={`theme-card${current === t.id ? ' is-current' : ''}`} style={{ cursor: 'pointer' }} onClick={() => onApply(t.id, false)}>
            <div
              className="theme-swatch"
              style={{ background: t.backgroundGradient ? `linear-gradient(${t.backgroundGradient.angle}deg, ${t.backgroundGradient.stops.map((s) => `${s.color} ${s.pos * 100}%`).join(', ')})` : t.background }}
              aria-hidden="true"
            >
              <span style={{ color: t.title, fontFamily: t.titleFont }}>Aa</span>
              <i style={{ background: t.accent }} />
            </div>
            <span className="theme-name">{t.name}</span>
            <div className="theme-actions" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => onApply(t.id, false)}>This slide</button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => onApply(t.id, true)}>All</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The format bar under the editor header. It shows the tools for what is
// selected: text, a shape, a picture, a table or chart, or the slide.
function ContextToolbar({ slide, selectedBlocks, primary, selection, actions: a, painting }) {
  if (!slide) return <div className="ctx-bar" role="toolbar" aria-label="Formatting" />;
  const single = selectedBlocks.length === 1 ? selectedBlocks[0] : null;
  const kind = single ? single.type || 'textbox' : selectedBlocks.length ? 'many' : 'slide';
  const shape = selectedBlocks.find((b) => b.type === 'shape');
  const locked = selectedBlocks.length > 0 && selectedBlocks.every((b) => b.locked);

  return (
    <div className="ctx-bar" role="toolbar" aria-label="Formatting" onMouseDown={keepCanvasFocus}>
      {primary && <TextTools primary={primary} selection={selection} a={a} painting={painting} />}
      {shape && !primary && <ShapeTools shape={shape} a={a} />}
      {kind === 'image' && <ImageTools image={single} a={a} />}
      {kind === 'table' && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => a.openPanel('table')}><Table2 aria-hidden="true" />Edit table</button>
      )}
      {kind === 'chart' && (
        <>
          <select className="select select-sm" aria-label="Chart type" value={single.chart?.kind || 'column'} onChange={(e) => a.chartPatch({ kind: e.target.value })}>
            {CHART_KINDS.map((k) => <option key={k} value={k}>{CHART_KIND_LABELS[k]}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => a.openPanel('chart')}><BarChart3 aria-hidden="true" />Edit data</button>
        </>
      )}
      {kind === 'slide' && <SlideTools slide={slide} a={a} />}
      {selectedBlocks.length > 0 && (
        <>
          <span className="tb-spacer" />
          {locked && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => a.lock(false)}><Unlock aria-hidden="true" />Unlock</button>
          )}
          {!locked && <Btn label="Lock position" icon={Lock} onClick={() => a.lock(true)} />}
          <ArrangeMenu selectedBlocks={selectedBlocks} a={a} />
        </>
      )}
    </div>
  );
}

export default ContextToolbar;
