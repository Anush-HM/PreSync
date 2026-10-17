import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { listDecks, createDeck, importDeckPdf, deleteDeck } from '../data/decksApi.js';
import { clearAuthToken, getCurrentUser } from '../data/apiConfig.js';
import SessionHistoryModal from '../components/SessionHistoryModal.jsx';
import './DecksPage.css';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function colorFor(id) {
  const s = String(id);
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash % 2 === 0 ? 'blue' : 'amber';
}

function DecksPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const user = getCurrentUser();

  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [historyDeck, setHistoryDeck] = useState(null); // { id, title }

  useEffect(() => { refreshDecks(); }, []);

  async function refreshDecks() {
    setLoading(true);
    setError('');
    try {
      const data = await listDecks();
      setDecks(data);
    } catch (err) {
      setError(err.message || 'Could not load decks');
    } finally {
      setLoading(false);
    }
  }

  async function handleNewDeck() {
    try {
      const deck = await createDeck('Untitled deck');
      navigate(`/editor/${deck._id}`);
    } catch (err) {
      setError(err.message || 'Could not create deck');
    }
  }

  function handleImportClick() { fileInputRef.current?.click(); }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      const deck = await importDeckPdf(file);
      navigate(`/editor/${deck.id || deck._id}`);
    } catch (err) {
      setError(err.message || 'Could not import that PDF');
    } finally {
      setImporting(false);
    }
  }

  async function handleDeleteDeck(e, deckId) {
    e.stopPropagation();
    e.preventDefault();
    if (!window.confirm('Delete this deck? This cannot be undone.')) return;
    setDeletingId(deckId);
    setError('');
    try {
      await deleteDeck(deckId);
      setDecks((prev) => prev.filter((d) => (d.id || d._id) !== deckId));
    } catch (err) {
      setError(err.message || 'Could not delete deck');
    } finally {
      setDeletingId(null);
    }
  }

  function handleLogout() {
    clearAuthToken();
    navigate('/', { replace: true });
  }

  return (
    <div className="decks-page">
      {/* ── Mini navbar for inner pages ── */}
      <nav className="decks-nav">
        <div className="decks-nav-inner">
          <Link to="/" className="logo">
            <span className="logo-mark">
              <svg viewBox="0 0 20 20" fill="none">
                <path d="M2 13 Q5 6 8 13 T14 13" stroke="#4FA8FF" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
                <path d="M2 7 Q5 14 8 7 T14 7" stroke="#FFB454" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
              </svg>
            </span>
            PreSync
          </Link>
          <div className="decks-nav-right">
            <span className="decks-nav-user mono">{user?.name || user?.email || ''}</span>
            <button className="btn btn-ghost" onClick={handleLogout}>Log out</button>
          </div>
        </div>
      </nav>

      <div className="wrap">
        <div className="decks-head">
          <div>
            <div className="eyebrow"><span className="dot"></span>EDITOR</div>
            <h1>Your decks</h1>
          </div>
          <div className="decks-head-actions">
            <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileSelected} style={{ display: 'none' }} />
            <button className="btn btn-ghost" onClick={handleImportClick} disabled={importing}>
              {importing ? 'Importing…' : '↑ Import PDF'}
            </button>
            <button className="btn btn-amber" onClick={handleNewDeck}>+ New deck</button>
          </div>
        </div>

        {error && <p className="decks-error">{error}</p>}

        {loading ? (
          <div className="decks-loading">
            <div className="loading-spinner" />
            <p className="mono">Loading decks…</p>
          </div>
        ) : decks.length === 0 ? (
          <div className="decks-empty-state">
            <p className="decks-empty-icon">📄</p>
            <p className="decks-empty">No decks yet — import a PDF or start a new deck.</p>
          </div>
        ) : (
          <div className="deck-grid">
            {decks.map((d) => {
              const id = d.id || d._id;
              return (
                <div
                  key={id}
                  className="deck-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/editor/${id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/editor/${id}`); }}
                >
                  <div className={`deck-thumb thumb-${colorFor(id)}`}>
                    <span>{d.slideCount} slide{d.slideCount === 1 ? '' : 's'}</span>
                  </div>
                  <div className="deck-info">
                    <h3>{d.title}</h3>
                    <p className="mono">Edited {formatDate(d.updatedAt)}</p>
                  </div>
                  <div className="deck-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn btn-ghost deck-history-btn"
                      title="View session history"
                      onClick={() => setHistoryDeck({ id, title: d.title })}
                    >
                      📋 History
                    </button>
                    {d.isOwner && (
                      <button
                        className="deck-delete-btn"
                        title="Delete deck"
                        disabled={deletingId === id}
                        onClick={(e) => handleDeleteDeck(e, id)}
                      >
                        {deletingId === id ? '…' : '×'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {historyDeck && (
        <SessionHistoryModal
          deckId={historyDeck.id}
          deckTitle={historyDeck.title}
          onClose={() => setHistoryDeck(null)}
        />
      )}
    </div>
  );
}

export default DecksPage;