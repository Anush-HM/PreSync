import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import { ArrowLeft, Download, Eye, FileDown, FileText, History, MessageSquare, RotateCcw, Save, Share2, X } from 'lucide-react';
import Logo from '../components/ui/Logo.jsx';
import Menu from '../components/ui/Menu.jsx';
import { AvatarStack } from '../components/ui/Avatar.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import DocumentToolbar from '../components/documents/DocumentToolbar.jsx';
import DocumentCommentsPanel from '../components/documents/DocumentCommentsPanel.jsx';
import DocumentHistoryPanel from '../components/documents/DocumentHistoryPanel.jsx';
import DocumentShareDialog from '../components/documents/DocumentShareDialog.jsx';
import PageSheets from '../components/documents/PageSheets.jsx';
import { PageBorderDialog, PageNumbersDialog } from '../components/documents/PageDialogs.jsx';
import { PAGE_GAP } from '../components/documents/pageLayout.js';
import { buildDocumentExtensions, fontsIn } from '../components/documents/documentExtensions.js';
import { readImage } from '../components/documents/documentImages.js';
import { downloadDocument, getDocument, listDocumentComments, saveDocument, updateDocument } from '../data/documentsApi.js';
import { getCurrentUser } from '../data/apiConfig.js';
import { connectDocumentDoc } from '../data/yjsClient.js';
import { loadFont } from '../data/fonts.js';
import { plural } from '../data/format.js';
import { DEFAULT_FONT_FAMILY } from '../data/slideFormat.js';
import '../components/collab/collab.css';
import './DocumentEditorPage.css';

const AUTOSAVE_MS = 1200;
// How long to wait for the live connection before editing on our own.
const LIVE_TIMEOUT_MS = 5000;
const BORDER_CLEARANCE = 6;
const PAGE_SIZES = [
  { id: 'letter', label: 'Letter', width: 816, height: 1056 },
  { id: 'a4', label: 'A4', width: 794, height: 1123 }
];
const STATUS = {
  saved: 'All changes saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Could not save',
  offline: 'Reconnecting… your changes will sync',
  viewing: 'View only'
};
// Caret colours: #RRGGBB, readable on white paper.
const CARET_COLORS = ['#2F7D57', '#B5651D', '#3A6EA5', '#9C4A8B', '#6B7F2A', '#B03A48', '#4E5BA6'];

function caretColor(key) {
  let h = 0;
  const s = String(key);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CARET_COLORS[h % CARET_COLORS.length];
}

function pageSizeId(page) {
  return PAGE_SIZES.find((p) => Math.abs(p.width - page.width) < 4 && Math.abs(p.height - page.height) < 4)?.id || 'custom';
}

const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

// The ids of comment threads whose text is still in the document.
function commentIdsIn(doc) {
  const ids = new Set();
  doc.descendants((node) => {
    for (const m of node.marks) if (m.type.name === 'comment' && m.attrs.commentId) ids.add(m.attrs.commentId);
  });
  return ids;
}

function commentRange(doc, commentId) {
  let from = null;
  let to = null;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.marks.some((m) => m.type.name === 'comment' && m.attrs.commentId === commentId)) return;
    if (from === null) from = pos;
    to = pos + node.nodeSize;
  });
  return from === null ? null : { from, to };
}

