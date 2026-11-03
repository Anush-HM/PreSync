import { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import Dialog from '../ui/Dialog.jsx';
import Avatar from '../ui/Avatar.jsx';
import { useToast } from '../ui/Toast.jsx';
import { removeDocumentShare, shareDocument, updateDocumentShare } from '../../data/documentsApi.js';
import '../decks/decks.css';

const ROLE_LABELS = { editor: 'Can edit', viewer: 'Can view' };

// Who has a Word document. The owner adds people by email, to edit or
// only to view, changes that, and removes them; everyone else sees the
// list. `sharing` is { owner, people } from the document.
function DocumentShareDialog({ documentId, title, sharing, isOwner, onClose, onChanged }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action, success) {
    setError('');
    setBusy(true);
    try {
      onChanged(await action());
      if (success) toast.success(success);
      return true;
    } catch (err) {
      setError(err.message || 'Could not change who has access');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function invite(e) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    const ok = await run(() => shareDocument(documentId, value, role), `${value} can now ${role === 'viewer' ? 'view' : 'edit'} this document`);
    if (ok) setEmail('');
  }

  const name = (p) => p?.name || p?.email || 'Someone';

  return (
    <Dialog
      title="Share document"
      description={title ? `People with access see “${title}” update live as it is edited.` : undefined}
      onClose={onClose}
      footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Done</button>}
    >
      {isOwner ? (
        <form className="share-form" onSubmit={invite}>
          <label className="sr-only" htmlFor="doc-share-email">Email</label>
          <input
            id="doc-share-email"
            className="input"
            type="email"
            placeholder="teammate@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-autofocus
            aria-invalid={error ? 'true' : undefined}
          />
          <label className="sr-only" htmlFor="doc-share-role">Access</label>
          <select id="doc-share-role" className="select doc-share-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>
            <UserPlus /> {busy ? 'Sharing…' : 'Share'}
          </button>
        </form>
      ) : (
        <p className="field-hint">Only the owner can change who has access.</p>
      )}
      {isOwner && <p className="field-hint share-hint">They need a PreSync account with that email. People who can view follow along live and can download, but cannot change anything.</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <ul className="share-list" aria-label="People with access">
        {sharing?.owner && (
          <li className="share-row">
            <Avatar person={sharing.owner} size={32} />
            <div className="share-person">
              <span>{name(sharing.owner)}</span>
              {sharing.owner.name && <span className="share-email">{sharing.owner.email}</span>}
            </div>
            <span className="badge badge-success">Owner</span>
          </li>
        )}
        {(sharing?.people || []).map((p) => (
          <li key={p.id} className="share-row">
            <Avatar person={p} size={32} />
            <div className="share-person">
              <span>{name(p)}</span>
              {p.name && <span className="share-email">{p.email}</span>}
            </div>
            {isOwner ? (
              <>
                <label className="sr-only" htmlFor={`doc-role-${p.id}`}>{`Access for ${name(p)}`}</label>
                <select
                  id={`doc-role-${p.id}`}
                  className="select doc-share-role"
                  value={p.role}
                  disabled={busy}
                  onChange={(e) => run(() => updateDocumentShare(documentId, p.id, e.target.value), `${name(p)} can now ${e.target.value === 'viewer' ? 'view' : 'edit'}`)}
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${name(p)}`}
                  data-tip="Remove access"
                  disabled={busy}
                  onClick={() => run(() => removeDocumentShare(documentId, p.id), `Removed ${name(p)}`)}
                >
                  <X />
                </button>
              </>
            ) : (
              <span className="badge">{ROLE_LABELS[p.role]}</span>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export default DocumentShareDialog;
