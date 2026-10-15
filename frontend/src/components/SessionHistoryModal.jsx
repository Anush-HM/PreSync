import { useState, useEffect } from 'react';
import { getSessionHistory } from '../data/roomsApi.js';
import './SessionHistoryModal.css';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit'
  });
}

function SessionHistoryModal({ deckId, deckTitle, onClose }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    getSessionHistory(deckId)
      .then((data) => setSessions(data.sessions || []))
      .catch((err) => setError(err.message || 'Could not load session history'))
      .finally(() => setLoading(false));
  }, [deckId]);

  function toggleExpand(roomId) {
    setExpandedId((prev) => (prev === roomId ? null : roomId));
  }

  return (
    <div className="sh-overlay" onClick={onClose}>
      <div className="sh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sh-header">
          <div>
            <h2 className="sh-title">Past Sessions</h2>
            <p className="sh-subtitle mono">{deckTitle}</p>
          </div>
          <button className="sh-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sh-body">
          {loading && (
            <div className="sh-loading">
              <div className="loading-spinner" />
              <p className="mono">Loading history…</p>
            </div>
          )}

          {error && <p className="sh-error">{error}</p>}

          {!loading && !error && sessions.length === 0 && (
            <div className="sh-empty">
              <p className="sh-empty-icon">📋</p>
              <p>No past sessions yet.</p>
              <p className="mono">Sessions appear here after you go live and end a session.</p>
            </div>
          )}

          {!loading && sessions.map((s) => (
            <div key={s.roomId} className="sh-session-card">
              <button
                className="sh-session-summary"
                onClick={() => toggleExpand(s.roomId)}
              >
                <div className="sh-session-left">
                  <span className="sh-session-date">{formatDate(s.createdAt)}</span>
                  <span className="sh-session-time mono">{formatTime(s.createdAt)}</span>
                </div>
                <div className="sh-session-meta">
                  <span className="sh-badge">⏱ {s.durationMin} min</span>
                  <span className="sh-badge">👥 {s.viewerCount} viewer{s.viewerCount !== 1 ? 's' : ''}</span>
                  <span className="sh-badge">❓ {s.questions.length} Q&amp;A{s.questions.length !== 1 ? 's' : ''}</span>
                </div>
                <span className="sh-chevron">{expandedId === s.roomId ? '▲' : '▼'}</span>
              </button>

              {expandedId === s.roomId && (
                <div className="sh-session-detail">
                  {s.questions.length === 0 ? (
                    <p className="sh-no-qa mono">No questions were asked in this session.</p>
                  ) : (
                    s.questions.map((q) => (
                      <div key={q.id} className="sh-qa-item">
                        <div className="sh-qa-question">Q: {q.text}</div>
                        {q.answer ? (
                          <div className="sh-qa-answer">A: {q.answer}</div>
                        ) : (
                          <div className={`sh-qa-status sh-qa-status--${q.status}`}>
                            {q.status === 'dismissed' ? 'Dismissed' : 'No answer sent'}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SessionHistoryModal;