function DocumentCanvas({ document: doc, title, readOnly, collab, onChange, onReady, onLayoutChange, onSelect, onCommentClick }) {
  const toast = useToast();
  const insertFiles = useCallback((view, files, pos) => {
    if (!view.editable) return false;
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
    extensions: buildDocumentExtensions(collab),
    // Live documents take their text from the shared copy instead.
    ...(collab ? {} : { content: doc.content }),
    editable: !readOnly,
    editorProps: {
      attributes: { class: 'doc-prose', 'aria-label': 'Document text', role: 'textbox', 'aria-multiline': 'true', 'aria-readonly': readOnly ? 'true' : 'false', spellcheck: 'true' },
      handlePaste: (view, event) => insertFiles(view, event.clipboardData?.files || []),
      handleDrop: (view, event, slice, moved) => {
        if (moved) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        return insertFiles(view, event.dataTransfer?.files || [], at?.pos);
      },
      handleClick: (view, pos) => {
        const mark = view.state.doc.resolve(pos).marks().find((m) => m.type.name === 'comment');
        if (mark) onCommentClick(mark.attrs.commentId);
        return false;
      }
    },
    // These can fire while the editor is being made, during this
    // component's render (the live copy fills it in), so the page's state
    // is updated just after.
    onCreate: ({ editor: e }) => onReady(e),
    onUpdate: ({ editor: e, transaction }) => queueMicrotask(() => onChange(e, transaction)),
    onSelectionUpdate: ({ editor: e }) => {
      const { from, to, empty } = e.state.selection;
      const picked = empty ? null : { text: e.state.doc.textBetween(from, to, ' ').trim() };
      queueMicrotask(() => onSelect(picked));
    }
  });

  if (!editor) return null;
  return <DocumentSurface editor={editor} page={doc.page} layout={doc.layout} title={title} readOnly={readOnly} onLayoutChange={onLayoutChange} />;
}

const NO_PAGE_EDIT = () => {};

function DocumentSurface({ editor, page, layout, title, readOnly, onLayoutChange }) {
  const [pages, setPages] = useState(1);
  const [editingPage, setEditingPage] = useState(null);
  const [dialog, setDialog] = useState(null); // 'numbers' | 'border'

  useEffect(() => {
    const { storage } = editor;
    // Text stops short of a bottom border that sits inside the margin.
    const border = layout.pageBorder;
    const borderEdge = border?.sides.bottom ? (border.inset + border.width) * (96 / 72) + BORDER_CLEARANCE : 0;
    storage.pagination.geometry = { pageHeight: page.height, gap: PAGE_GAP, marginTop: page.margins.top, marginBottom: Math.max(page.margins.bottom, borderEdge) };
    storage.pagination.onPages = setPages;
    storage.pagination.repaginate?.();
    return () => { storage.pagination.onPages = null; };
  }, [editor, page, layout.pageBorder]);

  // The page holding the cursor, from where it sits on the sheets.
  function currentPage() {
    const sheets = editor.view.dom.closest('.doc-sheets')?.getBoundingClientRect();
    if (!sheets) return 1;
    const top = editor.view.coordsAtPos(editor.state.selection.from).top - sheets.top;
    return Math.max(1, Math.min(pages, Math.floor(top / (page.height + PAGE_GAP)) + 1));
  }

  // Header and footer fields take the keyboard while they are open; a
  // document shared to view never takes it.
  useEffect(() => {
    editor.setEditable(!readOnly && editingPage === null, false);
  }, [editor, editingPage, readOnly]);

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
    // Without scrolling: the page must stay put for a second click to land.
    editor.commands.focus(at ? at.pos : 'end', { scrollIntoView: false });
  }

  return (
    <>
      {!readOnly && (
        <DocumentToolbar
          editor={editor}
          onPageNumbers={() => setDialog('numbers')}
          onHeaderFooter={() => setEditingPage(0)}
          onPageBorder={() => setDialog('border')}
          hasBorder={!!layout.pageBorder}
        />
      )}
      <PageSheets
        page={page}
        pages={pages}
        layout={layout}
        title={title}
        editingPage={readOnly ? null : editingPage}
        onEditPage={readOnly ? NO_PAGE_EDIT : setEditingPage}
        onLayoutChange={onLayoutChange}
        onSurfaceDown={readOnly ? undefined : placeCursor}
      >
        <div style={{ fontFamily: DEFAULT_FONT_FAMILY }}><EditorContent editor={editor} /></div>
      </PageSheets>
      <footer className="doc-footer"><span className="mono">{plural(pages, 'page')}</span></footer>
      {dialog === 'numbers' && (
        <PageNumbersDialog
          numbers={layout.pageNumbers}
          pages={pages}
          onClose={() => setDialog(null)}
          onApply={(pageNumbers) => { onLayoutChange({ ...layout, pageNumbers }); setDialog(null); }}
        />
      )}
      {dialog === 'border' && (
        <PageBorderDialog
          border={layout.pageBorder}
          pages={pages}
          currentPage={currentPage()}
          onClose={() => setDialog(null)}
          onApply={(pageBorder) => { onLayoutChange({ ...layout, pageBorder }); setDialog(null); }}
        />
      )}
    </>
  );
}

