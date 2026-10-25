import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Radio, MonitorPlay, Square, History, RefreshCw, Users } from 'lucide-react';
import AppShell from '../components/layout/AppShell.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import SessionHistoryModal from '../components/SessionHistoryModal.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { endRoom, listMySessions } from '../data/roomsApi.js';
import { formatDateTime, plural, timeAgo } from '../data/format.js';
import './LiveSessionsPage.css';

function durationLabel(start, end) {
  if (!start || !end) return null;
  const min = Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

// The presenter's own sessions: live ones can be resumed or ended, past
// ones open the deck's session history.
function LiveSessionsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [endTarget, setEndTarget] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const data = await listMySessions();
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err.message || 'Could not load your sessions');
    } finally {
      setLoading(false);
    }
  }

  function resume(s) {
    navigate(`/presenter/${s.code}`, { state: { deckId: s.deckId, roomId: s.roomId } });
  }

  async function confirmEnd() {
    await endRoom(endTarget.roomId);
    toast.success(`Session ${endTarget.code} ended`);
    setEndTarget(null);
    await refresh();
  }

  const live = sessions.filter((s) => s.active);
  const past = sessions.filter((s) => !s.active);

  return (
    <AppShell>
      <div className="sessions-page">
        <header className="dash-head">
          <div>
            <h1>Live sessions</h1>
            <p className="dash-sub">Sessions you presented. Start a new one from a presentation’s editor with <strong>Present</strong>.</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={refresh} disabled={loading}>
            <RefreshCw /> Refresh
          </button>
        </header>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        {loading ? (
          <div className="session-list" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 72, borderRadius: 12 }} />)}
          </div>
        ) : !error && sessions.length === 0 ? (
          <div className="dash-empty">
            <h2>No sessions yet</h2>
            <p>Open a presentation and choose Present to go live. Your audience joins with a 6-character code.</p>
            <Link to="/decks" className="btn btn-primary">Go to presentations</Link>
          </div>
        ) : (
          <>
            {live.length > 0 && (
              <section className="dash-section" aria-labelledby="live-title">
                <div className="dash-section-head"><h2 id="live-title">Live now</h2></div>
                <ul className="session-list">
                  {live.map((s) => (
                    <li key={s.roomId} className="session-row is-live">
                      <span className="badge badge-live"><span className="live-dot" aria-hidden="true" />Live</span>
                      <div className="session-main">
                        <strong>{s.deckTitle || 'Deleted presentation'}</strong>
                        <span className="session-meta">
                          Code <span className="mono session-code">{s.code}</span> · started {timeAgo(s.createdAt)}
                          {' · '}<Users aria-hidden="true" className="inline-icon" /> {plural(s.viewerCount, 'viewer')} joined
                        </span>
                      </div>
                      <div className="session-actions">
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => resume(s)} disabled={!s.deckTitle}>
                          <MonitorPlay /> Presenter view
                        </button>
                        <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => setEndTarget(s)}>
                          <Square /> End
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {past.length > 0 && (
              <section className="dash-section" aria-labelledby="past-title">
                <div className="dash-section-head"><h2 id="past-title">Recent sessions</h2></div>
                <ul className="session-list">
                  {past.map((s) => (
                    <li key={s.roomId} className="session-row">
                      <span className="badge"><Radio aria-hidden="true" />Ended</span>
                      <div className="session-main">
                        <strong>{s.deckTitle || 'Deleted presentation'}</strong>
                        <span className="session-meta">
                          {formatDateTime(s.createdAt)}
                          {durationLabel(s.createdAt, s.endedAt) && <> · {durationLabel(s.createdAt, s.endedAt)}</>}
                          {' · '}{plural(s.viewerCount, 'viewer')}
                        </span>
                      </div>
                      <div className="session-actions">
                        {s.deckTitle && (
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHistoryTarget(s)}>
                            <History /> Details
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      {endTarget && (
        <ConfirmDialog
          title="End this session?"
          message={`Viewers of “${endTarget.deckTitle || endTarget.code}” will see that the session has ended, and code ${endTarget.code} stops working.`}
          confirmLabel="End session"
          destructive
          onConfirm={confirmEnd}
          onCancel={() => setEndTarget(null)}
        />
      )}
      {historyTarget && (
        <SessionHistoryModal
          deckId={historyTarget.deckId}
          deckTitle={historyTarget.deckTitle}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </AppShell>
  );
}

export default LiveSessionsPage;
