import { useEffect, useRef, useState } from 'react';
import { Check, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react';
import Avatar from '../ui/Avatar.jsx';
import { useToast } from '../ui/Toast.jsx';
import { addComment, deleteComment, replyToComment, sortThreads, updateComment } from '../../data/collabApi.js';
import { timeAgo } from '../../data/format.js';

const MAX_TEXT = 2000;

function blockLabel(block) {
  if (!block) return null;
  const type = block.type || 'textbox';
  if (type === 'textbox') {
    const text = String(block.text || '').replace(/\s+/g, ' ').trim();
    return text ? `“${text.length > 28 ? `${text.slice(0, 28)}…` : text}”` : 'a text box';
  }
  return { image: 'a picture', shape: 'a shape', table: 'a table', chart: 'a chart' }[type] || 'an element';
}

function Composer({ placeholder, onSubmit, autoFocus, submitLabel = 'Comment', onCancel }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  async function submit(e) {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await onSubmit(value);
      setText('');
    } catch {
      // the panel has already said what went wrong; keep the draft
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="cm-composer" onSubmit={submit}>
      <textarea
        ref={ref}
        className="input"
        rows={2}
        maxLength={MAX_TEXT}
        placeholder={placeholder}
        aria-label={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
          if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); }
        }}
      />
      <div className="cm-composer-foot">
        <span className="field-hint">Ctrl+Enter to send</span>
        {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>{submitLabel}</button>
      </div>
    </form>
  );
}

function Thread({ thread, slides, me, isOwner, focused, onOpen, onReply, onResolve, onDelete }) {
  const [replying, setReplying] = useState(false);
  const slideIdx = slides.findIndex((s) => s.id === thread.slideId);
  const slide = slides[slideIdx];
  const block = slide?.blocks.find((b) => b.id === thread.blockId);
  const where = slideIdx < 0 ? 'A deleted slide' : `Slide ${slideIdx + 1}${block ? ` · ${blockLabel(block)}` : thread.blockId ? ' · a removed element' : ''}`;
  const canDelete = thread.author?.id === me || isOwner;
  const ref = useRef(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focused]);

  return (
    <article ref={ref} className={`cm-thread${thread.resolved ? ' is-resolved' : ''}${focused ? ' is-focused' : ''}`} aria-label={`Comment by ${thread.author?.name || 'someone'}`}>
      <button type="button" className="cm-where" onClick={() => onOpen(thread)} disabled={slideIdx < 0}>
        {where}
      </button>
      {[{ id: 'root', author: thread.author, text: thread.text, createdAt: thread.createdAt }, ...thread.replies].map((m) => (
        <div key={m.id} className="cm-msg">
          <Avatar person={m.author} size={24} />
          <div className="cm-msg-body">
            <div className="cm-msg-head">
              <strong>{m.author?.name || m.author?.email || 'Someone'}</strong>
              <time dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString()}>{timeAgo(m.createdAt)}</time>
            </div>
            <p className="cm-text">{m.text}</p>
          </div>
        </div>
      ))}
      {thread.resolved && <p className="field-hint cm-resolved">Resolved{thread.resolvedBy ? ` by ${thread.resolvedBy.name || thread.resolvedBy.email}` : ''}</p>}
      {replying ? (
        <Composer placeholder="Reply" submitLabel="Reply" autoFocus onSubmit={async (t) => { await onReply(thread, t); setReplying(false); }} onCancel={() => setReplying(false)} />
      ) : (
        <div className="cm-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplying(true)}>Reply</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResolve(thread, !thread.resolved)}>
            {thread.resolved ? <><RotateCcw aria-hidden="true" />Reopen</> : <><Check aria-hidden="true" />Resolve</>}
          </button>
          {canDelete && (
            <button type="button" className="icon-btn cm-delete" aria-label="Delete thread" data-tip="Delete thread" onClick={() => onDelete(thread)}>
              <Trash2 aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}

// Comment threads for the open presentation. A new comment goes on the
// current slide, pinned to the selected element when exactly one is
// selected. Changes are sent to the server, then `onChanged` refreshes
// the list for everyone.
function CommentsPanel({ deckId, threads, slides, activeSlide, selectedBlock, me, isOwner, focusId, onOpen, onChanged, onClose }) {
  const toast = useToast();
  const [showResolved, setShowResolved] = useState(false);
  const list = sortThreads(threads, slides, activeSlide?.id, { showResolved });
  const resolvedCount = threads.filter((t) => t.resolved).length;
  const target = selectedBlock ? blockLabel(selectedBlock) : null;
  const slideNumber = slides.findIndex((s) => s.id === activeSlide?.id) + 1;

  const run = async (fn, failure) => {
    try {
      await fn();
      onChanged();
    } catch (err) {
      toast.error(err.message || failure);
      throw err;
    }
  };

  return (
    <div className="sheet">
      <header className="props-head">
        <h2 className="sheet-title"><MessageSquare aria-hidden="true" />Comments</h2>
        <button type="button" className="icon-btn" aria-label="Close comments" onClick={onClose}><X /></button>
      </header>
      <div className="sheet-body">
        {activeSlide && (
          <section className="cm-new" aria-label="New comment">
            <p className="field-hint">On slide {slideNumber}{target ? ` · ${target}` : ''}</p>
            <Composer
              placeholder="Add a comment"
              onSubmit={(text) => run(() => addComment(deckId, { slideId: activeSlide.id, blockId: selectedBlock?.id, text }), 'Could not add the comment')}
            />
          </section>
        )}
        <div className="cm-filter">
          <label className="check">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved{resolvedCount ? ` (${resolvedCount})` : ''}
          </label>
        </div>
        {list.length === 0 ? (
          <p className="field-hint sheet-empty">{threads.length ? 'No open comments.' : 'No comments yet. Select an element to comment on it, or comment on the whole slide.'}</p>
        ) : (
          list.map((t) => (
            <Thread
              key={t.id}
              thread={t}
              slides={slides}
              me={me}
              isOwner={isOwner}
              focused={t.id === focusId}
              onOpen={onOpen}
              onReply={(th, text) => run(() => replyToComment(deckId, th.id, text), 'Could not send the reply')}
              onResolve={(th, resolved) => run(() => updateComment(deckId, th.id, { resolved }), 'Could not update the comment').catch(() => {})}
              onDelete={(th) => run(() => deleteComment(deckId, th.id), 'Could not delete the comment').catch(() => {})}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default CommentsPanel;
