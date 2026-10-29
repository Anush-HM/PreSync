import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import Dialog from '../ui/Dialog.jsx';
import ScaledSlide from '../ScaledSlide.jsx';
import { useToast } from '../ui/Toast.jsx';
import { TEMPLATES, buildTemplateSlides } from '../../data/templates.js';
import { createDeckFromStarter, createDeckFromTemplate, deleteTemplate, listTemplates } from '../../data/templatesApi.js';
import { plural } from '../../data/format.js';
import './templates.css';

// Pick a starter template (PreSync's own) or one of your saved templates
// and start a new presentation from it.
function TemplateGallery({ onClose, onCreated }) {
  const toast = useToast();
  const [tab, setTab] = useState('starter');
  const starters = useMemo(() => TEMPLATES.map((t) => ({ ...t, built: buildTemplateSlides(t) })), []);
  const [selected, setSelected] = useState(starters[0].id);
  const [mine, setMine] = useState(null);
  const [mineError, setMineError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listTemplates().then(setMine).catch((err) => {
      setMine([]);
      setMineError(err.message || 'Could not load your templates');
    });
  }, []);

  const starter = starters.find((t) => t.id === selected);

  async function use(fn) {
    setBusy(true);
    try {
      const deck = await fn();
      onCreated(deck);
    } catch (err) {
      toast.error(err.message || 'Could not create the presentation');
      setBusy(false);
    }
  }

  async function remove(t) {
    try {
      await deleteTemplate(t.id);
      setMine((list) => list.filter((x) => x.id !== t.id));
      toast.success(`Deleted “${t.name}”`);
    } catch (err) {
      toast.error(err.message || 'Could not delete that template');
    }
  }

  return (
    <Dialog
      title="Start from a template"
      description="Every template is ordinary slides you can change, restyle or delete."
      onClose={onClose}
      size="xl"
      dismissible={!busy}
      footer={tab === 'starter' && (
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || !starter} onClick={() => use(() => createDeckFromStarter(starter))}>
            {busy ? 'Creating…' : `Use “${starter?.name}”`}
          </button>
        </>
      )}
    >
      <div className="segmented tpl-tabs" role="tablist" aria-label="Templates">
        <button type="button" role="tab" className="segmented-item" aria-selected={tab === 'starter'} aria-pressed={tab === 'starter'} onClick={() => setTab('starter')}>Starter templates</button>
        <button type="button" role="tab" className="segmented-item" aria-selected={tab === 'mine'} aria-pressed={tab === 'mine'} onClick={() => setTab('mine')}>
          My templates{mine?.length ? ` (${mine.length})` : ''}
        </button>
      </div>

      {tab === 'starter' && (
        <div className="tpl-layout">
          <div className="tpl-grid" role="listbox" aria-label="Starter templates">
            {starters.map((t) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={t.id === selected}
                className="tpl-card"
                onClick={() => setSelected(t.id)}
                onDoubleClick={() => !busy && use(() => createDeckFromStarter(t))}
              >
                <ScaledSlide slide={t.built[0]} className="tpl-thumb" />
                <span className="tpl-name">{t.name}</span>
                <span className="tpl-meta">{plural(t.built.length, 'slide')}</span>
              </button>
            ))}
          </div>
          {starter && (
            <aside className="tpl-preview" aria-label={`${starter.name} preview`}>
              <h3>{starter.name}</h3>
              <p className="field-hint">{starter.description}</p>
              <div className="tpl-strip">
                {starter.built.map((s, i) => <ScaledSlide key={s.id} slide={s} className="tpl-strip-slide" label={`Slide ${i + 1}`} />)}
              </div>
            </aside>
          )}
        </div>
      )}

      {tab === 'mine' && (
        mine === null ? <p className="field-hint">Loading your templates…</p>
          : mineError ? <p className="alert alert-error" role="alert">{mineError}</p>
          : mine.length === 0 ? (
            <div className="tpl-empty">
              <p><strong>No saved templates yet.</strong></p>
              <p className="field-hint">In the editor, open the deck menu and choose “Save as template”. Your templates are private to you.</p>
            </div>
          ) : (
            <div className="tpl-grid">
              {mine.map((t) => (
                <div key={t.id} className="tpl-card is-static">
                  <button type="button" className="tpl-use" aria-label={`Use ${t.name}`} disabled={busy} onClick={() => use(() => createDeckFromTemplate(t.id))}>
                    {t.thumbnail ? <ScaledSlide slide={t.thumbnail} className="tpl-thumb" /> : <span className="tpl-thumb is-empty" />}
                    <span className="tpl-name">{t.name}</span>
                    <span className="tpl-meta">{plural(t.slideCount, 'slide')}{t.description ? ` · ${t.description}` : ''}</span>
                  </button>
                  <button type="button" className="icon-btn tpl-delete" aria-label={`Delete template ${t.name}`} data-tip="Delete template" onClick={() => remove(t)}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )
      )}
    </Dialog>
  );
}

export default TemplateGallery;
