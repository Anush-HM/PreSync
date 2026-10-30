import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, FileText, Presentation, ArrowRight, RefreshCw, X, LayoutTemplate } from 'lucide-react';
import AppShell from '../components/layout/AppShell.jsx';
import DeckCard from '../components/decks/DeckCard.jsx';
import RenameDeckDialog from '../components/decks/RenameDeckDialog.jsx';
import ShareDeckDialog from '../components/decks/ShareDeckDialog.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import ImportDialog from '../components/imports/ImportDialog.jsx';
import ImportRow from '../components/imports/ImportRow.jsx';
import SessionHistoryModal from '../components/SessionHistoryModal.jsx';
import TemplateGallery from '../components/templates/TemplateGallery.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { listDecks, createDeck, deleteDeck, duplicateDeck } from '../data/decksApi.js';
import { listImports } from '../data/importsApi.js';
import { getCurrentUser } from '../data/apiConfig.js';
import { greetingFor, plural } from '../data/format.js';
import { ASPECT_RATIOS } from '../data/slideFormat.js';
import './DecksPage.css';

const VIEWS = {
  home: { title: null, subtitle: 'Pick up where you left off, or start something new.' },
  mine: { title: 'My presentations', subtitle: 'Presentations you own.' },
  shared: { title: 'Shared with me', subtitle: 'Presentations other people invited you to co-edit.' }
};

const SORTS = {
  recent: { label: 'Last edited', compare: (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0) },
  title: { label: 'Name (Aâ€“Z)', compare: (a, b) => a.title.localeCompare(b.title) },
  created: { label: 'Date created', compare: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0) },
  slides: { label: 'Most slides', compare: (a, b) => b.slideCount - a.slideCount }
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'owned', label: 'Owned by me' },
  { key: 'shared', label: 'Shared with me' }
];

const RECENT_LIMIT = 8;
const SHARED_PREVIEW_LIMIT = 4;
const IMPORTS_PREVIEW_LIMIT = 3;

function normalise(d) {
  return { ...d, id: String(d.id || d._id) };
}

