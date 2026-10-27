import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Expand, MessageSquareText, QrCode as QrIcon, Send, StickyNote, Users, X
} from 'lucide-react';
import { getDeck } from '../data/decksApi.js';
import { endRoom } from '../data/roomsApi.js';
import { createSocket } from '../data/socket.js';
import { getAuthToken } from '../data/apiConfig.js';
import { plural } from '../data/format.js';
import ScaledSlide from '../components/ScaledSlide.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { LogoMark } from '../components/ui/Logo.jsx';
import InviteDialog from '../components/live/InviteDialog.jsx';
import ConnectionPill from '../components/live/ConnectionPill.jsx';
import '../components/live/live.css';
import './PresenterPage.css';

// The Q&A service answers exactly NOT_IN_DECK when the deck doesn't
// cover a question; the presenter then writes an answer or dismisses it.
const NOT_IN_DECK = 'NOT_IN_DECK';
function draftItem(id, text, draft, status) {
  const notInDeck = (draft || '').trim() === NOT_IN_DECK;
  return { id, question: text, draft: notInDeck ? '' : draft || '', notInDeck, status };
}

// Socket errors that mean the session is over rather than a hiccup.
const ENDED_ERRORS = ['Not authorized to present this room'];

function PresenterPage() {
  const { roomCode } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // React Router state doesn't survive a page refresh — persist it to
  // sessionStorage under the room code so reloading mid-session doesn't
  // strand the presenter without a working "End session" button.
  const storageKey = `presync:presenter:${roomCode}`;
  const [deckId] = useState(() => {
    if (location.state?.deckId) {
      sessionStorage.setItem(storageKey, JSON.stringify(location.state));
      return location.state.deckId;
    }
    try {
      return JSON.parse(sessionStorage.getItem(storageKey))?.deckId ?? null;
    } catch {
      return null;
    }
  });
  const [roomId] = useState(() => {
    if (location.state?.roomId) return location.state.roomId;
    try {
      return JSON.parse(sessionStorage.getItem(storageKey))?.roomId ?? null;
    } catch {
      return null;
    }
  });

  const [deckTitle, setDeckTitle] = useState('');
  const [slides, setSlides] = useState(null); // null while loading
  const [slideIdx, setSlideIdx] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [socketError, setSocketError] = useState('');
  // 'connecting' until the first connect, then 'live' / 'reconnecting'.
  const [connState, setConnState] = useState('connecting');
  const [ending, setEnding] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [roomEnded, setRoomEnded] = useState(false);
  const [mobileTab, setMobileTab] = useState('notes');

  // Each item: { id, question, draft, status: 'pending'|'drafted'|'failed', error? }
  const [queue, setQueue] = useState([]);
  const socketRef = useRef(null);
  const stageRef = useRef(null);
  // Read at (re)join time, so a reconnect re-broadcasts the slide on screen.
  const currentSlideRef = useRef(null);

  // Presenter arrived here without a deck to load (e.g. a raw URL visit
  // rather than clicking Present) — nothing useful to present.
  useEffect(() => {
    if (!deckId) {
      navigate('/decks', { replace: true });
    }
  }, [deckId, navigate]);

  useEffect(() => {
    if (!deckId) return;
    getDeck(deckId)
      .then((deck) => {
        setDeckTitle(deck.title || '');
        setSlides(deck.slides || []);
      })
      .catch((err) => setLoadError(err.message || 'Could not load this presentation'));
  }, [deckId]);

  const broadcastSlide = useCallback((slide) => {
    if (!slide || socketRef.current?.connected !== true) return;
    socketRef.current.emit('presenter:slide-change', { slideId: slide.id });
  }, []);

  useEffect(() => {
    const token = getAuthToken();
    const socket = createSocket();
    socketRef.current = socket;

    // socket.io reconnects on its own; every (re)connect rejoins the room.
    socket.on('connect', () => {
      setConnState('live');
      setSocketError('');
      socket.emit('presenter:join', { token, code: roomCode });
    });

    socket.on('presenter:joined', () => {
      broadcastSlide(currentSlideRef.current);
    });

    // Sent on every (re)join: the server's list of questions still waiting
    // on the presenter. Keep any draft edits made in this tab.
    socket.on('question:queue', ({ questions }) => {
      setQueue((prev) =>
        questions.map((q) => {
          const local = prev.find((item) => item.id === q.id);
          return local ?? draftItem(q.id, q.text, q.draftAnswer, q.status);
        })
      );
    });

    socket.on('question:new', ({ id, text }) => {
      setQueue((q) => [...q, draftItem(id, text, '', 'pending')]);
    });

    socket.on('question:drafted', ({ id, draftAnswer }) => {
      setQueue((q) => q.map((item) => (item.id === id ? draftItem(id, item.question, draftAnswer, 'drafted') : item)));
    });

    socket.on('question:draft-failed', ({ id, error }) => {
      setQueue((q) => q.map((item) => (item.id === id ? { ...item, status: 'failed', error } : item)));
    });

    socket.on('viewer:count', ({ count }) => setViewerCount(count));

    // Covers the case where the session was ended from elsewhere (e.g. a
    // second presenter tab) rather than this tab's own "End session" click.
    socket.on('room:ended', () => setRoomEnded(true));

    socket.on('disconnect', () => setConnState((s) => (s === 'connecting' ? s : 'reconnecting')));
    socket.on('error', ({ message } = {}) => {
      if (ENDED_ERRORS.includes(message)) setRoomEnded(true);
      else setSocketError(message || 'Connection error');
    });

    socket.connect();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode, broadcastSlide]);

  const slideCount = slides?.length || 0;
  const slide = slides?.[slideIdx];
  const nextSlide = slides?.[slideIdx + 1];
  currentSlideRef.current = slide;

  // Re-broadcast whenever the presenter navigates.
  useEffect(() => {
    broadcastSlide(slide);
  }, [slide, broadcastSlide]);

  const goTo = useCallback((i) => {
    setSlideIdx(Math.max(0, Math.min(slideCount - 1, i)));
  }, [slideCount]);

  // --- Keyboard navigation -------------------------------------------
  useEffect(() => {
    function onKey(e) {
      if (['TEXTAREA', 'INPUT', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        goTo(slideIdx + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        goTo(slideIdx - 1);
      } else if (e.key === 'Home') {
        goTo(0);
      } else if (e.key === 'End') {
        goTo(slideCount - 1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slideIdx, slideCount, goTo]);

  function updateDraft(id, text) {
    setQueue((q) => q.map((item) => (item.id === id ? { ...item, draft: text } : item)));
  }

  function sendAnswer(id) {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    socketRef.current?.emit('question:send', { questionId: id, answer: item.draft });
    setQueue((q) => q.filter((q2) => q2.id !== id));
  }

  function dismissQuestion(id) {
    socketRef.current?.emit('question:dismiss', { questionId: id });
    setQueue((q) => q.filter((item) => item.id !== id));
  }

  async function handleEndSession() {
    if (!roomId) {
      navigate('/decks');
      return;
    }
    setEnding(true);
    try {
      await endRoom(roomId);
    } catch {
      // Even if the request fails (e.g. already ended), leaving the
      // presenter view is still the right move.
    } finally {
      sessionStorage.removeItem(storageKey);
      socketRef.current?.disconnect();
      navigate('/decks');
    }
  }

  function handleFullscreen() {
    stageRef.current?.requestFullscreen?.().catch(() => {});
  }

  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled;
  const pending = queue.length;
  const connLabel = roomEnded ? 'ended' : connState;

  const qaPanel = (
    <section className="pres-qa" aria-labelledby="qa-title">
      <div className="pres-card-head">
        <h2 id="qa-title"><MessageSquareText aria-hidden="true" />Audience questions</h2>
        {pending > 0 && <span className="badge badge-success">{pending}</span>}
      </div>
      <p className="pres-qa-sub">Answers are drafted from this deck only. Nothing is sent until you approve it.</p>
      {queue.length === 0 ? (
        <p className="pres-empty">No questions waiting. Questions from the audience appear here.</p>
      ) : (
        <ul className="pres-qa-list">
          {queue.map((q) => {
            return (
              <li className="qa-item" key={q.id}>
                <p className="qa-item-q">{q.question}</p>
                {q.status === 'pending' && (
                  <p className="qa-item-state"><span className="spinner" aria-hidden="true" />Drafting an answer…</p>
                )}
                {q.status === 'failed' && (
                  <p className="qa-item-state is-error">Couldn&apos;t draft an answer: {q.error}</p>
                )}
                {q.status === 'drafted' && (
                  <>
                    {q.notInDeck && <p className="qa-item-state is-warn">This deck doesn&apos;t cover that. Write an answer yourself or dismiss it.</p>}
                    <label className="sr-only" htmlFor={`draft-${q.id}`}>Answer to: {q.question}</label>
                    <textarea
                      id={`draft-${q.id}`}
                      className="textarea qa-item-draft"
                      value={q.draft}
                      placeholder={q.notInDeck ? 'Type your answer…' : undefined}
                      onChange={(e) => updateDraft(q.id, e.target.value)}
                    />
                  </>
                )}
                <div className="qa-item-actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => sendAnswer(q.id)} disabled={q.status !== 'drafted' || !q.draft.trim()}>
                    <Send aria-hidden="true" />Send answer
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismissQuestion(q.id)}>
                    <X aria-hidden="true" />Dismiss
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const notesPanel = (
    <section className="pres-notes" aria-labelledby="notes-title">
      <div className="pres-card-head">
        <h2 id="notes-title"><StickyNote aria-hidden="true" />Speaker notes</h2>
      </div>
      {slide?.notes?.trim()
        ? <p className="pres-notes-text">{slide.notes}</p>
        : <p className="pres-empty">No notes for this slide.</p>}
    </section>
  );

  return (
    <div className="pres">
      <header className="pres-top">
        <div className="pres-top-left">
          <Link to="/decks" className="icon-btn" aria-label="Back to dashboard (the session keeps running)" data-tip="Dashboard">
            <ArrowLeft />
          </Link>
          <LogoMark size={24} />
          <div className="pres-title">
            <span className="pres-deck">{deckTitle || 'Live session'}</span>
            <span className="pres-meta">
              <ConnectionPill state={connLabel} />
              <span className="pres-code mono" aria-label={`Session code ${roomCode}`}>{roomCode}</span>
              <span className="pres-viewers"><Users aria-hidden="true" />{plural(viewerCount, 'viewer')}</span>
            </span>
          </div>
        </div>
        <div className="pres-top-right">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowInvite(true)} disabled={roomEnded}>
            <QrIcon aria-hidden="true" />Invite
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmEnd(true)} disabled={ending || roomEnded}>
            {ending ? 'Ending…' : 'End session'}
          </button>
        </div>
      </header>

      {(socketError || connState === 'reconnecting') && !roomEnded && (
        <div className={`alert ${socketError ? 'alert-error' : 'alert-warning'} pres-alert`} role="alert">
          {socketError || 'Connection lost. Reconnecting. Your audience keeps the last slide they saw.'}
        </div>
      )}

      <div className="pres-body">
        <main className="pres-main" id="main">
          <div className="pres-stage" ref={stageRef}>
            {loadError ? (
              <div className="pres-state" role="alert">
                <h1>Couldn&apos;t load this presentation</h1>
                <p>{loadError}</p>
              </div>
            ) : slides === null ? (
              <div className="pres-state" role="status"><span className="spinner" aria-hidden="true" /><p>Loading slides…</p></div>
            ) : !slide ? (
              <div className="pres-state"><p>This presentation has no slides.</p></div>
            ) : (
              <ScaledSlide slide={slide} className="pres-slide" label={`Slide ${slideIdx + 1} of ${slideCount}`} />
            )}
          </div>

          <nav className="pres-nav" aria-label="Slide navigation">
            <button type="button" className="btn btn-secondary" onClick={() => goTo(slideIdx - 1)} disabled={!slide || slideIdx === 0} aria-label="Previous slide">
              <ChevronLeft aria-hidden="true" /><span className="pres-hide-sm">Previous</span>
            </button>
            <span className="pres-counter mono" aria-live="polite">
              {slideCount ? `${slideIdx + 1} / ${slideCount}` : '–'}
            </span>
            <button type="button" className="btn btn-primary" onClick={() => goTo(slideIdx + 1)} disabled={!slide || slideIdx >= slideCount - 1} aria-label="Next slide">
              <span className="pres-hide-sm">Next</span><ChevronRight aria-hidden="true" />
            </button>
            {canFullscreen && (
              <button type="button" className="icon-btn pres-fs" aria-label="Show slide full screen" data-tip="Full screen" onClick={handleFullscreen} disabled={!slide}>
                <Expand />
              </button>
            )}
          </nav>
          <p className="pres-keys">Arrow keys, Space and Page Up/Down also change slides.</p>

          <div className="pres-under">
            <section className="pres-next" aria-labelledby="next-title">
              <div className="pres-card-head"><h2 id="next-title">Up next</h2></div>
              {nextSlide
                ? <button type="button" className="pres-next-thumb" onClick={() => goTo(slideIdx + 1)} aria-label={`Go to slide ${slideIdx + 2}`}><ScaledSlide slide={nextSlide} /></button>
                : <p className="pres-empty">{slide ? 'This is the last slide.' : '–'}</p>}
            </section>
            <div className="pres-desktop-only">{notesPanel}</div>
          </div>

          <div className="pres-mobile-tabs">
            <div className="segmented" role="tablist" aria-label="Presenter tools">
              <button type="button" role="tab" className="segmented-item" aria-selected={mobileTab === 'notes'} aria-pressed={mobileTab === 'notes'} onClick={() => setMobileTab('notes')}>Notes</button>
              <button type="button" role="tab" className="segmented-item" aria-selected={mobileTab === 'qa'} aria-pressed={mobileTab === 'qa'} onClick={() => setMobileTab('qa')}>
                Questions{pending > 0 ? ` (${pending})` : ''}
              </button>
            </div>
            {mobileTab === 'notes' ? notesPanel : qaPanel}
          </div>
        </main>

        <aside className="pres-side" aria-label="Audience questions">{qaPanel}</aside>
      </div>

      {roomEnded && (
        <div className="pres-ended" role="alertdialog" aria-modal="true" aria-labelledby="ended-title">
          <div className="card pres-ended-card">
            <h2 id="ended-title">This session has ended</h2>
            <p>Your audience can no longer follow along with code <span className="mono">{roomCode}</span>. You can find it in Live Sessions.</p>
            <div className="pres-ended-actions">
              <Link to="/sessions" className="btn btn-secondary">Live Sessions</Link>
              <button
                type="button"
                className="btn btn-primary"
                autoFocus
                onClick={() => { sessionStorage.removeItem(storageKey); navigate('/decks'); }}
              >
                Back to dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      {showInvite && <InviteDialog code={roomCode} onClose={() => setShowInvite(false)} />}

      {confirmEnd && (
        <ConfirmDialog
          title="End this session?"
          message={`${plural(viewerCount, 'viewer')} will be disconnected and the code ${roomCode} will stop working. Questions stay in the session history.`}
          confirmLabel="End session"
          destructive
          onConfirm={handleEndSession}
          onCancel={() => setConfirmEnd(false)}
        />
      )}
    </div>
  );
}

export default PresenterPage;
