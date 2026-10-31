import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Hash, Link2, PanelBottom, PanelTop, Type } from 'lucide-react';
import Menu from '../ui/Menu.jsx';
import {
  DEFAULT_ZONE_INCHES, FOOTER_PRESETS, HEADER_PRESETS, PAGE_GAP, PAGE_NUMBER_TOKENS, borderOnPage, borderStyle, dateTexts, fillTokens,
  isLinked, setLinked, zoneDistance, zoneOwner, zoneRule, zoneSlots, zoneSource, zoneTexts
} from './pageLayout.js';

const SIDES = ['left', 'center', 'right'];
const SIDE_NAMES = { left: 'left', center: 'centre', right: 'right' };

const zonePlace = (layout, zone) => ({ [zone === 'header' ? 'top' : 'bottom']: zoneDistance(layout, zone) });

function Zone({ zone, texts, values, rule, place }) {
  return (
    <div className={`doc-zone is-${zone}${rule ? ' has-rule' : ''}`} style={place} aria-hidden="true">
      {SIDES.map((side) => <span key={side} className={`doc-zone-slot is-${side}`}>{texts[side] ? fillTokens(texts[side], values) : ''}</span>)}
    </div>
  );
}

function ZoneInputs({ zone, slots, onChange, onFocusSlot, autoFocus, rule, place, tag }) {
  const name = zone === 'header' ? 'Header' : 'Footer';
  return (
    <div className={`doc-zone is-${zone} is-editing${rule ? ' has-rule' : ''}`} style={place}>
      {tag && <span className="doc-zone-tag">{tag}</span>}
      {SIDES.map((side) => (
        <input
          key={side}
          className={`doc-zone-input is-${side}`}
          aria-label={`${name} ${SIDE_NAMES[side]}`}
          placeholder={SIDE_NAMES[side]}
          maxLength={200}
          value={slots[side]}
          autoFocus={autoFocus && side === 'left'}
          onChange={(e) => onChange(zone, side, e.target.value)}
          onFocus={(e) => onFocusSlot({ zone, side, input: e.target })}
        />
      ))}
    </div>
  );
}

function Distance({ label, value, onChange }) {
  return (
    <label className="doc-zone-distance">
      {label}
      <input
        key={value}
        className="input"
        type="number"
        min="0.1"
        max="1.5"
        step="0.05"
        defaultValue={value}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n > 0) onChange(Math.max(0.1, Math.min(1.5, n)));
        }}
      />
      in
    </label>
  );
}

// The controls shown while headers and footers are open.
function ZoneBar({ layout, nav, onChange, onPreset, onInsert, onRemove, onClose }) {
  const insertItems = (list) => list.map((t) => ({ label: t.label, onSelect: () => onInsert(t.text) }));
  const presetItems = (zone, list) => list.map((p) => ({ label: p.label, onSelect: () => onPreset(zone, p) }));
  return (
    <div className="doc-zone-bar" role="toolbar" aria-label="Header and footer">
      <strong>Header &amp; footer</strong>
      <span className="mono doc-zone-where">Page {nav.page}</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={!nav.onPrevious} onClick={nav.onPrevious}><ChevronLeft aria-hidden="true" />Previous</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={!nav.onNext} onClick={nav.onNext}>Next<ChevronRight aria-hidden="true" /></button>
      <button type="button" className="btn btn-ghost btn-sm" aria-pressed={nav.linked} disabled={!nav.onToggleLink} data-tip={`Applies to the ${nav.zone}`} onClick={nav.onToggleLink}><Link2 aria-hidden="true" />Link to Previous</button>
      <span className="tb-sep" aria-hidden="true" />
      <Menu label="Header styles" icon={PanelTop} text="Header styles" align="start" triggerClassName="btn btn-ghost btn-sm" items={presetItems('header', HEADER_PRESETS)} />
      <Menu label="Footer styles" icon={PanelBottom} text="Footer styles" align="start" triggerClassName="btn btn-ghost btn-sm" items={presetItems('footer', FOOTER_PRESETS)} />
      <span className="tb-sep" aria-hidden="true" />
      <Menu label="Insert Page Number" icon={Hash} text="Page number" align="start" triggerClassName="btn btn-ghost btn-sm" items={insertItems(PAGE_NUMBER_TOKENS)} />
      <Menu label="Insert Date" icon={CalendarDays} text="Date" align="start" triggerClassName="btn btn-ghost btn-sm" items={insertItems(dateTexts())} />
      <button type="button" className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert('{title}')}><Type aria-hidden="true" />Title</button>
      <span className="tb-sep" aria-hidden="true" />
      <label className="doc-check">
        <input type="checkbox" checked={layout.differentFirstPage} onChange={(e) => onChange({ differentFirstPage: e.target.checked })} />
        Different first page
      </label>
      <label className="doc-check">
        <input
          type="checkbox"
          checked={!!layout.differentOddEven}
          onChange={(e) => onChange({ differentOddEven: e.target.checked, even: layout.even || { header: layout.header, footer: layout.footer } })}
        />
        Different odd &amp; even pages
      </label>
      <span className="tb-sep" aria-hidden="true" />
      <Distance label="Header from top" value={layout.headerDistance ?? DEFAULT_ZONE_INCHES} onChange={(headerDistance) => onChange({ headerDistance })} />
      <Distance label="Footer from bottom" value={layout.footerDistance ?? DEFAULT_ZONE_INCHES} onChange={(footerDistance) => onChange({ footerDistance })} />
      <span className="tb-sep" aria-hidden="true" />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove('header')}>Remove Header</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove('footer')}>Remove Footer</button>
      <span className="doc-header-spacer" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Close Header &amp; Footer</button>
    </div>
  );
}

