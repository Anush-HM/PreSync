import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import './ui.css';

const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, warning: AlertTriangle, error: XCircle, info: Info };

// App-wide toast notifications. useToast() returns { success, error,
// warning, info }; each takes a message and an optional duration.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind, message, duration = 4200) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, kind, message }]);
    if (duration > 0) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (m, d) => push('success', m, d),
    error: (m, d) => push('error', m, d ?? 6000),
    warning: (m, d) => push('warning', m, d),
    info: (m, d) => push('info', m, d),
    dismiss
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="region" aria-label="Notifications">
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
              <Icon aria-hidden="true" />
              <span className="toast-msg">{t.message}</span>
              <button type="button" className="icon-btn toast-close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
                <X />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

const NOOP = { success() {}, error() {}, warning() {}, info() {}, dismiss() {} };

// Components rendered outside the provider (some unit tests) get a no-op.
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(ToastContext) || NOOP;
}
