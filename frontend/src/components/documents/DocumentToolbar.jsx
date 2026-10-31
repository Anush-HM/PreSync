import { useEditorState } from '@tiptap/react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, Check, Columns2, Combine, ChevronDown, Frame, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, Minus, Plus,
  Redo2, Rows2, Split, Strikethrough, Trash2, Underline, Undo2, Rows3
} from 'lucide-react';
import FontPicker from '../editor/FontPicker.jsx';
import { ColorPopover } from '../editor/controls.jsx';
import { HIGHLIGHTS, keepCanvasFocus } from '../editor/palette.js';
import Popover from '../ui/Popover.jsx';
import { DEFAULT_FONT_FAMILY } from '../../data/slideFormat.js';
import DocumentInsertMenu from './DocumentInsertMenu.jsx';
import { blockFontSize, BULLET_STYLES, NUMBER_STYLES } from './documentExtensions.js';
import '../editor/toolbar.css';

const LINE_SPACINGS = [1, 1.15, 1.5, 2];
const ALIGNS = [
  { id: 'left', label: 'Align left', icon: AlignLeft },
  { id: 'center', label: 'Align centre', icon: AlignCenter },
  { id: 'right', label: 'Align right', icon: AlignRight },
  { id: 'justify', label: 'Justify', icon: AlignJustify }
];
const MIN_SIZE = 6;
const MAX_SIZE = 96;

const Sep = () => <span className="tb-sep" aria-hidden="true" />;

function Toggle({ label, icon: Icon, pressed, disabled, onClick }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} data-tip={label} aria-pressed={pressed === undefined ? undefined : !!pressed} disabled={disabled} onClick={onClick}>
      <Icon />
    </button>
  );
}

function ListMenu({ label, icon: Icon, styles, active, current, onPick, onRemove }) {
  return (
    <Popover
      label={label}
      tip={label}
      triggerClassName={`btn btn-ghost btn-sm doc-list-trigger${active ? ' is-active' : ''}`}
      trigger={<><Icon aria-hidden="true" /><ChevronDown aria-hidden="true" /></>}
    >
      {(close) => (
        <div className="tb-list" role="group" aria-label={label} onMouseDown={keepCanvasFocus}>
          {styles.map((s) => (
            <button key={s.id} type="button" className="menu-item" aria-label={s.label} aria-pressed={active && current === s.id} onClick={() => { onPick(s.id); close(); }}>
              <span className="doc-list-sample">{s.sample}</span>{s.label}
            </button>
          ))}
          {active && <button type="button" className="menu-item" onClick={() => { onRemove(); close(); }}>Remove list</button>}
        </div>
      )}
    </Popover>
  );
}

function pointSize(fontSize) {
  const n = parseFloat(fontSize);
  if (!Number.isFinite(n)) return null;
  return /px$/.test(fontSize) ? Math.round(n * 0.75 * 2) / 2 : n;
}

function SizeStepper({ value, onChange }) {
  const step = (d) => onChange(Math.max(MIN_SIZE, Math.min(MAX_SIZE, value + d)));
  return (
    <div className="stepper tb-size">
      <button type="button" className="icon-btn icon-btn-sm" aria-label="Decrease font size" onClick={() => step(-1)}><Minus /></button>
      <input
        key={value}
        className="input stepper-input mono"
        aria-label="Font size in points"
        inputMode="decimal"
        defaultValue={value}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n > 0 && n !== value) onChange(Math.max(MIN_SIZE, Math.min(MAX_SIZE, n)));
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
      <button type="button" className="icon-btn icon-btn-sm" aria-label="Increase font size" onClick={() => step(1)}><Plus /></button>
    </div>
  );
}

function TableTools({ editor }) {
  const can = editor.can();
  const act = (name) => () => editor.chain().focus()[name]().run();
  return (
    <div className="doc-table-tools" role="toolbar" aria-label="Table" onMouseDown={keepCanvasFocus}>
      <span className="doc-table-label">Table</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={act('addRowAfter')}><Rows2 aria-hidden="true" />Add row</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={act('addColumnAfter')}><Columns2 aria-hidden="true" />Add column</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={act('deleteRow')}><Rows3 aria-hidden="true" />Delete row</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={act('deleteColumn')}><Columns2 aria-hidden="true" />Delete column</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={!can.mergeCells()} onClick={act('mergeCells')}><Combine aria-hidden="true" />Merge</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={!can.splitCell()} onClick={act('splitCell')}><Split aria-hidden="true" />Split</button>
      <ColorPopover
        label="Cell shading"
        icon={Baseline}
        colors={HIGHLIGHTS}
        allowNone
        value={editor.getAttributes('tableCell').background}
        onPick={(c) => editor.chain().focus().setCellAttribute('background', c).run()}
      />
      <button type="button" className="btn btn-ghost btn-sm" onClick={act('deleteTable')}><Trash2 aria-hidden="true" />Delete table</button>
    </div>
  );
}