// The Word document editor. It opens the document's live shared copy, so
// everyone with access sees each other's changes, cursors and comments as
// they happen; people it is shared with to view follow along read-only.
// When the live connection cannot be made it edits on its own and saves
// over the API a moment after each change, and before every download.
function DocumentEditorPage() {
  const { id } = useParams();
  const toast = useToast();
  const me = useMemo(() => getCurrentUser(), []);

  const [doc, setDoc] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState('');
  const [page, setPage] = useState(null);
  const [layout, setLayout] = useState(null);
  const [status, setStatus] = useState('saved');
  const [wordCount, setWordCount] = useState(0);
  const [notesOpen, setNotesOpen] = useState(true);
  const [exporting, setExporting] = useState(null);
  const [mode, setMode] = useState('connecting'); // 'connecting' | 'live' | 'solo'
  const [collab, setCollab] = useState(null);
  const [connection, setConnection] = useState('connecting');
  const [peers, setPeers] = useState([]);
  const [panel, setPanel] = useState(null); // 'comments' | 'history'
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(null);
  const [threads, setThreads] = useState([]);
  const [anchoredIds, setAnchoredIds] = useState(() => new Set());
  const [selection, setSelection] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [commentsRev, setCommentsRev] = useState(0);
  const [historyKey, setHistoryKey] = useState(0);

  const editorRef = useRef(null);
  const pending = useRef({}); // { title?, page?, layout?, content?: true } waiting to be sent (solo mode)
  const timer = useRef(null);
  const saving = useRef(null); // the save in flight
  const titleFocused = useRef(false);

  const role = doc?.role || (doc?.isOwner ? 'owner' : 'editor');
  const readOnly = role === 'viewer';
  const live = mode === 'live';

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const data = await getDocument(id);
      fontsIn(data.content).forEach(loadFont);
      setDoc(data);
      setSharing({ owner: data.owner, people: data.people || [] });
      setTitle(data.title);
      setPage(data.page);
      setLayout(data.layout);
      setWordCount(data.wordCount || 0);
      if (data.role === 'viewer') setStatus('viewing');
    } catch (err) {
      setLoadError(err.message || 'Could not load this document');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // --- live co-editing -------------------------------------------------

  const loadedId = doc?.id || null;
  const loadedRole = doc?.role;
  useEffect(() => {
    if (!loadedId) return undefined;
    const yjs = connectDocumentDoc(loadedId);
    let decided = false;
    const solo = () => {
      decided = true;
      yjs.disconnect();
      setMode('solo');
    };
    const fallback = setTimeout(() => { if (!decided) solo(); }, LIVE_TIMEOUT_MS);
    const off = yjs.onStatus((s) => {
      setConnection(s);
      // The owner changed what this person may do: start again with it.
      if (decided && (s === 'changed' || s === 'denied')) {
        window.location.reload();
        return;
      }
      if (decided) return;
      if (s === 'synced') {
        decided = true;
        clearTimeout(fallback);
        const name = me?.name || me?.email || 'Someone';
        setCollab({ doc: yjs.doc, awareness: yjs.awareness, user: { id: me?.id || null, name, color: caretColor(me?.id || me?.email || yjs.doc.clientID), role: loadedRole } });
        setMode('live');
      } else if (s === 'denied' || s === 'changed') {
        clearTimeout(fallback);
        solo();
      }
    });
    return () => {
      clearTimeout(fallback);
      off();
      yjs.disconnect();
    };
    // The connection belongs to the loaded document, not to later renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedId]);

  // Title, page, layout and comment changes from everyone.
  useEffect(() => {
    if (!collab) return undefined;
    const meta = collab.doc.getMap('meta');
    const apply = () => {
      const t = meta.get('title');
      if (typeof t === 'string' && t) {
        setDoc((d) => (d && d.title !== t ? { ...d, title: t } : d));
        if (!titleFocused.current) setTitle(t);
      }
      if (meta.get('page')) setPage(meta.get('page'));
      if (meta.get('layout')) setLayout(meta.get('layout'));
      setCommentsRev(meta.get('commentsRev') || 0);
    };
    apply();
    meta.observe(apply);
    return () => meta.unobserve(apply);
  }, [collab]);

  // Who else has the document open (one entry per person).
  useEffect(() => {
    if (!collab) return undefined;
    const { awareness } = collab;
    const sync = () => {
      const seen = new Map();
      awareness.getStates().forEach((state, clientId) => {
        const user = state?.user;
        if (clientId === awareness.clientID || !user?.name) return;
        if (user.id && user.id === me?.id) return;
        const key = user.id || `client-${clientId}`;
        if (!seen.has(key)) seen.set(key, { id: key, name: user.name, color: user.color, role: user.role });
      });
      setPeers([...seen.values()]);
    };
    awareness.on('change', sync);
    sync();
    return () => awareness.off('change', sync);
  }, [collab, me]);

  // --- saving (solo mode) ------------------------------------------------

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

  const shownStatus = readOnly ? 'viewing' : live ? (connection === 'synced' ? 'saved' : 'offline') : status;
  useEffect(() => {
    if (shownStatus === 'saved' || shownStatus === 'viewing') return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [shownStatus]);

  // Save: live documents are already on the server; this writes them to
  // the database now and keeps an automatic version now and then.
  const save = useCallback(async () => {
    if (readOnly) return true;
    if (!live) return flush();
    try {
      const result = await saveDocument(id);
      if (result?.versionId) setHistoryKey((k) => k + 1);
      toast.success('Saved');
      return true;
    } catch (err) {
      toast.error(err.message || 'Could not save this document');
      return false;
    }
  }, [readOnly, live, flush, id, toast]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // --- fields ------------------------------------------------------------

  const meta = collab?.doc.getMap('meta');

  function commitTitle() {
    titleFocused.current = false;
    const next = title.trim();
    if (!next || readOnly) {
      setTitle(doc.title);
      return;
    }
    setTitle(next);
    if (next !== doc.title) {
      setDoc((d) => ({ ...d, title: next }));
      if (meta) meta.set('title', next);
      else schedule({ title: next });
    }
  }

  function changePageSize(sizeId) {
    const size = PAGE_SIZES.find((p) => p.id === sizeId);
    const next = { ...page, width: size.width, height: size.height };
    setPage(next);
    if (meta) meta.set('page', next);
    else schedule({ page: next });
  }

  async function handleExport(format) {
    setExporting(format);
    try {
      // Live documents are written by the server before it builds the file.
      if (!live && !readOnly && !(await flush())) return;
      await downloadDocument(id, format, title);
    } catch (err) {
      toast.error(err.message || 'Could not download this document');
    } finally {
      setExporting(null);
    }
  }

  const liveDoc = useMemo(() => (doc && page && layout ? { ...doc, page, layout } : null), [doc, page, layout]);
  const onContentChange = useCallback((editor, transaction) => {
    setAnchoredIds(commentIdsIn(editor.state.doc));
    if (collab) {
      setWordCount(countWords(editor.getText({ blockSeparator: ' ' })));
      return;
    }
    if (transaction?.docChanged !== false) schedule({ content: true });
  }, [collab, schedule]);
  const onLayoutChange = useCallback((next) => {
    if (readOnly) return;
    setLayout(next);
    if (meta) meta.set('layout', next);
    else schedule({ layout: next });
  }, [readOnly, meta, schedule]);
  const onEditorReady = useCallback((editor) => {
    editorRef.current = editor;
    // The editor is made while its component renders: update state after.
    queueMicrotask(() => setAnchoredIds(commentIdsIn(editor.state.doc)));
  }, []);

  // --- comments ------------------------------------------------------------

  const refreshComments = useCallback(() => {
    listDocumentComments(id).then(setThreads).catch(() => {});
  }, [id]);
  useEffect(() => {
    if (loadedId) refreshComments();
  }, [loadedId, commentsRev, refreshComments]);

  const openThread = useCallback((thread) => {
    const editor = editorRef.current;
    setFocusId(thread.id);
    const range = editor && commentRange(editor.state.doc, thread.id);
    if (!range) return;
    editor.chain().setTextSelection(range).scrollIntoView().run();
    if (!readOnly) editor.commands.focus();
  }, [readOnly]);

  const onCommentClick = useCallback((commentId) => {
    setFocusId(commentId);
    setPanel('comments');
  }, []);

  const anchorComment = useCallback((commentId) => {
    editorRef.current?.chain().setComment(commentId).run();
    setFocusId(commentId);
  }, []);
  const unanchorComment = useCallback((commentId) => {
    editorRef.current?.commands.unsetCommentEverywhere(commentId);
  }, []);

  // Resolved threads stop highlighting their text; the one open in the
  // panel is highlighted more strongly.
  const commentCss = useMemo(() => {
    const rules = threads.filter((t) => t.resolved).map((t) => `.doc-prose .doc-comment[data-comment-id="${t.id}"]{background:none;border-bottom:0}`);
    if (focusId && !threads.some((t) => t.id === focusId && t.resolved)) rules.push(`.doc-prose .doc-comment[data-comment-id="${focusId}"]{background:rgba(232,183,58,.55)}`);
    return rules.join('\n');
  }, [threads, focusId]);

  // After a restore, a document that is not live loads the result itself.
  const afterRestore = useCallback(async () => {
    setHistoryKey((k) => k + 1);
    if (live) return;
    try {
      const data = await getDocument(id);
      pending.current = {};
      editorRef.current?.commands.setContent(data.content, { emitUpdate: false });
      setPage(data.page);
      setLayout(data.layout);
      setWordCount(data.wordCount || 0);
      setStatus('saved');
    } catch (err) {
      toast.error(err.message || 'Could not load the restored document');
    }
  }, [live, id, toast]);

  // --- render ------------------------------------------------------------

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

  if (!liveDoc || mode === 'connecting') {
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
  const openThreads = threads.filter((t) => !t.resolved).length;
  const togglePanel = (name) => setPanel((p) => (p === name ? null : name));
  const viewers = peers.filter((p) => p.role === 'viewer').length;
  const presenceLabel = peers.length === 1 ? `${peers[0].name} is here` : `${peers.length} others here`;

  return (
    <div className="doc-editor">
      {commentCss && <style>{commentCss}</style>}
      <header className="doc-header">
        <Link to="/documents" className="icon-btn" aria-label="Back to documents" data-tip="Back to documents"><ArrowLeft /></Link>
        <Logo to="/decks" />
        <input
          className="doc-title"
          aria-label="Document title"
          value={title}
          maxLength={200}
          readOnly={readOnly}
          onFocus={() => { titleFocused.current = true; }}
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
        {readOnly ? (
          <span className="badge doc-view-only" role="status"><Eye aria-hidden="true" /> View only</span>
        ) : (
          <span className={`doc-status${shownStatus === 'error' || shownStatus === 'offline' ? ' is-error' : ''}`} role="status">{STATUS[shownStatus]}</span>
        )}
        {peers.length > 0 && (
          <div className="ed-presence doc-presence" title={peers.map((p) => `${p.name}${p.role === 'viewer' ? ' (viewing)' : ''}`).join(', ')}>
            <AvatarStack people={peers} max={3} size={26} />
            <span className="ed-presence-label">{presenceLabel}{viewers ? ` · ${viewers} viewing` : ''}</span>
          </div>
        )}
        {mode === 'solo' && !readOnly && <span className="doc-solo-note" title="Others' changes appear after they reload. Your changes still save.">Live editing unavailable</span>}
        <span className="doc-header-spacer" />
        <label className="doc-page-size">
          <span className="sr-only">Page size</span>
          <select className="select" value={pageSizeId(page)} disabled={readOnly} onChange={(e) => changePageSize(e.target.value)}>
            {pageSizeId(page) === 'custom' && <option value="custom" disabled>Custom page</option>}
            {PAGE_SIZES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShareOpen(true)}><Share2 /> Share</button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-pressed={panel === 'comments'}
          aria-label={`Comments${openThreads ? `, ${openThreads} open` : ''}`}
          onClick={() => togglePanel('comments')}
        >
          <MessageSquare />{openThreads > 0 && <span className="doc-count">{openThreads}</span>}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" aria-pressed={panel === 'history'} aria-label="Version history" data-tip="Version history" onClick={() => togglePanel('history')}>
          <History />
        </button>
        {!readOnly && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={save} disabled={!live && (status === 'saved' || status === 'saving')}>
            <Save /> Save
          </button>
        )}
        <Menu label={exporting ? 'Preparing download…' : 'Export'} icon={Download} text={exporting ? 'Preparing…' : 'Export'} triggerClassName="btn btn-primary btn-sm" items={exportItems} />
      </header>

      {notesOpen && doc.importNotes?.length > 0 && !readOnly && (
        <div className="alert doc-import-notes" role="status">
          <div>
            <strong>Imported with some changes</strong>
            <ul>{doc.importNotes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Dismiss import notes" onClick={() => setNotesOpen(false)}><X /></button>
        </div>
      )}

      <div className="doc-workspace">
        <div className="doc-main">
          <DocumentCanvas
            key={mode}
            document={liveDoc}
            title={title}
            readOnly={readOnly}
            collab={live ? collab : null}
            onChange={onContentChange}
            onReady={onEditorReady}
            onLayoutChange={onLayoutChange}
            onSelect={setSelection}
            onCommentClick={onCommentClick}
          />
          <p className="doc-word-count mono">{plural(wordCount, 'word')}</p>
        </div>
        {panel && (
          <aside className="ed-sheet doc-side" aria-label={panel === 'comments' ? 'Comments' : 'Version history'}>
            {panel === 'comments' ? (
              <DocumentCommentsPanel
                documentId={id}
                threads={threads}
                anchoredIds={anchoredIds}
                selection={selection}
                me={me?.id}
                isOwner={role === 'owner'}
                canEdit={!readOnly}
                focusId={focusId}
                onOpen={openThread}
                onAnchor={anchorComment}
                onUnanchor={unanchorComment}
                onChanged={refreshComments}
                onClose={() => setPanel(null)}
              />
            ) : (
              <DocumentHistoryPanel documentId={id} canEdit={!readOnly} refreshKey={historyKey} onRestored={afterRestore} onClose={() => setPanel(null)} />
            )}
          </aside>
        )}
      </div>

      {shareOpen && (
        <DocumentShareDialog
          documentId={id}
          title={title}
          sharing={sharing}
          isOwner={role === 'owner'}
          onChanged={setSharing}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

export default DocumentEditorPage;
