import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listDecks, createDeck, importDeckPdf } from '../data/decksApi.js';
import './DecksPage.css';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Deterministic-ish color from the deck id so cards don't all look
// identical now that thumbnailColor no longer comes from mock data.
function colorFor(id) {
  const s = String(id);
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash % 2 === 0 ? 'blue' : 'amber';
}

function DecksPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    refreshDecks();
  }, []);

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

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    setImporting(true);
    setError('');
    try {
      const deck = await importDeckPdf(file);
      navigate(`/editor/${deck.id}`);
    } catch (err) {
      setError(err.message || 'Could not import that PDF');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="decks-page">
      <div className="wrap">
        <div className="decks-head">
          <div>
            <div className="eyebrow"><span className="dot"></span>EDITOR</div>
            <h1>Your decks</h1>
          </div>
          <div className="decks-head-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFileSelected}
              style={{ display: 'none' }}
            />
            <button className="btn btn-ghost" onClick={handleImportClick} disabled={importing}>
              {importing ? 'Importing…' : '↑ Import PDF'}
            </button>
            <button className="btn btn-amber" onClick={handleNewDeck}>
              + New deck
            </button>
          </div>
        </div>

        {error && <p className="decks-error">{error}</p>}

        {loading ? (
          <p className="decks-empty mono">Loading decks…</p>
        ) : decks.length === 0 ? (
          <p className="decks-empty mono">No decks yet — import a PDF or start a new deck.</p>
        ) : (
          <div className="deck-grid">
            {decks.map((d) => (
              <button
                key={d.id}
                className="deck-card"
                onClick={() => navigate(`/editor/${d.id}`)}
              >
                <div className={`deck-thumb thumb-${colorFor(d.id)}`}>
                  <span>{d.slideCount} slide{d.slideCount === 1 ? '' : 's'}</span>
                </div>
                <div className="deck-info">
                  <h3>{d.title}</h3>
                  <p className="mono">Edited {formatDate(d.updatedAt)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default DecksPage;