function DeckGrid({ decks, cardProps, busyId }) {
  return (
    <div className="deck-grid">
      {decks.map((d) => <DeckCard key={d.id} deck={d} busy={busyId === d.id} {...cardProps} />)}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="deck-grid" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="deck-skeleton">
          <div className="skeleton" style={{ aspectRatio: '16 / 9' }} />
          <div className="skeleton" style={{ height: 14, width: '70%', marginTop: 14 }} />
          <div className="skeleton" style={{ height: 11, width: '40%', marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

function Onboarding({ onCreate, onImport, onTemplate }) {
  return (
    <section className="onboarding card" aria-labelledby="onboarding-title">
      <div className="onboarding-copy">
        <span className="eyebrow"><span className="dot" />Getting started</span>
        <h2 id="onboarding-title">Create your first presentation</h2>
        <p>Start from a blank canvas, or bring in content you already have. Everything you make here can be co-edited live and presented to an audience.</p>
      </div>
      <div className="onboarding-actions">
        <button type="button" className="onboarding-option" onClick={onCreate}>
          <span className="onboarding-icon is-primary"><Plus aria-hidden="true" /></span>
          <span className="onboarding-text">
            <strong>Create from scratch</strong>
            <span>A blank 16:9 presentation, ready to edit.</span>
          </span>
          <ArrowRight className="onboarding-arrow" aria-hidden="true" />
        </button>
        <button type="button" className="onboarding-option" onClick={onTemplate}>
          <span className="onboarding-icon"><LayoutTemplate aria-hidden="true" /></span>
          <span className="onboarding-text">
            <strong>Start from a template</strong>
            <span>A pitch, lesson, project update and more.</span>
          </span>
          <ArrowRight className="onboarding-arrow" aria-hidden="true" />
        </button>
        <button type="button" className="onboarding-option" onClick={() => onImport('docx')}>
          <span className="onboarding-icon"><FileText aria-hidden="true" /></span>
          <span className="onboarding-text">
            <strong>Import a Word document</strong>
            <span>Headings become slides. Review the outline first.</span>
          </span>
          <ArrowRight className="onboarding-arrow" aria-hidden="true" />
        </button>
        <button type="button" className="onboarding-option" onClick={() => onImport('pptx')}>
          <span className="onboarding-icon"><Presentation aria-hidden="true" /></span>
          <span className="onboarding-text">
            <strong>Import a PowerPoint</strong>
            <span>Keep your slides, or use them as source material.</span>
          </span>
          <ArrowRight className="onboarding-arrow" aria-hidden="true" />
        </button>
        <p className="field-hint onboarding-foot">PDF files can be imported too.</p>
      </div>
    </section>
  );
}


function NewDeckDialog({ onConfirm, onClose }) {
  const [selected, setSelected] = useState(ASPECT_RATIOS[0]);
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="new-deck-title">
      <div className="dialog" style={{ maxWidth: 480 }}>
        <h2 id="new-deck-title" style={{ marginBottom: 16 }}>New presentation</h2>
        <p style={{ marginBottom: 12, color: 'var(--color-text-2, #555)' }}>Choose a slide size for your presentation.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {ASPECT_RATIOS.map((ratio) => (
            <label
              key={ratio.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                borderRadius: 8,
                border: `2px solid ${selected.label === ratio.label ? 'var(--color-primary, #5b6ef5)' : 'var(--color-border, #ddd)'}`,
                cursor: 'pointer',
                background: selected.label === ratio.label ? 'var(--color-primary-subtle, #eef0ff)' : 'transparent'
              }}
            >
              <input
                type="radio"
                name="aspect-ratio"
                style={{ accentColor: 'var(--color-primary, #5b6ef5)' }}
                checked={selected.label === ratio.label}
                onChange={() => setSelected(ratio)}
              />
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <strong style={{ fontSize: 14 }}>{ratio.label}</strong>
                <span style={{ fontSize: 12, color: 'var(--color-text-2, #777)' }}>{ratio.width} × {ratio.height} px</span>
              </span>
              <span
                aria-hidden="true"
                style={{
                  marginLeft: 'auto',
                  width: Math.round(56 * ratio.width / Math.max(ratio.width, ratio.height)),
                  height: Math.round(56 * ratio.height / Math.max(ratio.width, ratio.height)),
                  border: '1.5px solid var(--color-border, #ccc)',
                  borderRadius: 3,
                  background: '#f9f9f9',
                  flexShrink: 0
                }}
              />
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onConfirm({ width: selected.width, height: selected.height })}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function DecksPage({ view = 'home' }) {
  const navigate = useNavigate();
  const toast = useToast();
  const user = getCurrentUser();
  const viewInfo = VIEWS[view] || VIEWS.home;

  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [showNewDeckDialog, setShowNewDeckDialog] = useState(false);
  const [importKind, setImportKind] = useState(null);
  const [imports, setImports] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');

  const [renameTarget, setRenameTarget] = useState(null);
  const [shareTarget, setShareTarget] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => { refreshDecks(); }, []);

  // Recent imports are a secondary list; a failure here shouldn't block the page.
  useEffect(() => {
    if (view !== 'home') return;
    listImports().then(setImports).catch(() => setImports([]));
  }, [view]);

  async function refreshDecks() {
    setLoading(true);
    setLoadError('');
    try {
      const data = await listDecks();
      setDecks(data.map(normalise));
    } catch (err) {
      setLoadError(err.message || 'Could not load your presentations');
    } finally {
      setLoading(false);
    }
  }

  function handleCreate() {
    setShowNewDeckDialog(true);
  }

  async function handleCreateConfirmed({ width, height }) {
    setShowNewDeckDialog(false);
    setCreating(true);
    try {
      const deck = await createDeck('Untitled presentation', { width, height });
      navigate(`/editor/${deck._id || deck.id}`);
    } catch (err) {
      toast.error(err.message || 'Could not create a presentation');
      setCreating(false);
    }
  }

  async function handleDuplicate(deck) {
    setBusyId(deck.id);
    try {
      const copy = await duplicateDeck(deck.id);
      toast.success(`Created â€œ${copy.title}â€`);
      await refreshDecks();
    } catch (err) {
      toast.error(err.message || 'Could not duplicate that presentation');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    await deleteDeck(target.id);
    setDecks((prev) => prev.filter((d) => d.id !== target.id));
    setDeleteTarget(null);
    toast.success(`Deleted â€œ${target.title}â€`);
  }

  function handleRenamed(updated) {
    setDecks((prev) => prev.map((d) => (d.id === renameTarget.id ? { ...d, title: updated.title, updatedAt: updated.updatedAt || d.updatedAt } : d)));
    toast.success('Presentation renamed');
    setRenameTarget(null);
  }

  function handleShareChanged(updated) {
    setDecks((prev) => prev.map((d) => (d.id === shareTarget.id ? { ...d, collaborators: updated.collaborators } : d)));
  }

  const cardProps = {
    currentUserId: user?.id,
    onRename: setRenameTarget,
    onDuplicate: handleDuplicate,
    onShare: setShareTarget,
    onHistory: setHistoryTarget,
    onDelete: setDeleteTarget
  };

  // Decks this view is about, before search/filter.
  const scoped = useMemo(() => {
    if (view === 'mine') return decks.filter((d) => d.isOwner);
    if (view === 'shared') return decks.filter((d) => !d.isOwner);
    return decks;
  }, [decks, view]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = scoped;
    if (view === 'home' && filter === 'owned') list = list.filter((d) => d.isOwner);
    if (view === 'home' && filter === 'shared') list = list.filter((d) => !d.isOwner);
    if (q) list = list.filter((d) => d.title.toLowerCase().includes(q));
    return [...list].sort(SORTS[sort].compare);
  }, [scoped, query, filter, sort, view]);

  // The home view shows curated sections until the user searches,
  // filters or re-sorts; then it shows one results grid.
  const showSections = view === 'home' && !query.trim() && filter === 'all' && sort === 'recent';
  const recent = results.slice(0, RECENT_LIMIT);
  const sharedPreview = decks.filter((d) => !d.isOwner).sort(SORTS.recent.compare).slice(0, SHARED_PREVIEW_LIMIT);

  const firstName = (user?.name || '').trim().split(/\s+/)[0];
  const heading = viewInfo.title || (firstName ? `${greetingFor()}, ${firstName}` : greetingFor());
  const isEmptyAccount = !loading && !loadError && decks.length === 0;

  return (
    <AppShell>
      <div className="decks-page">
        <header className="dash-head">
          <div>
            <h1>{heading}</h1>
            <p className="dash-sub">{viewInfo.subtitle}</p>
          </div>
          <div className="dash-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setImportKind('docx')}>
              <FileText /> Import Word document
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setImportKind('pptx')}>
              <Presentation /> Import PowerPoint
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowTemplates(true)}>
              <LayoutTemplate /> Templates
            </button>
            <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={creating}>
              <Plus /> {creating ? 'Creatingâ€¦' : 'Create presentation'}
            </button>
          </div>
        </header>

        {loadError && (
          <div className="alert alert-error dash-alert" role="alert">
            <span style={{ flex: 1 }}>{loadError}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={refreshDecks}><RefreshCw /> Retry</button>
          </div>
        )}

        {isEmptyAccount && view === 'home' ? (
          <Onboarding onCreate={handleCreate} onImport={setImportKind} onTemplate={() => setShowTemplates(true)} />
        ) : (
          <>
            {!loadError && (
              <div className="dash-toolbar" role="search">
                <div className="dash-search">
                  <Search aria-hidden="true" />
                  <label htmlFor="deck-search" className="sr-only">Search presentations</label>
                  <input
                    id="deck-search"
                    className="input"
                    type="search"
                    placeholder="Search presentations"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button type="button" className="icon-btn dash-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
                      <X />
                    </button>
                  )}
                </div>
                {view === 'home' && (
                  <div className="segmented" role="group" aria-label="Filter presentations">
                    {FILTERS.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        className="segmented-item"
                        aria-pressed={filter === f.key}
                        onClick={() => setFilter(f.key)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
                <label className="dash-sort">
                  <span className="sr-only">Sort by</span>
                  <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
                    {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
                  </select>
                </label>
              </div>
            )}

            {loading ? (
              <SkeletonGrid />
            ) : loadError ? null : showSections ? (
              <>
                <section className="dash-section" aria-labelledby="recent-title">
                  <div className="dash-section-head">
                    <h2 id="recent-title">Recent presentations</h2>
                    {decks.length > RECENT_LIMIT && <Link to="/decks/mine" className="dash-link">View all <ArrowRight /></Link>}
                  </div>
                  <DeckGrid decks={recent} cardProps={cardProps} busyId={busyId} />
                </section>
                {imports.length > 0 && (
                  <section className="dash-section" aria-labelledby="imports-title">
                    <div className="dash-section-head">
                      <h2 id="imports-title">Recently imported</h2>
                      <Link to="/documents" className="dash-link">All documents <ArrowRight /></Link>
                    </div>
                    <ul className="import-list">
                      {imports.slice(0, IMPORTS_PREVIEW_LIMIT).map((item) => <ImportRow key={item.id} item={item} />)}
                    </ul>
                  </section>
                )}
                {sharedPreview.length > 0 && (
                  <section className="dash-section" aria-labelledby="shared-title">
                    <div className="dash-section-head">
                      <h2 id="shared-title">Shared with you</h2>
                      <Link to="/decks/shared" className="dash-link">View all <ArrowRight /></Link>
                    </div>
                    <DeckGrid decks={sharedPreview} cardProps={cardProps} busyId={busyId} />
                  </section>
                )}
              </>
            ) : results.length > 0 ? (
              <section className="dash-section" aria-label="Presentations">
                <p className="dash-count">{plural(results.length, 'presentation')}</p>
                <DeckGrid decks={results} cardProps={cardProps} busyId={busyId} />
              </section>
            ) : (
              <div className="dash-empty">
                {query.trim() ? (
                  <>
                    <h2>No matches for â€œ{query.trim()}â€</h2>
                    <p>Try a different name, or clear the search.</p>
                    <button type="button" className="btn btn-ghost" onClick={() => setQuery('')}>Clear search</button>
                  </>
                ) : view === 'shared' ? (
                  <>
                    <h2>Nothing shared with you yet</h2>
                    <p>When someone invites you to co-edit a presentation, it shows up here.</p>
                  </>
                ) : (
                  <>
                    <h2>No presentations here yet</h2>
                    <p>Create one from scratch or import a Word, PowerPoint or PDF file.</p>
                    <button type="button" className="btn btn-primary" onClick={handleCreate}><Plus /> Create presentation</button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {importKind && <ImportDialog kind={importKind} onClose={() => setImportKind(null)} />}
      {renameTarget && (
        <RenameDeckDialog
          deckId={renameTarget.id}
          currentTitle={renameTarget.title}
          onClose={() => setRenameTarget(null)}
          onRenamed={handleRenamed}
        />
      )}
      {shareTarget && (
        <ShareDeckDialog
          deckId={shareTarget.id}
          deckTitle={shareTarget.title}
          onClose={() => setShareTarget(null)}
          onChanged={handleShareChanged}
        />
      )}
      {historyTarget && (
        <SessionHistoryModal
          deckId={historyTarget.id}
          deckTitle={historyTarget.title}
          onClose={() => setHistoryTarget(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete presentation?"
          message={`â€œ${deleteTarget.title}â€ and its slides will be permanently deleted for you and every collaborator. This cannot be undone.`}
          confirmLabel="Delete presentation"
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {showNewDeckDialog && (
        <NewDeckDialog
          onConfirm={handleCreateConfirmed}
          onClose={() => setShowNewDeckDialog(false)}
        />
      )}
      {showTemplates && (
        <TemplateGallery
          onClose={() => setShowTemplates(false)}
          onCreated={(deck) => navigate(`/editor/${deck.id}`)}
        />
      )}
    </AppShell>
  );
}

export default DecksPage;