// Separate sheets of paper behind the text, each with its header, footer
// and border. Text in the flow on top lands on the sheets by pagination.js.
function PageSheets({ page, pages, layout, title, editingPage, onEditPage, onLayoutChange, onSurfaceDown, children }) {
  const m = page.margins;
  const pitch = page.height + PAGE_GAP;
  const contentWidth = page.width - m.left - m.right;
  const rootRef = useRef(null);
  const slotRef = useRef(null);
  const [activeZone, setActiveZone] = useState('header');
  const editing = editingPage !== null;
  // A cover page has no header of its own, so edit on the next page.
  const target = layout.differentFirstPage && editingPage === 0 && pages > 1 ? 1 : editingPage;

  useEffect(() => {
    if (!editing) return undefined;
    const onDown = (e) => {
      if (!e.target.closest('.doc-zone-bar, .doc-zone.is-editing')) onEditPage(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') onEditPage(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [editing, onEditPage]);

  function openZones(e) {
    if (editing || !rootRef.current) return;
    const y = e.clientY - rootRef.current.getBoundingClientRect().top;
    const index = Math.floor(y / pitch);
    const inPage = y - index * pitch;
    if (index < pages && (inPage < m.top || inPage > page.height - m.bottom)) onEditPage(index);
  }

  // Fields edit the odd or even set, whichever the open page shows.
  const editsEven = target !== null && zoneSource(layout, target) === 'even';

  // The patch that sets a zone's texts wherever the open page takes them from.
  function zonePatch(zone, next) {
    const owner = zoneOwner(layout, zone, target);
    if (owner !== null) return { sections: { ...layout.sections, [zone]: { ...layout.sections[zone], [owner]: next } } };
    return editsEven ? { even: { ...layout.even, [zone]: next } } : { [zone]: next };
  }

  function setZone(zone, next) {
    onLayoutChange({ ...layout, ...zonePatch(zone, next) });
  }

  function setSlot(zone, side, value) {
    setZone(zone, { ...zoneSlots(layout, zone, target), [side]: value });
  }

  function applyPreset(zone, preset) {
    onLayoutChange({ ...layout, [`${zone}Rule`]: preset.rule, ...zonePatch(zone, preset.slots) });
  }

  function removeZone(zone) {
    const empty = { left: '', center: '', right: '' };
    const inZone = layout.pageNumbers?.position.startsWith(zone === 'header' ? 'top' : 'bottom');
    onLayoutChange({
      ...layout,
      [zone]: empty,
      [`${zone}Rule`]: false,
      sections: { ...layout.sections, [zone]: {} },
      ...(layout.even ? { even: { ...layout.even, [zone]: empty } } : {}),
      ...(inZone ? { pageNumbers: null } : {})
    });
  }

  // A cover page has no header of its own, so it can't be stepped onto.
  const firstEditable = layout.differentFirstPage && pages > 1 ? 1 : 0;
  const nav = editing && {
    page: target + 1,
    zone: activeZone,
    linked: target > 0 && isLinked(layout, activeZone, target),
    onPrevious: target > firstEditable ? () => onEditPage(target - 1) : undefined,
    onNext: target < pages - 1 ? () => onEditPage(target + 1) : undefined,
    onToggleLink: target > 0 ? () => onLayoutChange(setLinked(layout, activeZone, target, !isLinked(layout, activeZone, target))) : undefined
  };
  const linkTag = (zone) => (target > 0 ? (isLinked(layout, zone, target) ? '[ Same as Previous ]' : '[ Section / Unlinked ]') : null);
  const focusSlot = (slot) => {
    slotRef.current = slot;
    setActiveZone(slot.zone);
  };

  // Goes in at the cursor of the last field used, else after the header's left text.
  function insertText(text) {
    const slot = slotRef.current?.input.isConnected ? slotRef.current : null;
    if (!slot) {
      const current = zoneSlots(layout, 'header', target);
      setSlot('header', 'left', `${current.left}${text}`.slice(0, 200));
      return;
    }
    const { zone, side, input } = slot;
    const at = input.selectionStart ?? input.value.length;
    const value = `${input.value.slice(0, at)}${text}${input.value.slice(input.selectionEnd ?? at)}`;
    setSlot(zone, side, value.slice(0, 200));
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(at + text.length, at + text.length);
    });
  }

  return (
    <>
      {editing && (
        <ZoneBar
          layout={layout}
          nav={nav}
          onChange={(patch) => onLayoutChange({ ...layout, ...patch })}
          onPreset={applyPreset}
          onInsert={insertText}
          onRemove={removeZone}
          onClose={() => onEditPage(null)}
        />
      )}
      <div className="doc-scroll" onMouseDown={editing ? undefined : onSurfaceDown}>
        <div
          ref={rootRef}
          className={`doc-sheets${editing ? ' is-editing-zones' : ''}`}
          style={{ width: page.width, height: pages * pitch - PAGE_GAP }}
          onDoubleClick={openZones}
        >
          {Array.from({ length: pages }, (_, i) => {
            const values = { page: i + 1, pages, title, numbers: layout.pageNumbers };
            const zoneProps = (zone) => ({ rule: zoneRule(layout, zone, i), place: zonePlace(layout, zone) });
            return (
              <section key={i} className="doc-sheet" aria-label={`Page ${i + 1} of ${pages}`} style={{ top: i * pitch, height: page.height, '--zone-left': `${m.left}px`, '--zone-right': `${m.right}px`, '--zone-width': `${contentWidth}px` }}>
                {borderOnPage(layout.pageBorder, i) && <div className="doc-sheet-border" style={borderStyle(layout.pageBorder)} />}
                {target === i ? (
                  <>
                    <ZoneInputs {...zoneProps('header')} zone="header" tag={linkTag('header')} slots={zoneSlots(layout, 'header', i)} onChange={setSlot} onFocusSlot={focusSlot} autoFocus={activeZone === 'header'} />
                    <ZoneInputs {...zoneProps('footer')} zone="footer" tag={linkTag('footer')} slots={zoneSlots(layout, 'footer', i)} onChange={setSlot} onFocusSlot={focusSlot} autoFocus={activeZone === 'footer'} />
                  </>
                ) : (
                  <>
                    <Zone {...zoneProps('header')} zone="header" texts={zoneTexts(layout, 'header', i)} values={values} />
                    <Zone {...zoneProps('footer')} zone="footer" texts={zoneTexts(layout, 'footer', i)} values={values} />
                  </>
                )}
              </section>
            );
          })}
          <div className="doc-flow" style={{ top: m.top, left: m.left, width: contentWidth }}>{children}</div>
        </div>
      </div>
    </>
  );
}

export default PageSheets;
