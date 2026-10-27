import { useEffect, useId, useRef, useState } from 'react';
import './ui.css';

// A button that opens a panel of arbitrary content (a colour grid, a
// font list, a size picker). Escape or a click outside closes it and
// focus returns to the trigger. `children` may be a function receiving
// `close`, for content that closes itself after a pick.
function Popover({ label, trigger, children, align = 'start', className = '', triggerClassName = 'icon-btn', panelClassName = '', tip, disabled, onOpenChange }) {
  const [open, setOpenState] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();
  const setOpen = (v) => {
    setOpenState(v);
    onOpenChange?.(v);
  };

  useEffect(() => {
    if (!open) return undefined;
    function onDocDown(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={`popover-root ${className}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={label}
        data-tip={tip}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        // Keep a text selection on the canvas while the panel opens.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          className={`popover popover-${align} ${panelClassName}`}
          role="dialog"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export default Popover;
