import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import AppShell from '../components/layout/AppShell.jsx';
import ImportDialog from '../components/imports/ImportDialog.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import ImportRow from '../components/imports/ImportRow.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { deleteImport, listImports } from '../data/importsApi.js';
import './DecksPage.css';

// Every file the user imported, kept so they can come back to the
// analysis and make more presentations without re-uploading.
function DocumentsPage() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setItems(await listImports());
    } catch (err) {
      setError(err.message || 'Could not load your documents');
    } finally {
      setLoading(false);
    }
  }

  async function confirmDelete() {
    await deleteImport(deleteTarget.id);
    setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id));
    toast.success(`Removed “${deleteTarget.title}”`);
    setDeleteTarget(null);
  }

  return (
    <AppShell>
      <div className="documents-page">
        <header className="dash-head">
          <div>
            <h1>Documents</h1>
            <p className="dash-sub">Files you imported, with their analysis and outline. Create more presentations from them any time.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setImportOpen(true)}><Upload /> Import a file</button>
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
        ) : !error && items.length === 0 ? (
          <div className="dash-empty">
            <h2>No imported documents yet</h2>
            <p>Import a Word document, PowerPoint or PDF. PreSync analyses its structure and suggests slides you can review.</p>
            <button type="button" className="btn btn-primary" onClick={() => setImportOpen(true)}><Upload /> Import a file</button>
          </div>
        ) : (
          <ul className="import-list">
            {items.map((item) => <ImportRow key={item.id} item={item} onDelete={setDeleteTarget} />)}
          </ul>
        )}
      </div>

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete this import?"
          message={`The analysis and outline of “${deleteTarget.title}” will be deleted. Presentations you already made from it are kept.`}
          confirmLabel="Delete import"
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </AppShell>
  );
}

export default DocumentsPage;
