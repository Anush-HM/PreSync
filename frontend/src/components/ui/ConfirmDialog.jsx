import { useState } from 'react';
import Dialog from './Dialog.jsx';

// Confirmation for anything that can't be undone. The confirm button is
// crimson when `destructive`, and stays busy while onConfirm runs.
function ConfirmDialog({ title, message, confirmLabel = 'Confirm', destructive = false, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (err) {
      setError(err.message || 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={title}
      onClose={busy ? undefined : onCancel}
      dismissible={!busy}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleConfirm}
            disabled={busy}
            data-autofocus
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="dialog-text">{message}</p>
      {error && <p className="alert alert-error" role="alert" style={{ marginTop: 14 }}>{error}</p>}
    </Dialog>
  );
}

export default ConfirmDialog;
