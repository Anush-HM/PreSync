import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Upload } from 'lucide-react';
import AppShell from '../components/layout/AppShell.jsx';
import DocumentRow from '../components/documents/DocumentRow.jsx';
import ImportDialog from '../components/imports/ImportDialog.jsx';
import ImportRow from '../components/imports/ImportRow.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import Dialog from '../components/ui/Dialog.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { createDocument, deleteDocument, downloadDocument, listDocuments, updateDocument } from '../data/documentsApi.js';
import { deleteImport, listImports } from '../data/importsApi.js';
import './DecksPage.css';

function RenameDialog({ item, onClose, onRenamed }) {
  const [title, setTitle] = useState(item.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    const next = title.trim();
    if (!next) return;
    setBusy(true);
    try {
      onRenamed(await updateDocument(item.id, { title: next }));
    } catch (err) {
      setError(err.message || 'Could not rename this document');
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Rename document"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="rename-document" className="btn btn-primary" disabled={busy || !title.trim()}>Rename</button>
        </>
      }
    >
      <form id="rename-document" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        </label>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}

// The user's Word documents, and below them the PowerPoint and PDF files
// they imported, which are kept for making more presentations.
function DocumentsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [documents, setDocuments] = useState([]);
  const [imports, setImports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteImportTarget, setDeleteImportTarget] = useState(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [docs, files] = await Promise.all([listDocuments(), listImports()]);
      setDocuments(docs);
      setImports(files);
    } catch (err) {
      setError(err.message || 'Could not load your documents');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const doc = await createDocument();
      navigate(`/documents/${doc.id}`);
    } catch (err) {
      toast.error(err.message || 'Could not create a document');
      setCreating(false);
    }
  }

  async function handleDownload(item, format) {
    try {
      await downloadDocument(item.id, format, item.title);
    } catch (err) {
      toast.error(err.message || 'Could not download this document');
    }
  }

  function handleRenamed(updated) {
    setDocuments((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
    toast.success('Document renamed');
    setRenameTarget(null);
  }

  async function confirmDelete() {
    await deleteDocument(deleteTarget.id);
    setDocuments((prev) => prev.filter((d) => d.id !== deleteTarget.id));
    toast.success(`Deleted “${deleteTarget.title}”`);
    setDeleteTarget(null);
  }

  async function confirmDeleteImport() {
    await deleteImport(deleteImportTarget.id);
    setImports((prev) => prev.filter((i) => i.id !== deleteImportTarget.id));
    toast.success(`Removed “${deleteImportTarget.title}”`);
    setDeleteImportTarget(null);
  }

  return (
    <AppShell>
      <div className="documents-page">
        <header className="dash-head">
          <div>
            <h1>Documents</h1>
            <p className="dash-sub">Write and edit Word documents, then download them as .docx or PDF.</p>
          </div>
          <div className="dash-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}><Upload /> Import Word document</button>
            <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={creating}>
              <Plus /> {creating ? 'Creating…' : 'New Word document'}
            </button>
          </div>
        </header>

        {error && (
          <div className="alert alert-error" role="alert" style={{ alignItems: 'center' }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={refresh}>Retry</button>
          </div>
        )}

        {loading ? (
          <div className="import-list" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 66, borderRadius: 12 }} />)}
          </div>
        ) : !error && documents.length === 0 ? (
          <div className="dash-empty">
            <h2>No Word documents yet</h2>
            <p>Start a blank document, or import a .docx and keep editing it here.</p>
            <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={creating}><Plus /> New Word document</button>
          </div>
        ) : (
          <ul className="import-list" aria-label="Word documents">
            {documents.map((item) => (
              <DocumentRow key={item.id} item={item} onRename={setRenameTarget} onDownload={handleDownload} onDelete={setDeleteTarget} />
            ))}
          </ul>
        )}

        {!loading && imports.length > 0 && (
          <section className="dash-section" aria-labelledby="imported-files-title">
            <div className="dash-section-head">
              <h2 id="imported-files-title">Imported files</h2>
            </div>
            <ul className="import-list">
              {imports.map((item) => <ImportRow key={item.id} item={item} onDelete={setDeleteImportTarget} />)}
            </ul>
          </section>
        )}
      </div>

      {importOpen && <ImportDialog kind="docx" onClose={() => setImportOpen(false)} />}
      {renameTarget && <RenameDialog item={renameTarget} onClose={() => setRenameTarget(null)} onRenamed={handleRenamed} />}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete document?"
          message={`“${deleteTarget.title}” will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete document"
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {deleteImportTarget && (
        <ConfirmDialog
          title="Delete this import?"
          message={`The analysis and outline of “${deleteImportTarget.title}” will be deleted. Presentations you already made from it are kept.`}
          confirmLabel="Delete import"
          destructive
          onConfirm={confirmDeleteImport}
          onCancel={() => setDeleteImportTarget(null)}
        />
      )}
    </AppShell>
  );
}

export default DocumentsPage;
