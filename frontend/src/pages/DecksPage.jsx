import { useNavigate } from 'react-router-dom';
import { MOCK_DECKS } from '../data/mockData.js';
import './DecksPage.css';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function DecksPage() {
  const navigate = useNavigate();

  return (
    <div className="decks-page">
      <div className="wrap">
        <div className="decks-head">
          <div>
            <div className="eyebrow"><span className="dot"></span>EDITOR</div>
            <h1>Your decks</h1>
          </div>
          <button className="btn btn-amber" onClick={() => navigate('/editor/deck-1')}>
            + New deck
          </button>
        </div>

        <div className="deck-grid">
          {MOCK_DECKS.map((d) => (
            <button
              key={d.id}
              className="deck-card"
              onClick={() => navigate(`/editor/${d.id}`)}
            >
              <div className={`deck-thumb thumb-${d.thumbnailColor}`}>
                <span>{d.slideCount} slides</span>
              </div>
              <div className="deck-info">
                <h3>{d.title}</h3>
                <p className="mono">Edited {formatDate(d.updatedAt)}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default DecksPage;