// Formatting bar for the document editor. Reads the current selection
// through useEditorState, so it redraws only when a value it shows changes.
function DocumentToolbar({ editor, onPageNumbers, onHeaderFooter, onPageBorder, hasBorder }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const style = e.getAttributes('textStyle');
      const block = e.isActive('heading') ? e.getAttributes('heading') : e.getAttributes('paragraph');
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        family: style.fontFamily || DEFAULT_FONT_FAMILY,
        size: pointSize(style.fontSize) ?? blockFontSize(e),
        color: style.color || null,
        align: block.textAlign || 'left',
        line: block.lineHeight || 1.15,
        bullets: e.isActive('bulletList'),
        numbers: e.isActive('orderedList'),
        bulletStyle: e.getAttributes('bulletList').listStyle || 'disc',
        numberStyle: e.getAttributes('orderedList').listStyle || 'decimal',
        inTable: e.isActive('table'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo()
      };
    }
  });

  const chain = () => editor.chain().focus();

  return (
    <>
      <div className="doc-toolbar" role="toolbar" aria-label="Formatting" onMouseDown={keepCanvasFocus}>
        <Toggle label="Undo" icon={Undo2} disabled={!state.canUndo} onClick={() => chain().undo().run()} />
        <Toggle label="Redo" icon={Redo2} disabled={!state.canRedo} onClick={() => chain().redo().run()} />
        <Sep />
        <DocumentInsertMenu editor={editor} onPageNumbers={onPageNumbers} onHeaderFooter={onHeaderFooter} />
        <Sep />
        <FontPicker value={state.family} onPick={(stack) => chain().setFontFamily(stack).run()} />
        <SizeStepper value={state.size} onChange={(pt) => chain().setFontSize(`${pt}pt`).run()} />
        <Popover
          label={`Line spacing: ${state.line}`}
          tip="Line spacing"
          triggerClassName="btn btn-ghost btn-sm tb-text-btn"
          trigger={<span className="mono">{state.line}</span>}
        >
          {(close) => (
            <div className="tb-list" role="group" aria-label="Line spacing" onMouseDown={keepCanvasFocus}>
              {LINE_SPACINGS.map((l) => (
                <button key={l} type="button" className="menu-item" aria-pressed={state.line === l} onClick={() => { chain().setLineHeight(l).run(); close(); }}>
                  {state.line === l ? <Check aria-hidden="true" /> : <span className="doc-menu-gap" />}{l.toFixed(l === 1.15 ? 2 : 1)}
                </button>
              ))}
            </div>
          )}
        </Popover>
        <Sep />
        <Toggle label="Bold" icon={Bold} pressed={state.bold} onClick={() => chain().toggleBold().run()} />
        <Toggle label="Italic" icon={Italic} pressed={state.italic} onClick={() => chain().toggleItalic().run()} />
        <Toggle label="Underline" icon={Underline} pressed={state.underline} onClick={() => chain().toggleUnderline().run()} />
        <Toggle label="Strikethrough" icon={Strikethrough} pressed={state.strike} onClick={() => chain().toggleStrike().run()} />
        <Sep />
        {ALIGNS.map((a) => (
          <Toggle key={a.id} label={a.label} icon={a.icon} pressed={state.align === a.id} onClick={() => chain().setTextAlign(a.id).run()} />
        ))}
        <Sep />
        <ListMenu label="Bulleted list" icon={List} styles={BULLET_STYLES} active={state.bullets} current={state.bulletStyle} onPick={(id) => chain().setListStyle('bulletList', id).run()} onRemove={() => chain().toggleBulletList().run()} />
        <ListMenu label="Numbered list" icon={ListOrdered} styles={NUMBER_STYLES} active={state.numbers} current={state.numberStyle} onPick={(id) => chain().setListStyle('orderedList', id).run()} onRemove={() => chain().toggleOrderedList().run()} />
        <Toggle label="Decrease indent" icon={IndentDecrease} onClick={() => chain().shiftIndent(-1).run()} />
        <Toggle label="Increase indent" icon={IndentIncrease} onClick={() => chain().shiftIndent(1).run()} />
        <Sep />
        <ColorPopover
          label="Text colour"
          icon={Baseline}
          allowNone
          noneLabel="Automatic"
          value={state.color}
          onPick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())}
        />
        <Sep />
        <Toggle label="Page border" icon={Frame} pressed={hasBorder} onClick={onPageBorder} />
      </div>
      {state.inTable && <TableTools editor={editor} />}
    </>
  );
}

export default DocumentToolbar;
