import { useState } from 'react';
import Dialog from '../ui/Dialog.jsx';
import { renameDeck } from '../../data/decksApi.js';

const MAX_TITLE = 200;

function RenameDeckDialog({ deckId, currentTitle, onClose, onRenamed }) {
  const [title, setTitle] = useState(currentTitle || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const value = title.trim();
    if (!value) { setError('Give the presentation a name.'); return; }
    setBusy(true);
    setError('');
    try {
      const updated = await renameDeck(deckId, value);
      onRenamed(updated);
    } catch (err) {
      setError(err.message || 'Could not rename');
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Rename presentation"
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="rename-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Rename'}
          </button>
        </>
      }
    >
      <form id="rename-form" className="field" onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="rename-title">Name</label>
        <input
          id="rename-title"
          className="input"
          value={title}
          maxLength={MAX_TITLE}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={(e) => e.target.select()}
          data-autofocus
          aria-invalid={error ? 'true' : undefined}
        />
        {error && <p className="field-hint" style={{ color: 'var(--error)' }} role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}

export default RenameDeckDialog;
