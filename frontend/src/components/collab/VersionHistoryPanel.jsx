import { useEffect, useState } from 'react';
import { History, X } from 'lucide-react';
import ScaledSlide from '../ScaledSlide.jsx';
import ConfirmDialog from '../ui/ConfirmDialog.jsx';
import { useToast } from '../ui/Toast.jsx';
import { getVersion, listVersions, saveVersion, versionName } from '../../data/collabApi.js';
import { formatDateTime, plural } from '../../data/format.js';

// Saved versions of the presentation, newest first. Picking one previews
// its slides; Restore brings them back for everyone, after first saving
// what is there now, and Undo reverses it.
function VersionHistoryPanel({ deckId, onRestore, onClose, refreshKey }) {
  const toast = useToast();
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null); // full version with slides
  const [loadingId, setLoadingId] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const load = () => listVersions(deckId).then(setVersions).catch((err) => setError(err.message || 'Could not load the history'));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, refreshKey]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await saveVersion(deckId, label.trim());
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
    if (preview?.id === v.id) return;
    setLoadingId(v.id);
    try {
      setPreview(await getVersion(deckId, v.id));
    } catch (err) {
      toast.error(err.message || 'Could not open that version');
    } finally {
      setLoadingId(null);
    }
  }

  async function restore() {
    setConfirming(false);
    try {
      await saveVersion(deckId, `Before restoring “${versionName(preview)}”`, 'restore');
      onRestore(preview);
      toast.success(`Restored “${versionName(preview)}”. Undo brings back what was there.`);
      setPreview(null);
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
        <form className="vh-save" onSubmit={handleSave}>
          <input className="input" placeholder="Name this version (optional)" aria-label="Version name" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save version'}</button>
        </form>
        <p className="field-hint">Save also keeps a version automatically, at most every 10 minutes.</p>

        {preview && (
          <section className="vh-preview" aria-label={`Preview of ${versionName(preview)}`}>
            <div className="vh-preview-head">
              <strong>{versionName(preview)}</strong>
              <span className="field-hint">{formatDateTime(preview.createdAt)} · {plural(preview.slideCount, 'slide')}</span>
            </div>
            <div className="vh-strip">
              {preview.slides.map((s, i) => <ScaledSlide key={s.id || i} slide={s} className="vh-strip-slide" label={`Slide ${i + 1}`} />)}
            </div>
            <div className="vh-preview-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>Close preview</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setConfirming(true)}>Restore this version</button>
            </div>
          </section>
        )}

        {error && <p className="alert alert-error" role="alert">{error}</p>}
        {versions === null && !error && <p className="field-hint">Loading…</p>}
        {versions?.length === 0 && <p className="field-hint sheet-empty">No versions yet. Save one to mark a point you can come back to.</p>}
        <ul className="vh-list">
          {versions?.map((v) => (
            <li key={v.id}>
              <button type="button" className={`vh-item${preview?.id === v.id ? ' is-on' : ''}`} onClick={() => open(v)} aria-busy={loadingId === v.id || undefined}>
                {v.thumbnail ? <ScaledSlide slide={v.thumbnail} className="vh-thumb" /> : <span className="vh-thumb is-empty" />}
                <span className="vh-meta">
                  <span className={`vh-name is-${v.kind}`}>{versionName(v)}</span>
                  <span className="field-hint">{formatDateTime(v.createdAt)}</span>
                  <span className="field-hint">{v.author?.name || v.author?.email || 'Someone'} · {plural(v.slideCount, 'slide')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {confirming && preview && (
        <ConfirmDialog
          title={`Restore “${versionName(preview)}”?`}
          message="Every slide is replaced with this version for everyone editing. What's there now is saved as a version first, and Undo reverses the restore."
          confirmLabel="Restore"
          onConfirm={restore}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

export default VersionHistoryPanel;
