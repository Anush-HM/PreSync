import { useState } from 'react';
import Dialog from '../ui/Dialog.jsx';
import { saveDeckAsTemplate } from '../../data/templatesApi.js';

// Saves the open presentation (with everyone's latest edits) as one of
// the user's private templates.
function SaveTemplateDialog({ deckId, defaultName, onClose, onSaved }) {
  const [name, setName] = useState(defaultName || '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Give the template a name.'); return; }
    setBusy(true);
    setError('');
    try {
      onSaved(await saveDeckAsTemplate(deckId, name.trim(), description.trim()));
    } catch (err) {
      setError(err.message || 'Could not save the template');
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Save as template"
      description="New presentations can start from a copy of these slides. Only you can see your templates."
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="save-template-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save template'}</button>
        </>
      }
    >
      <form id="save-template-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
        <div className="field">
          <label className="field-label" htmlFor="template-name">Name</label>
          <input id="template-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-autofocus aria-invalid={error ? 'true' : undefined} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="template-desc">Description <span className="field-hint">(optional)</span></label>
          <input id="template-desc" className="input" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <p className="field-hint" style={{ color: 'var(--error)' }} role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}

export default SaveTemplateDialog;
