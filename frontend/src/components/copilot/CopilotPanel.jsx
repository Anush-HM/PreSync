import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  AlertCircle, ArrowUp, BookOpen, History, KeyRound, LayoutTemplate, MessageSquarePlus, ScanSearch, ShieldCheck,
  Sparkles, Square, Trash2, X
} from 'lucide-react';
import ActionCard from './ActionCard.jsx';
import { BriefForm, OutlineReview } from './OutlineBuilder.jsx';
import ConfirmDialog from '../ui/ConfirmDialog.jsx';
import {
  askCopilot, clearConversations, deleteConversation, getConversation, getCopilotStatus, listConversations, setActionStatus
} from '../../data/copilotApi.js';
import { buildCopilotContext, defaultScope, snapshotFor } from '../../data/copilotContext.js';
import { ActionError, applyAction, COPILOT_ORIGIN, isBlankStarterDeck } from '../../data/copilotActions.js';
import { analyzeSlideLayout, collectFixes } from '../../data/layoutAnalysis.js';
import { getSlidesArray } from '../../data/yjsClient.js';
import { getCurrentUser } from '../../data/apiConfig.js';
import { slideTitle } from '../../data/slideFormat.js';
import './copilot.css';

const MAX_INPUT = 4000;
const EMPTY_BRIEF = { topic: '', audience: '', purpose: '', slideCount: 8, tone: 'Professional', style: '' };
const SCOPES = [
  { id: 'selection', label: 'Selection' },
  { id: 'slide', label: 'Slide' },
  { id: 'deck', label: 'Deck' }
];
const GROUNDING = {
  document: { label: 'From your presentation', tone: 'doc' },
  general: { label: 'General knowledge', tone: 'general' },
  mixed: { label: 'Presentation + general knowledge', tone: 'mixed' }
};

function suggestionsFor(scope) {
  if (scope === 'selection') {
    return [
      'Rewrite this in a formal tone',
      'Make this simpler',
      'Make this more persuasive',
      'Shorten this',
      'Expand this with an example',
      'Fix grammar and spelling',
      'Convert this into bullet points',
      'Turn this into a table'
    ];
  }
  if (scope === 'deck') {
    return ['Summarize this presentation', 'Write an introduction slide', 'Write a conclusion slide', 'Check the flow between slides', 'Suggest examples to add'];
  }
  return [
    'Suggest a title for this slide',
    'Write speaker notes for this slide',
    'Recommend a layout for this slide',
    'Suggest stickers and emoji for this slide',
    'Summarize this slide',
    'Review the design of this slide'
  ];
}

const consentKey = () => `presync:copilot-consent:${getCurrentUser()?.id || 'me'}`;
function readConsent() {
  try {
    return localStorage.getItem(consentKey()) === '1';
  } catch {
    return false;
  }
}

const actionKey = (messageId, index) => `${messageId}:${index}`;

