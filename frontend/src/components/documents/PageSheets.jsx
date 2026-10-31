import { useEffect, useRef } from 'react';
import { PAGE_GAP, borderOnPage, borderStyle, fillTokens, TOKENS, zoneTexts } from './pageLayout.js';

const SIDES = ['left', 'center', 'right'];
const SIDE_NAMES = { left: 'left', center: 'centre', right: 'right' };

function Zone({ zone, texts, values }) {
  return (
    <div className={`doc-zone is-${zone}`} aria-hidden="true">
      {SIDES.map((side) => <span key={side} className={`doc-zone-slot is-${side}`}>{texts[side] ? fillTokens(texts[side], values) : ''}</span>)}
    </div>
  );
}

function ZoneInputs({ zone, slots, onChange, onFocusSlot, autoFocus }) {
  const name = zone === 'header' ? 'Header' : 'Footer';
  return (
    <div className={`doc-zone is-${zone} is-editing`}>
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

// The bar shown while headers and footers are open.
function ZoneBar({ layout, onToggleFirst, onToken, onClose }) {
  return (
    <div className="doc-zone-bar" role="toolbar" aria-label="Header and footer">
      <strong>Header &amp; footer</strong>
      <label className="doc-check">
        <input type="checkbox" checked={layout.differentFirstPage} onChange={(e) => onToggleFirst(e.target.checked)} />
        Different first page
      </label>
      <span className="tb-sep" aria-hidden="true" />
      {TOKENS.map((t) => (
        <button key={t.token} type="button" className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => onToken(t.token)}>{t.label}</button>
      ))}
      <span className="doc-header-spacer" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Close Header/Footer</button>
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

  function setSlot(zone, side, value) {
    onLayoutChange({ ...layout, [zone]: { ...layout[zone], [side]: value } });
  }

  function insertToken(token) {
    const slot = slotRef.current;
    if (!slot) return;
    const { zone, side, input } = slot;
    const at = input.selectionStart ?? input.value.length;
    const value = `${input.value.slice(0, at)}${token}${input.value.slice(input.selectionEnd ?? at)}`;
    setSlot(zone, side, value.slice(0, 200));
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(at + token.length, at + token.length);
    });
  }

  return (
    <>
      {editing && (
        <ZoneBar
          layout={layout}
          onToggleFirst={(differentFirstPage) => onLayoutChange({ ...layout, differentFirstPage })}
          onToken={insertToken}
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
            const values = { page: i + 1, pages, title };
            const zoneProps = { slotsFor: (zone) => zoneTexts(layout, zone, i) };
            return (
              <section key={i} className="doc-sheet" aria-label={`Page ${i + 1} of ${pages}`} style={{ top: i * pitch, height: page.height, '--zone-left': `${m.left}px`, '--zone-right': `${m.right}px`, '--zone-width': `${contentWidth}px` }}>
                {borderOnPage(layout.pageBorder, i) && <div className="doc-sheet-border" style={borderStyle(layout.pageBorder)} />}
                {target === i ? (
                  <>
                    <ZoneInputs zone="header" slots={layout.header} onChange={setSlot} onFocusSlot={(s) => { slotRef.current = s; }} autoFocus />
                    <ZoneInputs zone="footer" slots={layout.footer} onChange={setSlot} onFocusSlot={(s) => { slotRef.current = s; }} />
                  </>
                ) : (
                  <>
                    <Zone zone="header" texts={zoneProps.slotsFor('header')} values={values} />
                    <Zone zone="footer" texts={zoneProps.slotsFor('footer')} values={values} />
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
