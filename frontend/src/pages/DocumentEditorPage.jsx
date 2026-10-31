import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import { ArrowLeft, Download, FileDown, FileText, RotateCcw, Save, X } from 'lucide-react';
import Logo from '../components/ui/Logo.jsx';
import Menu from '../components/ui/Menu.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import DocumentToolbar from '../components/documents/DocumentToolbar.jsx';
import PageSheets from '../components/documents/PageSheets.jsx';
import { PageBorderDialog, PageNumbersDialog } from '../components/documents/PageDialogs.jsx';
import { PAGE_GAP } from '../components/documents/pageLayout.js';
import { documentExtensions, fontsIn } from '../components/documents/documentExtensions.js';
import { readImage } from '../components/documents/documentImages.js';
import { downloadDocument, getDocument, updateDocument } from '../data/documentsApi.js';
import { loadFont } from '../data/fonts.js';
import { plural } from '../data/format.js';
import { DEFAULT_FONT_FAMILY } from '../data/slideFormat.js';
import './DocumentEditorPage.css';

const AUTOSAVE_MS = 1200;
const PAGE_SIZES = [
  { id: 'letter', label: 'Letter', width: 816, height: 1056 },
  { id: 'a4', label: 'A4', width: 794, height: 1123 }
];
const STATUS = { saved: 'All changes saved', dirty: 'Unsaved changes', saving: 'Saving…', error: 'Could not save' };

function pageSizeId(page) {
  return PAGE_SIZES.find((p) => Math.abs(p.width - page.width) < 4 && Math.abs(p.height - page.height) < 4)?.id || 'custom';
}

