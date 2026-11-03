import { useEffect, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { History, X } from 'lucide-react';
import ConfirmDialog from '../ui/ConfirmDialog.jsx';
import Dialog from '../ui/Dialog.jsx';
import { useToast } from '../ui/Toast.jsx';
import { getDocumentVersion, listDocumentVersions, restoreDocumentVersion, saveDocumentVersion } from '../../data/documentsApi.js';
import { versionName } from '../../data/collabApi.js';
import { formatDateTime, plural } from '../../data/format.js';
import { previewExtensions } from './documentExtensions.js';
import '../collab/collab.css';

// A version's text, read-only, on a sheet as wide as its page.
function VersionPreview({ version, canRestore, onRestore, onClose }) {
  const editor = useEditor({ extensions: previewExtensions, content: version.content, editable: false });
  const m = version.page?.margins;
  return (
    <Dialog
      title={versionName(version)}
      description={`${formatDateTime(version.createdAt)} · ${version.author?.name || version.author?.email || 'Someone'} · ${plural(version.wordCount, 'word')}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          {canRestore && <button type="button" className="btn btn-primary" onClick={onRestore}>Restore this version</button>}
        </>
      }
    >
      <div className="doc-version-sheet" style={m ? { padding: `${Math.min(m.top, 48)}px ${Math.min(m.right, 48)}px` } : undefined}>
        {editor && <EditorContent editor={editor} />}
      </div>
    </Dialog>
  );
}

// Saved versions of the document, newest first. Anyone with access can
// open one; editors save named versions and restore them for everyone
// (what is there first is kept as a "Before restoring" version).
function DocumentHistoryPanel({ documentId, canEdit, refreshKey, onRestored, onClose }) {
  const toast = useToast();
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const load = () => listDocumentVersions(documentId).then(setVersions).catch((err) => setError(err.message || 'Could not load the history'));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, refreshKey]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await saveDocumentVersion(documentId, label.trim());
      setLabel('');
      toast.success('Version saved');
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not save a version');
    } finally {
      setSaving(false);
    }
  }

  async function open(v) {
    setLoadingId(v.id);
    try {
      setPreview(await getDocumentVersion(documentId, v.id));
    } catch (err) {
      toast.error(err.message || 'Could not open that version');
    } finally {
      setLoadingId(null);
    }
  }

  async function restore() {
    setConfirming(false);
    const name = versionName(preview);
    try {
      await restoreDocumentVersion(documentId, preview.id);
      setPreview(null);
      toast.success(`Restored “${name}”. What was there is kept as a version.`);
      onRestored();
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not restore that version');
    }
  }

  return (
    <div className="sheet">
      <header className="props-head">
        <h2 className="sheet-title"><History aria-hidden="true" />Version history</h2>
        <button type="button" className="icon-btn" aria-label="Close version history" onClick={onClose}><X /></button>
      </header>
      <div className="sheet-body">
        {canEdit && (
          <>
            <form className="vh-save" onSubmit={handleSave}>
              <input className="input" placeholder="Name this version (optional)" aria-label="Version name" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
              <button type="submit" className="btn btn-secondary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save version'}</button>
            </form>
            <p className="field-hint">Save also keeps a version automatically, at most every 10 minutes.</p>
          </>
        )}
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        {versions === null && !error && <p className="field-hint">Loading…</p>}
        {versions?.length === 0 && <p className="field-hint sheet-empty">No versions yet.{canEdit ? ' Save one to mark a point you can come back to.' : ''}</p>}
        <ul className="vh-list">
          {versions?.map((v) => (
            <li key={v.id}>
              <button type="button" className="vh-item" onClick={() => open(v)} aria-busy={loadingId === v.id || undefined}>
                <span className="vh-meta">
                  <span className={`vh-name is-${v.kind}`}>{versionName(v)}</span>
                  <span className="field-hint">{formatDateTime(v.createdAt)}</span>
                  <span className="field-hint">{v.author?.name || v.author?.email || 'Someone'} · {plural(v.wordCount, 'word')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {preview && !confirming && (
        <VersionPreview version={preview} canRestore={canEdit} onRestore={() => setConfirming(true)} onClose={() => setPreview(null)} />
      )}
      {confirming && preview && (
        <ConfirmDialog
          title={`Restore “${versionName(preview)}”?`}
          message="The document's text, page and layout are replaced with this version for everyone. What's there now is saved as a version first, so you can go back to it."
          confirmLabel="Restore"
          onConfirm={restore}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

export default DocumentHistoryPanel;
