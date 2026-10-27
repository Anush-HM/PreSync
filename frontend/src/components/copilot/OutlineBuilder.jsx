import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowLeft, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { LAYOUTS, THEMES } from '../../data/copilotLayouts.js';

const TONES = ['Professional', 'Friendly', 'Persuasive', 'Inspiring', 'Academic', 'Simple'];

// Step 1 of "create a presentation": the brief.
export function BriefForm({ brief, onChange, onSubmit, pending, disabled }) {
  const set = (k) => (e) => onChange({ ...brief, [k]: e.target.value });
  return (
    <form
      className="cp-brief"
      onSubmit={(e) => {
        e.preventDefault();
        if (brief.topic.trim()) onSubmit();
      }}
    >
      <p className="cp-help">Describe the presentation. Copilot drafts an outline first; nothing is added to your deck until you review it.</p>
      <label className="cp-field">
        <span>Topic</span>
        <input className="input" required maxLength={300} value={brief.topic} onChange={set('topic')} placeholder="e.g. Introducing our new onboarding flow" />
      </label>
      <label className="cp-field">
        <span>Audience</span>
        <input className="input" maxLength={200} value={brief.audience} onChange={set('audience')} placeholder="e.g. Customer success team" />
      </label>
      <label className="cp-field">
        <span>Purpose</span>
        <input className="input" maxLength={300} value={brief.purpose} onChange={set('purpose')} placeholder="e.g. Get buy-in for a pilot" />
      </label>
      <div className="cp-field-row">
        <label className="cp-field">
          <span>Slides</span>
          <input className="input" type="number" min={1} max={30} value={brief.slideCount} onChange={set('slideCount')} />
        </label>
        <label className="cp-field">
          <span>Tone</span>
          <select className="select" value={brief.tone} onChange={set('tone')}>
            {TONES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <label className="cp-field">
        <span>Style or theme <em className="cp-muted">(optional)</em></span>
        <input className="input" maxLength={120} value={brief.style} onChange={set('style')} placeholder="e.g. minimal, data-heavy, story-led" />
      </label>
      <button type="submit" className="btn btn-primary btn-block" disabled={pending || disabled || !brief.topic.trim()}>
        {pending ? <span className="spinner" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
        {pending ? 'Drafting outline…' : 'Draft outline'}
      </button>
    </form>
  );
}

// Step 2: review and edit the outline, then create the slides.
export function OutlineReview({ outline, onChange, onBack, onCreate, canReplaceBlank, slideCount, activeIdx, busy }) {
  const [placement, setPlacement] = useState(canReplaceBlank ? 'replace' : 'after');
  const [themeId, setThemeId] = useState('clean');
  const update = (i, patch) => onChange(outline.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i, d) => {
    const next = [...outline];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s);
    onChange(next);
  };
  const count = outline.filter((s) => s.title.trim()).length;
  const insertAt = placement === 'end' ? slideCount : activeIdx + 1;

  return (
    <div className="cp-review">
      <button type="button" className="btn btn-quiet btn-sm cp-back" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />Back
      </button>
      <p className="cp-help">Edit, reorder or remove slides. Bullets go one per line.</p>
      <ol className="cp-review-list">
        {outline.map((s, i) => (
          <li key={i} className="cp-review-item">
            <div className="cp-review-head">
              <span className="mono cp-muted">{i + 1}</span>
              <input className="input" aria-label={`Slide ${i + 1} title`} value={s.title} maxLength={200} onChange={(e) => update(i, { title: e.target.value })} />
              <button type="button" className="icon-btn icon-btn-sm" aria-label={`Move slide ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></button>
              <button type="button" className="icon-btn icon-btn-sm" aria-label={`Move slide ${i + 1} down`} disabled={i === outline.length - 1} onClick={() => move(i, 1)}><ArrowDown /></button>
              <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove slide ${i + 1}`} onClick={() => onChange(outline.filter((_, j) => j !== i))}><Trash2 /></button>
            </div>
            <textarea
              className="textarea cp-review-bullets"
              aria-label={`Slide ${i + 1} bullets`}
              rows={Math.min(6, Math.max(2, s.bullets.length))}
              value={s.bullets.join('\n')}
              onChange={(e) => update(i, { bullets: e.target.value.split('\n') })}
            />
            <div className="cp-review-meta">
              <select className="select" aria-label={`Slide ${i + 1} layout`} value={s.layoutId || ''} onChange={(e) => update(i, { layoutId: e.target.value || null })}>
                <option value="">Automatic layout</option>
                {LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              {s.notes && <span className="cp-muted cp-has-notes" title={s.notes}>+ speaker notes</span>}
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...outline, { title: 'New slide', bullets: [], notes: '', layoutId: null }])}>
        <Plus aria-hidden="true" />Add slide
      </button>

      <fieldset className="cp-fieldset">
        <legend>Colours</legend>
        <div className="cp-themes">
          {THEMES.map((t) => (
            <label key={t.id} className={`cp-theme${themeId === t.id ? ' is-on' : ''}`} title={t.name}>
              <input type="radio" name="cp-theme" value={t.id} checked={themeId === t.id} onChange={() => setThemeId(t.id)} className="sr-only" />
              <span className="cp-theme-swatch" style={{ background: t.background, color: t.title }}>Aa</span>
              <span className="cp-theme-name">{t.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="cp-fieldset">
        <legend>Where to add the slides</legend>
        {canReplaceBlank && (
          <label className="cp-radio"><input type="radio" name="cp-place" checked={placement === 'replace'} onChange={() => setPlacement('replace')} /> Replace the empty starter slide</label>
        )}
        <label className="cp-radio"><input type="radio" name="cp-place" checked={placement === 'after'} onChange={() => setPlacement('after')} /> After slide {activeIdx + 1}</label>
        <label className="cp-radio"><input type="radio" name="cp-place" checked={placement === 'end'} onChange={() => setPlacement('end')} /> At the end of the deck</label>
        <p className="cp-help">Existing slides are kept.</p>
      </fieldset>

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!count || busy}
        onClick={() => onCreate({ outline: outline.map((s) => ({ ...s, bullets: s.bullets.map((b) => b.trim()).filter(Boolean) })), themeId, insertAt, replaceBlank: placement === 'replace' })}
      >
        {busy ? <span className="spinner" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
        Create {count} slide{count === 1 ? '' : 's'}
      </button>
    </div>
  );
}