function DocumentCanvas({ document: doc, title, onChange, onReady, onLayoutChange }) {
  const toast = useToast();
  const insertFiles = useCallback((view, files, pos) => {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    images.forEach(async (file) => {
      try {
        const attrs = await readImage(file, view.dom.clientWidth);
        const node = view.state.schema.nodes.image.create(attrs);
        view.dispatch(view.state.tr.insert(pos ?? view.state.selection.to, node));
      } catch (err) {
        toast.error(err.message);
      }
    });
    return images.length > 0;
  }, [toast]);

  const editor = useEditor({
    extensions: documentExtensions,
    content: doc.content,
    editorProps: {
      attributes: { class: 'doc-prose', 'aria-label': 'Document text', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' },
      handlePaste: (view, event) => insertFiles(view, event.clipboardData?.files || []),
      handleDrop: (view, event, slice, moved) => {
        if (moved) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        return insertFiles(view, event.dataTransfer?.files || [], at?.pos);
      }
    },
    onCreate: ({ editor: e }) => onReady(e),
    onUpdate: ({ editor: e }) => onChange(e)
  });

  if (!editor) return null;
  return <DocumentSurface editor={editor} page={doc.page} layout={doc.layout} title={title} onLayoutChange={onLayoutChange} />;
}

function DocumentSurface({ editor, page, layout, title, onLayoutChange }) {
  const [pages, setPages] = useState(1);
  const [editingPage, setEditingPage] = useState(null);
  const [dialog, setDialog] = useState(null); // 'numbers' | 'border'

  useEffect(() => {
    const { storage } = editor;
    storage.pagination.geometry = { pageHeight: page.height, gap: PAGE_GAP, marginTop: page.margins.top, marginBottom: page.margins.bottom };
    storage.pagination.onPages = setPages;
    storage.pagination.repaginate?.();
    return () => { storage.pagination.onPages = null; };
  }, [editor, page]);

  // Header and footer fields take the keyboard while they are open.
  useEffect(() => {
    editor.setEditable(editingPage === null, false);
  }, [editor, editingPage]);

  // A click on a margin or a gap puts the cursor in the nearest text. A
  // double click there is for the header or footer instead.
  function placeCursor(e) {
    if (e.detail > 1) return;
    if (e.target.closest('.ProseMirror') && !e.target.closest('.doc-page-spacer, .doc-page-spacer-row')) return;
    if (!e.target.closest('.doc-sheets')) return;
    e.preventDefault();
    const box = editor.view.dom.getBoundingClientRect();
    const left = Math.max(box.left + 1, Math.min(box.right - 1, e.clientX));
    const top = Math.max(box.top + 1, Math.min(box.bottom - 1, e.clientY));
    let at = null;
    try {
      at = editor.view.posAtCoords({ left, top });
    } catch {
      // No layout to ask: fall through to the end of the text.
    }
    editor.commands.focus(at ? at.pos : 'end');
  }

  return (
    <>
      <DocumentToolbar
        editor={editor}
        onPageNumbers={() => setDialog('numbers')}
        onHeaderFooter={() => setEditingPage(0)}
        onPageBorder={() => setDialog('border')}
        hasBorder={!!layout.pageBorder}
      />
      <PageSheets
        page={page}
        pages={pages}
        layout={layout}
        title={title}
        editingPage={editingPage}
        onEditPage={setEditingPage}
        onLayoutChange={onLayoutChange}
        onSurfaceDown={placeCursor}
      >
        <div style={{ fontFamily: DEFAULT_FONT_FAMILY }}><EditorContent editor={editor} /></div>
      </PageSheets>
      <footer className="doc-footer"><span className="mono">{plural(pages, 'page')}</span></footer>
      {dialog === 'numbers' && (
        <PageNumbersDialog
          numbers={layout.pageNumbers}
          onClose={() => setDialog(null)}
          onApply={(pageNumbers) => { onLayoutChange({ ...layout, pageNumbers }); setDialog(null); }}
        />
      )}
      {dialog === 'border' && (
        <PageBorderDialog
          border={layout.pageBorder}
          onClose={() => setDialog(null)}
          onApply={(pageBorder) => { onLayoutChange({ ...layout, pageBorder }); setDialog(null); }}
        />
      )}
    </>
  );
}

// The Word document editor. Saves on its own a moment after each change,
// and before every download so the file has the latest edits.
function DocumentEditorPage() {
  const { id } = useParams();
  const toast = useToast();

  const [doc, setDoc] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState('');
  const [page, setPage] = useState(null);
  const [layout, setLayout] = useState(null);
  const [status, setStatus] = useState('saved');
  const [wordCount, setWordCount] = useState(0);
  const [notesOpen, setNotesOpen] = useState(true);
  const [exporting, setExporting] = useState(null);

  const editorRef = useRef(null);
  const pending = useRef({}); // { title?, page?, content?: true } waiting to be sent
  const timer = useRef(null);
  const saving = useRef(null); // the save in flight

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const data = await getDocument(id);
      fontsIn(data.content).forEach(loadFont);
      setDoc(data);
      setTitle(data.title);
      setPage(data.page);
      setLayout(data.layout);
      setWordCount(data.wordCount || 0);
    } catch (err) {
      setLoadError(err.message || 'Could not load this document');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current) await saving.current;
    const fields = pending.current;
    if (!Object.keys(fields).length) return true;
    pending.current = {};
    const { content, ...rest } = fields;
    const patch = { ...rest, ...(content ? { content: editorRef.current?.getJSON() } : {}) };
    setStatus('saving');
    const attempt = updateDocument(id, patch).then(
      (saved) => {
        setWordCount(saved.wordCount ?? 0);
        setStatus(Object.keys(pending.current).length ? 'dirty' : 'saved');
        return true;
      },
      (err) => {
        // Keep what failed, so the next save sends it again.
        pending.current = { ...fields, ...pending.current };
        setStatus('error');
        toast.error(err.message || 'Could not save this document');
        return false;
      }
    );
    saving.current = attempt;
    const ok = await attempt;
    saving.current = null;
    return ok && (Object.keys(pending.current).length ? flush() : true);
  }, [id, toast]);

  const schedule = useCallback((fields) => {
    pending.current = { ...pending.current, ...fields };
    setStatus('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  }, [flush]);

  // Leaving the page saves what is left; closing the tab warns if it can't.
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (Object.keys(pending.current).length) flush();
  }, [flush]);

  useEffect(() => {
    if (status === 'saved') return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flush();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flush]);

  function commitTitle() {
    const next = title.trim();
    if (!next) {
      setTitle(doc.title);
      return;
    }
    setTitle(next);
    if (next !== doc.title) {
      setDoc((d) => ({ ...d, title: next }));
      schedule({ title: next });
    }
  }

  function changePageSize(sizeId) {
    const size = PAGE_SIZES.find((p) => p.id === sizeId);
    const next = { ...page, width: size.width, height: size.height };
    setPage(next);
    schedule({ page: next });
  }

  async function handleExport(format) {
    setExporting(format);
    try {
      if (!(await flush())) return;
      await downloadDocument(id, format, title);
    } catch (err) {
      toast.error(err.message || 'Could not download this document');
    } finally {
      setExporting(null);
    }
  }

  const liveDoc = useMemo(() => (doc && page && layout ? { ...doc, page, layout } : null), [doc, page, layout]);
  const onContentChange = useCallback(() => schedule({ content: true }), [schedule]);
  const onLayoutChange = useCallback((next) => {
    setLayout(next);
    schedule({ layout: next });
  }, [schedule]);
  const onEditorReady = useCallback((editor) => { editorRef.current = editor; }, []);

  if (loadError) {
    return (
      <div className="doc-editor doc-editor-message">
        <p className="alert alert-error" role="alert">{loadError}</p>
        <div className="doc-editor-message-actions">
          <button type="button" className="btn btn-secondary" onClick={load}><RotateCcw /> Retry</button>
          <Link to="/documents" className="btn btn-ghost">Back to documents</Link>
        </div>
      </div>
    );
  }

  if (!liveDoc) {
    return (
      <div className="doc-editor doc-editor-message" aria-busy="true">
        <div className="skeleton" style={{ height: 28, width: 280 }} />
        <div className="skeleton" style={{ height: 420, width: 'min(600px, 100%)', marginTop: 16 }} />
      </div>
    );
  }

  const exportItems = [
    { label: 'Download as .docx', icon: FileText, onSelect: () => handleExport('docx') },
    { label: 'Download as PDF', icon: FileDown, onSelect: () => handleExport('pdf') }
  ];

  return (
    <div className="doc-editor">
      <header className="doc-header">
        <Link to="/documents" className="icon-btn" aria-label="Back to documents" data-tip="Back to documents"><ArrowLeft /></Link>
        <Logo to="/decks" />
        <input
          className="doc-title"
          aria-label="Document title"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setTitle(doc.title);
              e.currentTarget.blur();
            }
          }}
        />
        <span className={`doc-status${status === 'error' ? ' is-error' : ''}`} role="status">{STATUS[status]}</span>
        <span className="doc-header-spacer" />
        <label className="doc-page-size">
          <span className="sr-only">Page size</span>
          <select className="select" value={pageSizeId(page)} onChange={(e) => changePageSize(e.target.value)}>
            {pageSizeId(page) === 'custom' && <option value="custom" disabled>Custom page</option>}
            {PAGE_SIZES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={flush} disabled={status === 'saved' || status === 'saving'}>
          <Save /> Save
        </button>
        <Menu label={exporting ? 'Preparing download…' : 'Export'} icon={Download} text={exporting ? 'Preparing…' : 'Export'} triggerClassName="btn btn-primary btn-sm" items={exportItems} />
      </header>

      {notesOpen && doc.importNotes?.length > 0 && (
        <div className="alert doc-import-notes" role="status">
          <div>
            <strong>Imported with some changes</strong>
            <ul>{doc.importNotes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Dismiss import notes" onClick={() => setNotesOpen(false)}><X /></button>
        </div>
      )}

      <DocumentCanvas document={liveDoc} title={title} onChange={onContentChange} onReady={onEditorReady} onLayoutChange={onLayoutChange} />

      <p className="doc-word-count mono">{plural(wordCount, 'word')}</p>
    </div>
  );
}

export default DocumentEditorPage;