function CopilotPanel({ deckId, deckTitle, slides, activeSlideIdx, selectedIds, bridge, onSelectSlide, onClose }) {
  const [status, setStatus] = useState(null); // null while loading
  const [statusError, setStatusError] = useState('');
  const [consent, setConsent] = useState(readConsent);
  const [view, setView] = useState('chat'); // chat | create | history
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [input, setInput] = useState('');
  const [scopeChoice, setScopeChoice] = useState(null); // null = automatic
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null); // { message, retry }
  const [actionStates, setActionStates] = useState({});
  const [lastApplied, setLastApplied] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [brief, setBrief] = useState(EMPTY_BRIEF);
  const [outline, setOutline] = useState(null); // { messageId, index, slides }
  const [creating, setCreating] = useState(false);
  const [selectionTick, setSelectionTick] = useState(0);

  const snapshots = useRef(new Map()); // messageId → snapshot at request time
  const abortRef = useRef(null);
  const undoRef = useRef({ doc: null, manager: null });
  const threadEndRef = useRef(null);
  const inputRef = useRef(null);

  const configured = !!status?.configured;
  const storesHistory = status?.storesHistory !== false;

  // --- status and history ---
  useEffect(() => {
    let alive = true;
    getCopilotStatus()
      .then((s) => alive && setStatus(s))
      .catch((err) => alive && setStatusError(err.message || 'Could not reach the Copilot service'));
    return () => {
      alive = false;
    };
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const list = await listConversations(deckId);
      setConversations(list);
      return list;
    } catch {
      return [];
    }
  }, [deckId]);

  // Opens the most recent conversation for this deck.
  useEffect(() => {
    if (!configured || !consent || !storesHistory) return undefined;
    let alive = true;
    (async () => {
      const list = await refreshConversations();
      if (!alive || !list.length) return;
      setLoadingThread(true);
      try {
        const convo = await getConversation(list[0].id);
        if (alive) {
          setConversationId(convo.id);
          setMessages(convo.messages);
        }
      } catch {
        // history is a convenience; a failed load leaves a fresh thread
      } finally {
        if (alive) setLoadingThread(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [configured, consent, storesHistory, refreshConversations]);

  useEffect(() => bridge.subscribe(() => setSelectionTick((n) => n + 1)), [bridge, deckId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, pending]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // --- context ---
  // selectionTick re-reads the canvas text selection when it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const textSelection = useMemo(() => bridge.textSelection(), [bridge, selectionTick, selectedIds, activeSlideIdx]);
  const autoScope = defaultScope({ textSelection, selectedIds });
  const hasSelection = !!textSelection || selectedIds.length > 0;
  const scope = scopeChoice === 'selection' && !hasSelection ? 'slide' : scopeChoice || autoScope;
  const activeSlide = slides[activeSlideIdx];

  let contextText = 'No slide';
  if (scope === 'deck') contextText = `Whole presentation · ${slides.length} slides`;
  else if (activeSlide) {
    const where = `Slide ${activeSlideIdx + 1}: ${slideTitle(activeSlide, activeSlideIdx)}`;
    if (scope === 'selection') {
      const sel = textSelection?.text || activeSlide.blocks.filter((b) => selectedIds.includes(b.id)).map((b) => b.text || (b.type === 'image' ? 'Image' : b.type)).join(' · ');
      contextText = `${where} · “${(sel || '').replace(/\s+/g, ' ').slice(0, 60)}${(sel || '').length > 60 ? '…' : ''}”`;
    } else contextText = where;
  }

  // --- undo for Copilot changes ---
  function copilotUndoManager(doc) {
    if (undoRef.current.doc !== doc) {
      undoRef.current.manager?.destroy();
      const manager = new Y.UndoManager(getSlidesArray(doc), { trackedOrigins: new Set([COPILOT_ORIGIN]), captureTimeout: 0 });
      undoRef.current = { doc, manager };
    }
    return undoRef.current.manager;
  }
  useEffect(() => () => undoRef.current.manager?.destroy(), []);

  // --- sending ---
  async function send({ text, mode = 'chat', briefData } = {}) {
    const message = (text ?? input).trim();
    if (pending || (!message && mode !== 'outline')) return;
    setError(null);
    const ctx = buildCopilotContext({
      deckTitle,
      slides,
      activeIdx: activeSlideIdx,
      selectedIds,
      textSelection,
      scope: mode === 'outline' ? 'deck' : scope,
      message: message || briefData?.topic || '',
      measured: bridge.measureBlocks()
    });
    const snapshot = snapshotFor(slides, activeSlideIdx, ctx, textSelection);
    const tempId = `local-${Date.now()}`;
    const optimistic = { id: tempId, role: 'user', content: message || `Create a presentation outline about: ${briefData.topic}`, contextLabel: mode === 'outline' ? 'New presentation outline' : contextText };
    setMessages((m) => [...m, optimistic]);
    if (mode === 'chat') setInput('');
    setPending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const history = storesHistory ? undefined : messages.slice(-12).map(({ role, content, actions }) => ({ role, content, actions }));
      const res = await askCopilot(
        deckId,
        { conversationId: storesHistory ? conversationId : undefined, message, mode, brief: briefData, context: ctx, history },
        { signal: controller.signal }
      );
      snapshots.current.set(res.assistantMessage.id, snapshot);
      setMessages((m) => [...m.filter((x) => x.id !== tempId), res.userMessage, { ...res.assistantMessage, rejectedActions: res.rejectedActions }]);
      if (res.conversation) {
        setConversationId(res.conversation.id);
        refreshConversations();
      }
      return res.assistantMessage;
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== tempId));
      if (err.name === 'AbortError') return null;
      if (mode === 'chat') setInput(message);
      if (err.code === 'AI_NOT_CONFIGURED') setStatus((s) => ({ ...s, configured: false, setup: err.message }));
      setError({ message: err.message || 'The Copilot request failed', code: err.code, retryAfter: err.retryAfter, retry: () => send({ text: message, mode, briefData }) });
      return null;
    } finally {
      setPending(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  // --- actions ---
  function recordStatus(message, index, next) {
    if (!storesHistory || !conversationId || !message.id || message.id.startsWith('local')) return;
    setActionStatus(conversationId, message.id, index, next).catch(() => {});
  }

  async function handleApply(message, index, action, extra = {}) {
    const key = actionKey(message.id, index);
    const doc = bridge.getDoc();
    try {
      bridge.releaseCanvas();
      const mainUndo = bridge.getUndoManager();
      mainUndo?.addTrackedOrigin(COPILOT_ORIGIN);
      mainUndo?.stopCapturing();
      const manager = doc ? copilotUndoManager(doc) : null;
      manager?.stopCapturing();
      const result = await applyAction(doc, action, {
        snapshot: snapshots.current.get(message.id) || (message.local ? message.snapshot : null),
        activeIdx: activeSlideIdx,
        ...extra
      });
      mainUndo?.stopCapturing();
      setActionStates((s) => ({ ...s, [key]: { status: 'applied', note: result.created ? `Created ${result.created} slides` : 'Applied' } }));
      setLastApplied(key);
      if (Number.isInteger(result.slideIndex) && result.slideIndex !== activeSlideIdx) onSelectSlide(result.slideIndex);
      recordStatus(message, index, 'applied');
      return result;
    } catch (err) {
      const msg = err instanceof ActionError ? err.message : 'Could not apply this change.';
      setActionStates((s) => ({ ...s, [key]: { ...s[key], error: msg } }));
      return null;
    }
  }

  function handleDismiss(message, index) {
    const key = actionKey(message.id, index);
    setActionStates((s) => ({ ...s, [key]: { status: 'dismissed' } }));
    recordStatus(message, index, 'dismissed');
  }

  function handleUndo(message, index) {
    const manager = undoRef.current.manager;
    if (!manager || manager.undoStack.length === 0) return;
    bridge.releaseCanvas();
    manager.undo();
    const key = actionKey(message.id, index);
    setActionStates((s) => ({ ...s, [key]: { status: 'undone' } }));
    setLastApplied(null);
    recordStatus(message, index, 'undone');
  }

  // --- design check (deterministic, no AI) ---
  function runDesignCheck() {
    if (!activeSlide) return;
    const report = analyzeSlideLayout(activeSlide, { measured: bridge.measureBlocks() });
    const fixes = collectFixes(report);
    const lines = report.findings.map((f) => `• ${f.message}`);
    const id = `local-check-${Date.now()}`;
    const content = report.findings.length
      ? `Editor checks for slide ${activeSlideIdx + 1} found ${report.findings.length} thing${report.findings.length === 1 ? '' : 's'} to look at:\n${lines.join('\n')}`
      : `Editor checks found no overflow, overlap, off-slide, alignment, size or contrast problems on slide ${activeSlideIdx + 1}.`;
    setMessages((m) => [
      ...m,
      {
        id,
        role: 'editor',
        local: true,
        content: report.measured ? content : `${content}\n(Text heights could not be measured, so overflow wasn't checked.)`,
        snapshot: { slideIds: slides.map((s) => s.id), activeSlideId: activeSlide.id },
        actions: fixes.length ? [{ type: 'analyze_layout', summary: 'Fix the alignment, size and position issues found above.', slideIndex: activeSlideIdx, fixes }] : []
      }
    ]);
  }

  // --- conversations ---
  function newConversation() {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setActionStates({});
    setLastApplied(null);
    setError(null);
    setView('chat');
    inputRef.current?.focus();
  }

  async function openConversation(id) {
    setView('chat');
    setLoadingThread(true);
    try {
      const convo = await getConversation(id);
      setConversationId(convo.id);
      setMessages(convo.messages);
      setActionStates({});
      setLastApplied(null);
    } catch (err) {
      setError({ message: err.message || 'Could not open that conversation' });
    } finally {
      setLoadingThread(false);
    }
  }

  async function removeConversation(id) {
    try {
      await deleteConversation(id);
      if (id === conversationId) newConversation();
      setView('history');
      refreshConversations();
    } catch (err) {
      setError({ message: err.message || 'Could not delete that conversation' });
    }
  }

  async function clearAll() {
    setConfirmClear(false);
    try {
      if (storesHistory) await clearConversations(deckId);
      setConversations([]);
      newConversation();
    } catch (err) {
      setError({ message: err.message || 'Could not clear the history' });
    }
  }

  // --- guided outline ---
  async function draftOutline() {
    const reply = await send({ mode: 'outline', text: '', briefData: { ...brief, slideCount: Number(brief.slideCount) || 8 } });
    const index = reply?.actions?.findIndex((a) => a.type === 'create_outline') ?? -1;
    if (reply && index >= 0) setOutline({ messageId: reply.id, index, slides: reply.actions[index].slides });
    else if (reply) setView('chat');
  }

  function reviewOutline(message, index) {
    setOutline({ messageId: message.id, index, slides: message.actions[index].slides });
    setView('create');
  }

  async function createFromOutline(options) {
    const message = messages.find((m) => m.id === outline.messageId);
    if (!message) return;
    setCreating(true);
    const result = await handleApply(message, outline.index, message.actions[outline.index], options);
    setCreating(false);
    if (result) {
      setOutline(null);
      setView('chat');
    }
  }

  function acceptConsent() {
    try {
      localStorage.setItem(consentKey(), '1');
    } catch {
      // private mode: consent lasts for this visit
    }
    setConsent(true);
  }

  // --- render ---
  const blocked = !configured || !consent;
  const suggestions = suggestionsFor(scope);

  function renderMessage(m) {
    if (m.role === 'user') {
      return (
        <li key={m.id} className="cp-msg is-user">
          {m.contextLabel && <span className="cp-msg-ctx">{m.contextLabel}</span>}
          <p>{m.content}</p>
        </li>
      );
    }
    const grounding = GROUNDING[m.grounding];
    return (
      <li key={m.id} className={`cp-msg ${m.role === 'editor' ? 'is-editor' : 'is-ai'}`}>
        <div className="cp-msg-meta">
          {m.role === 'editor' ? (
            <span className="cp-badge is-editor"><ScanSearch aria-hidden="true" />Editor check · no AI</span>
          ) : (
            <span className="cp-badge"><Sparkles aria-hidden="true" />Copilot</span>
          )}
          {grounding && <span className={`cp-badge is-${grounding.tone}`}>{grounding.label}</span>}
        </div>
        <p className="cp-msg-text">{m.content}</p>
        {m.slideRefs?.length > 0 && (
          <div className="cp-refs" aria-label="Slides this answer draws on">
            {m.slideRefs.map((i) => (
              <button key={i} type="button" className="cp-ref" onClick={() => onSelectSlide(i)} disabled={!slides[i]}>
                Slide {i + 1}
              </button>
            ))}
          </div>
        )}
        {m.rejectedActions > 0 && (
          <p className="cp-note">{m.rejectedActions} suggested change{m.rejectedActions === 1 ? ' was' : 's were'} left out because the editor couldn’t apply {m.rejectedActions === 1 ? 'it' : 'them'} safely.</p>
        )}
        {(m.actions || []).map((a, i) => {
          const key = actionKey(m.id, i);
          return (
            <ActionCard
              key={key}
              action={a}
              slides={slides}
              activeIdx={activeSlideIdx}
              snapshot={snapshots.current.get(m.id) || m.snapshot || null}
              state={actionStates[key]}
              canUndo={lastApplied === key && (actionStates[key]?.status === 'applied')}
              onApply={(extra) => handleApply(m, i, a, extra)}
              onDismiss={() => handleDismiss(m, i)}
              onUndo={() => handleUndo(m, i)}
              onReviewOutline={() => reviewOutline(m, i)}
            />
          );
        })}
      </li>
    );
  }

  let main;
  if (statusError) {
    main = (
      <div className="cp-card is-error" role="alert">
        <AlertCircle aria-hidden="true" />
        <p>{statusError}</p>
      </div>
    );
  } else if (!status) {
    main = <div className="cp-center"><span className="spinner" aria-hidden="true" /><span className="sr-only">Loading Copilot</span></div>;
  } else if (!configured) {
    main = (
      <div className="cp-card" role="status">
        <KeyRound aria-hidden="true" />
        <h3>AI Copilot isn’t set up yet</h3>
        <p>{status.setup || 'Ask the person who runs this PreSync server to configure an AI provider.'}</p>
        <p className="cp-muted">Everything else in the editor works as usual. The design check below runs in the editor and needs no AI.</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={runDesignCheck} disabled={!activeSlide}>
          <ScanSearch aria-hidden="true" />Check this slide’s design
        </button>
      </div>
    );
  } else if (!consent) {
    main = (
      <div className="cp-card">
        <ShieldCheck aria-hidden="true" />
        <h3>Before you start</h3>
        <p>
          To answer, Copilot sends the parts of this presentation a request needs (your selection, the current slide, or a summary of the deck) to <strong>{status.provider}</strong>{status.model ? ` (${status.model})` : ''} through the PreSync server.
        </p>
        <p className="cp-muted">
          {storesHistory ? 'Your conversations are saved to your account for this presentation, without the slide content, and you can clear them at any time.' : 'Conversations are not saved.'} Suggestions are only added to your slides when you apply them.
        </p>
        <button type="button" className="btn btn-primary btn-sm" onClick={acceptConsent}>I understand, continue</button>
      </div>
    );
  }

  return (
    <div className="copilot">
      <div className="cp-head">
        <h2 className="ed-zone-title"><Sparkles aria-hidden="true" className="cp-head-icon" />AI Copilot</h2>
        <div className="cp-head-tools">
          {!blocked && (
            <>
              <button type="button" className="icon-btn icon-btn-sm" aria-label="New conversation" data-tip="New conversation" onClick={newConversation}>
                <MessageSquarePlus />
              </button>
              {storesHistory && (
                <button type="button" className="icon-btn icon-btn-sm" aria-label="Conversation history" aria-pressed={view === 'history'} data-tip="History" onClick={() => { setView(view === 'history' ? 'chat' : 'history'); refreshConversations(); }}>
                  <History />
                </button>
              )}
              <button type="button" className="icon-btn icon-btn-sm" aria-label="Clear conversation history" data-tip="Clear history" onClick={() => setConfirmClear(true)} disabled={!messages.length && !conversations.length}>
                <Trash2 />
              </button>
            </>
          )}
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Close AI Copilot" onClick={onClose}>
            <X />
          </button>
        </div>
      </div>

      {main ? (
        <div className="cp-body">
          {main}
          {messages.filter((m) => m.role === 'editor').length > 0 && <ol className="cp-thread">{messages.map(renderMessage)}</ol>}
        </div>
      ) : (
        <>
          <div className="cp-tabs" role="tablist" aria-label="Copilot mode">
            <button type="button" role="tab" aria-selected={view !== 'create'} className="cp-tab" onClick={() => setView('chat')}>
              <BookOpen aria-hidden="true" />Assist
            </button>
            <button type="button" role="tab" aria-selected={view === 'create'} className="cp-tab" onClick={() => setView('create')}>
              <LayoutTemplate aria-hidden="true" />Create deck
            </button>
          </div>

          {view === 'history' && (
            <div className="cp-body">
              <h3 className="cp-subhead">Conversations about this presentation</h3>
              {conversations.length === 0 ? (
                <p className="cp-muted">No saved conversations yet.</p>
              ) : (
                <ul className="cp-history">
                  {conversations.map((c) => (
                    <li key={c.id} className={c.id === conversationId ? 'is-current' : ''}>
                      <button type="button" className="cp-history-open" onClick={() => openConversation(c.id)}>
                        <span>{c.title}</span>
                        <span className="cp-muted mono">{new Date(c.updatedAt).toLocaleDateString()}</span>
                      </button>
                      <button type="button" className="icon-btn icon-btn-sm" aria-label={`Delete conversation ${c.title}`} onClick={() => removeConversation(c.id)}>
                        <Trash2 />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {view === 'create' && (
            <div className="cp-body">
              {outline ? (
                <OutlineReview
                  outline={outline.slides}
                  onChange={(next) => setOutline((o) => ({ ...o, slides: next }))}
                  onBack={() => setOutline(null)}
                  onCreate={createFromOutline}
                  canReplaceBlank={isBlankStarterDeck(slides)}
                  slideCount={slides.length}
                  activeIdx={activeSlideIdx}
                  busy={creating}
                />
              ) : (
                <BriefForm brief={brief} onChange={setBrief} onSubmit={draftOutline} pending={pending} />
              )}
              {error && view === 'create' && <ErrorNote error={error} onDismiss={() => setError(null)} />}
            </div>
          )}

          {view === 'chat' && (
            <>
              <div className="cp-body cp-chat" aria-live="polite">
                {loadingThread ? (
                  <div className="cp-center"><span className="spinner" aria-hidden="true" /><span className="sr-only">Loading conversation</span></div>
                ) : messages.length === 0 ? (
                  <div className="cp-empty">
                    <p>Ask about the {scope === 'deck' ? 'presentation' : scope === 'selection' ? 'selected text' : 'current slide'}, or try one of these:</p>
                    <div className="cp-suggestions">
                      {suggestions.map((s) => (
                        <button key={s} type="button" className="cp-suggestion" onClick={() => (s.startsWith('Review the design') ? runDesignCheck() : send({ text: s }))} disabled={pending}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <ol className="cp-thread">{messages.map(renderMessage)}</ol>
                )}
                {pending && (
                  <div className="cp-pending" role="status">
                    <span className="spinner" aria-hidden="true" />Thinking…
                    <button type="button" className="btn btn-quiet btn-sm" onClick={cancel}><Square aria-hidden="true" />Stop</button>
                  </div>
                )}
                {error && <ErrorNote error={error} onDismiss={() => setError(null)} />}
                <div ref={threadEndRef} />
              </div>

              <div className="cp-compose">
                <div className="cp-context" aria-label="Copilot context">
                  <div className="cp-scope" role="radiogroup" aria-label="What Copilot looks at">
                    {SCOPES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        role="radio"
                        aria-checked={scope === s.id}
                        className="cp-scope-btn"
                        disabled={s.id === 'selection' && !hasSelection}
                        onClick={() => setScopeChoice(s.id === autoScope ? null : s.id)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn btn-quiet btn-sm cp-check" onClick={runDesignCheck} disabled={!activeSlide} title="Run the editor's layout checks on this slide">
                    <ScanSearch aria-hidden="true" />Check design
                  </button>
                </div>
                <p className="cp-context-label" title={contextText}>Using {contextText}</p>
                {messages.length > 0 && (
                  <div className="cp-suggestions is-compact">
                    {suggestions.slice(0, 3).map((s) => (
                      <button key={s} type="button" className="cp-suggestion" onClick={() => (s.startsWith('Review the design') ? runDesignCheck() : send({ text: s }))} disabled={pending}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                <form
                  className="cp-input-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <textarea
                    ref={inputRef}
                    className="textarea cp-input"
                    aria-label="Message AI Copilot"
                    placeholder="Ask Copilot to write, rewrite, explain or design…"
                    rows={2}
                    maxLength={MAX_INPUT}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  <button type="submit" className="btn btn-primary cp-send" aria-label="Send" disabled={pending || !input.trim()}>
                    <ArrowUp aria-hidden="true" />
                  </button>
                </form>
                {input.length > MAX_INPUT * 0.8 && <p className="cp-muted cp-count mono">{input.length}/{MAX_INPUT}</p>}
              </div>
            </>
          )}
        </>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear Copilot history?"
          message="This deletes your Copilot conversations for this presentation. Changes you already applied to slides stay."
          confirmLabel="Clear history"
          destructive
          onConfirm={clearAll}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}

function ErrorNote({ error, onDismiss }) {
  const limited = error.code === 'RATE_LIMITED' || error.code === 'PROVIDER_RATE_LIMITED';
  return (
    <div className="cp-error" role="alert">
      <AlertCircle aria-hidden="true" />
      <div>
        <p>{error.message}</p>
        <div className="cp-error-actions">
          {error.retry && error.code !== 'AI_NOT_CONFIGURED' && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onDismiss(); error.retry(); }}>
              {limited && error.retryAfter ? `Retry (wait ${error.retryAfter}s)` : 'Try again'}
            </button>
          )}
          <button type="button" className="btn btn-quiet btn-sm" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

export default CopilotPanel;
