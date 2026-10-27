import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, ListTree, Plus, Undo2, X } from 'lucide-react';
import ScaledSlide from '../ScaledSlide.jsx';
import { ACTION_LABELS, previewAction } from '../../data/copilotActions.js';
import { assetDataUrl } from '../../data/assetLibrary.js';

const APPLY_LABELS = {
  suggest_text: 'Insert as text box',
  replace_selected_text: 'Replace text',
  suggest_title: 'Use this title',
  generate_speaker_notes: 'Use these notes',
  suggest_layout: 'Apply layout',
  create_table: 'Insert table',
  analyze_layout: 'Apply fixes'
};

function TextDiff({ before, after }) {
  return (
    <div className="cp-diff">
      {before !== undefined && (
        <div className="cp-diff-before">
          <span className="cp-diff-label">Now</span>
          <p>{before || <em>Empty</em>}</p>
        </div>
      )}
      <div className="cp-diff-after">
        <span className="cp-diff-label">{before !== undefined ? 'Proposed' : 'Text'}</span>
        <p>{after}</p>
      </div>
    </div>
  );
}

function SlideDiff({ before, after }) {
  return (
    <div className="cp-slide-diff">
      <figure>
        <ScaledSlide slide={before} label="Current slide" />
        <figcaption>Now</figcaption>
      </figure>
      {after && (
        <figure>
          <ScaledSlide slide={after} label="Slide with the change" />
          <figcaption>Proposed</figcaption>
        </figure>
      )}
    </div>
  );
}

// One proposed change: what it is, a preview against the live document,
// and Apply / Dismiss. Nothing touches the document until Apply.
function ActionCard({ action, slides, activeIdx, snapshot, state = {}, canUndo, onApply, onDismiss, onUndo, onReviewOutline }) {
  const [busy, setBusy] = useState(false);
  // The preview as it was when the user applied it; afterwards the live
  // document already contains the change, so a fresh preview would not
  // show what changed.
  const [frozen, setFrozen] = useState(null);
  const live = useMemo(() => previewAction(action, { slides, activeIdx, snapshot }), [action, slides, activeIdx, snapshot]);
  const status = state.status || action.status || 'proposed';
  const done = status === 'applied' || status === 'dismissed' || status === 'undone';
  const preview = done ? frozen || { slideIndex: live.slideIndex, kind: action.type === 'suggest_asset' && live.assets ? 'assets' : 'done', assets: live.assets } : live;

  async function run(extra) {
    if (!done) setFrozen(live);
    setBusy(true);
    try {
      await onApply(extra);
    } finally {
      setBusy(false);
    }
  }

  let body = null;
  if (preview.error || preview.kind === 'done') body = null;
  else if (preview.kind === 'text') body = <TextDiff before={preview.before} after={preview.after} />;
  else if (preview.kind === 'slide') body = <SlideDiff before={preview.before} after={preview.after} />;
  else if (preview.kind === 'table') {
    body = (
      <div className="cp-table-wrap">
        <table className="cp-table">
          <tbody>
            {preview.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (preview.headerRow && r === 0 ? <th key={c}>{cell}</th> : <td key={c}>{cell}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (preview.kind === 'assets') {
    body = (
      <ul className="cp-assets" aria-label="Suggested visuals">
        {preview.assets.map((asset) => (
          <li key={asset.id}>
            <button
              type="button"
              className="cp-asset"
              onClick={() => run({ assetId: asset.id })}
              disabled={busy || status === 'dismissed'}
              aria-label={`Insert ${asset.name} on slide ${preview.slideIndex + 1}`}
              title={`${asset.name} · ${asset.license.name}`}
            >
              {asset.kind === 'emoji' ? <span className="cp-asset-emoji" aria-hidden="true">{asset.emoji}</span> : <img src={assetDataUrl(asset)} alt="" />}
              <span className="cp-asset-name">{asset.name}</span>
              <Plus className="cp-asset-add" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    );
  } else if (preview.kind === 'outline') {
    body = (
      <ol className="cp-outline-mini">
        {preview.slides.slice(0, 8).map((s, i) => (
          <li key={i}>{s.title}</li>
        ))}
        {preview.slides.length > 8 && <li className="cp-muted">…and {preview.slides.length - 8} more</li>}
      </ol>
    );
  }

  const where = preview.slideIndex !== undefined ? `Slide ${preview.slideIndex + 1}` : null;

  return (
    <article className={`cp-action is-${status}`} aria-label={ACTION_LABELS[action.type]}>
      <header className="cp-action-head">
        <span className="cp-action-type">{ACTION_LABELS[action.type]}</span>
        {where && <span className="cp-action-where mono">{where}</span>}
      </header>
      {action.summary && <p className="cp-action-summary">{action.summary}</p>}
      {preview.error && !done ? (
        <p className="cp-action-error" role="note">
          <AlertTriangle aria-hidden="true" />
          {preview.error}
        </p>
      ) : (
        body
      )}
      {state.error && (
        <p className="cp-action-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          {state.error}
        </p>
      )}

      <footer className="cp-action-foot">
        {status === 'applied' && (
          <>
            <span className="cp-action-state"><Check aria-hidden="true" />{state.note || 'Applied'}</span>
            {canUndo && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={onUndo}>
                <Undo2 aria-hidden="true" />Undo
              </button>
            )}
          </>
        )}
        {status === 'undone' && <span className="cp-action-state is-muted">Undone</span>}
        {status === 'dismissed' && <span className="cp-action-state is-muted">Dismissed</span>}
        {!done && !preview.error && (
          <>
            {action.type === 'create_outline' ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={onReviewOutline}>
                <ListTree aria-hidden="true" />Review outline
              </button>
            ) : action.type === 'suggest_asset' ? null : action.type === 'analyze_layout' && !preview.fixes?.length ? null : (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => run()} disabled={busy}>
                {busy ? <span className="spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}
                {APPLY_LABELS[action.type]}
              </button>
            )}
            {(action.type === 'suggest_text' || action.type === 'generate_speaker_notes') && navigator.clipboard && (
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                aria-label="Copy text"
                data-tip="Copy"
                onClick={() => navigator.clipboard.writeText(action.text || action.notes || '').catch(() => {})}
              >
                <Copy />
              </button>
            )}
            <button type="button" className="btn btn-quiet btn-sm cp-dismiss" onClick={onDismiss} disabled={busy}>
              <X aria-hidden="true" />Dismiss
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

export default ActionCard;
