import { useEffect, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import Dialog from '../ui/Dialog.jsx';
import Avatar from '../ui/Avatar.jsx';
import { useToast } from '../ui/Toast.jsx';
import { addCollaborator, getDeck, removeCollaborator } from '../../data/decksApi.js';
import './decks.css';

// Owner invites co-editors by email; everyone else sees who has access.
// `deck` may already carry owner/collaborators (editor), otherwise they
// are fetched.
function ShareDeckDialog({ deckId, deckTitle, initialMeta, onClose, onChanged }) {
  const toast = useToast();
  const [meta, setMeta] = useState(initialMeta || null);
  const [loadError, setLoadError] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialMeta) return;
    let cancelled = false;
    getDeck(deckId)
      .then((d) => { if (!cancelled) setMeta(d); })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Could not load sharing details'); });
    return () => { cancelled = true; };
  }, [deckId, initialMeta]);

  function apply(updated) {
    setMeta(updated);
    onChanged?.(updated);
  }

  async function handleInvite(e) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    setError('');
    try {
      apply(await addCollaborator(deckId, value));
      setEmail('');
      toast.success(`${value} can now edit this presentation`);
    } catch (err) {
      setError(err.message || 'Could not add that collaborator');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(person) {
    setError('');
    try {
      apply(await removeCollaborator(deckId, person.id));
      toast.success(`Removed ${person.name || person.email}`);
    } catch (err) {
      setError(err.message || 'Could not remove that collaborator');
    }
  }

  const isOwner = !!meta?.isOwner;

  return (
    <Dialog
      title="Share presentation"
      description={deckTitle ? `People with access can co-edit “${deckTitle}” in real time.` : undefined}
      onClose={onClose}
      footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Done</button>}
    >
      {loadError && <p className="alert alert-error" role="alert">{loadError}</p>}
      {!meta && !loadError && <div className="skeleton" style={{ height: 88 }} />}

      {meta && (
        <>
          {isOwner ? (
            <form className="share-form" onSubmit={handleInvite}>
              <label className="sr-only" htmlFor="share-email">Collaborator email</label>
              <input
                id="share-email"
                className="input"
                type="email"
                placeholder="teammate@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-autofocus
                aria-invalid={error ? 'true' : undefined}
              />
              <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>
                <UserPlus /> {busy ? 'Inviting…' : 'Invite'}
              </button>
            </form>
          ) : (
            <p className="field-hint">Only the owner can invite or remove collaborators.</p>
          )}
          <p className="field-hint share-hint">They need a PreSync account with that email.</p>
          {error && <p className="alert alert-error" role="alert">{error}</p>}

          <ul className="share-list" aria-label="People with access">
            <li className="share-row">
              <Avatar person={meta.owner} size={32} />
              <div className="share-person">
                <span>{meta.owner?.name || meta.owner?.email}</span>
                {meta.owner?.name && <span className="share-email">{meta.owner.email}</span>}
              </div>
              <span className="badge badge-success">Owner</span>
            </li>
            {(meta.collaborators || []).map((c) => (
              <li key={c.id} className="share-row">
                <Avatar person={c} size={32} />
                <div className="share-person">
                  <span>{c.name || c.email}</span>
                  {c.name && <span className="share-email">{c.email}</span>}
                </div>
                <span className="badge">Editor</span>
                {isOwner && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${c.name || c.email}`}
                    data-tip="Remove access"
                    onClick={() => handleRemove(c)}
                  >
                    <X />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}

export default ShareDeckDialog;
