import { useEffect, useRef, useState } from 'react';
import { Check, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react';
import Avatar from '../ui/Avatar.jsx';
import { useToast } from '../ui/Toast.jsx';
import { Composer } from '../collab/CommentsPanel.jsx';
import {
  addDocumentComment, deleteDocumentComment, replyToDocumentComment, updateDocumentComment
} from '../../data/documentsApi.js';
import { timeAgo } from '../../data/format.js';
import '../collab/collab.css';

const QUOTE_SHOWN = 90;

const shortQuote = (text) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > QUOTE_SHOWN ? `${clean.slice(0, QUOTE_SHOWN)}…` : clean;
};

function Thread({ thread, anchored, me, isOwner, canEdit, focused, onOpen, onReply, onResolve, onDelete }) {
  const [replying, setReplying] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focused]);
  const canDelete = canEdit && (thread.author?.id === me || isOwner);
  const where = thread.quote ? `“${shortQuote(thread.quote)}”` : 'The document';

  return (
    <article ref={ref} className={`cm-thread${thread.resolved ? ' is-resolved' : ''}${focused ? ' is-focused' : ''}`} aria-label={`Comment by ${thread.author?.name || thread.author?.email || 'someone'}`}>
      <button type="button" className="cm-where" onClick={() => onOpen(thread)} disabled={!anchored}>
        {anchored ? where : `${where} (text removed)`}
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
      {canEdit && (replying ? (
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
      ))}
    </article>
  );
}

// Comment threads on the open Word document. A new thread goes on the
// selected text: the server makes the thread, then the text gets a
// comment mark with its id (`onAnchor`), which syncs to co-editors with
// the rest of the document. Deleting a thread takes the mark off again.
// People who can only view read the threads.
function DocumentCommentsPanel({ documentId, threads, anchoredIds, selection, me, isOwner, canEdit, focusId, onOpen, onAnchor, onUnanchor, onChanged, onClose }) {
  const toast = useToast();
  const [showResolved, setShowResolved] = useState(false);
  const resolvedCount = threads.filter((t) => t.resolved).length;
  const list = threads
    .filter((t) => showResolved || !t.resolved)
    .sort((a, b) => Number(a.resolved) - Number(b.resolved) || new Date(a.createdAt) - new Date(b.createdAt));

  const run = async (fn, failure) => {
    try {
      const out = await fn();
      onChanged();
      return out;
    } catch (err) {
      toast.error(err.message || failure);
      throw err;
    }
  };

  async function start(text) {
    const thread = await run(() => addDocumentComment(documentId, { text, quote: selection.text }), 'Could not add the comment');
    onAnchor(thread.id);
  }

  return (
    <div className="sheet">
      <header className="props-head">
        <h2 className="sheet-title"><MessageSquare aria-hidden="true" />Comments</h2>
        <button type="button" className="icon-btn" aria-label="Close comments" onClick={onClose}><X /></button>
      </header>
      <div className="sheet-body">
        {canEdit && (
          <section className="cm-new" aria-label="New comment">
            {selection?.text ? (
              <>
                <p className="field-hint">On “{shortQuote(selection.text)}”</p>
                <Composer placeholder="Add a comment" onSubmit={start} />
              </>
            ) : (
              <p className="field-hint">Select some text in the document to comment on it.</p>
            )}
          </section>
        )}
        {!canEdit && <p className="field-hint">You can view this document, so you can read comments but not add them.</p>}
        <div className="cm-filter">
          <label className="check">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved{resolvedCount ? ` (${resolvedCount})` : ''}
          </label>
        </div>
        {list.length === 0 ? (
          <p className="field-hint sheet-empty">{threads.length ? 'No open comments.' : 'No comments yet.'}</p>
        ) : (
          list.map((t) => (
            <Thread
              key={t.id}
              thread={t}
              anchored={anchoredIds.has(t.id)}
              me={me}
              isOwner={isOwner}
              canEdit={canEdit}
              focused={t.id === focusId}
              onOpen={onOpen}
              onReply={(th, text) => run(() => replyToDocumentComment(documentId, th.id, text), 'Could not send the reply')}
              onResolve={(th, resolved) => run(() => updateDocumentComment(documentId, th.id, { resolved }), 'Could not update the comment').catch(() => {})}
              onDelete={(th) => run(async () => {
                await deleteDocumentComment(documentId, th.id);
                onUnanchor(th.id);
              }, 'Could not delete the comment').catch(() => {})}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default DocumentCommentsPanel;
