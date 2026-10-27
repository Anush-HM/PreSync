import { useEffect, useId, useRef, useState } from 'react';
import './ui.css';

// Small dropdown menu (button + role="menu"). Arrow keys move between
// items, Escape closes and returns focus to the trigger.
// `text` adds a visible label next to the trigger icon.
// items: [{ label, icon: LucideIcon, onSelect, danger?, disabled? } | 'separator']
function Menu({ label, icon: TriggerIcon, text, items, align = 'end', triggerClassName = 'icon-btn' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const first = rootRef.current?.querySelector('[role="menuitem"]:not([disabled])');
    first?.focus();
    function onDocDown(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  function onMenuKey(e) {
    const entries = [...rootRef.current.querySelectorAll('[role="menuitem"]:not([disabled])')];
    const i = entries.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); entries[(i + 1) % entries.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); entries[(i - 1 + entries.length) % entries.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); entries[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); entries.at(-1)?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); triggerRef.current?.focus(); }
      setOpen(false);
    }
  }

  return (
    <div className="menu-root" ref={rootRef} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <TriggerIcon aria-hidden={text ? true : undefined} />
        {text && <span className="menu-trigger-text">{text}</span>}
      </button>
      {open && (
        <div id={menuId} className={`menu menu-${align}`} role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {items.map((item, idx) => {
            if (item === 'separator') return <div key={`sep-${idx}`} className="menu-sep" role="separator" />;
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`menu-item${item.danger ? ' menu-item-danger' : ''}`}
                disabled={item.disabled}
                onClick={() => { setOpen(false); item.onSelect(); }}
              >
                {Icon && <Icon aria-hidden="true" />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Menu;
