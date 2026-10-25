import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Wand2, PencilRuler, Save, RotateCcw, ExternalLink } from 'lucide-react';
import AppShell from '../components/layout/AppShell.jsx';
import AnalysisPanel from '../components/imports/AnalysisPanel.jsx';
import OutlineEditor from '../components/imports/OutlineEditor.jsx';
import DocumentPreview from '../components/imports/DocumentPreview.jsx';
import SlidesPreview from '../components/imports/SlidesPreview.jsx';
import { FORMAT_ICON, FORMAT_LABEL } from '../components/imports/formatIcons.js';
import { useToast } from '../components/ui/Toast.jsx';
import { createDeckFromImport, getImport, saveImportOutline } from '../data/importsApi.js';
import { formatBytes, plural, timeAgo } from '../data/format.js';
import './ImportReviewPage.css';

// Review an analysed import, edit its outline, then choose what to
// create. Everything is stored server-side, so this page survives a
// refresh and the file never has to be uploaded again.
function ImportReviewPage() {
  const { importId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [doc, setDoc] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [outline, setOutline] = useState([]);
  const [savedOutline, setSavedOutline] = useState('[]');
  const [tab, setTab] = useState(null);
  const [creating, setCreating] = useState(null); // 'outline' | 'original'
  const [saving, setSaving] = useState(false);
  // Latest outline, for handlers that run right after a field commits.
  const outlineRef = useRef(outline);
  useEffect(() => { outlineRef.current = outline; }, [outline]);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const data = await getImport(importId);
      setDoc(data);
      setOutline(data.outline || []);
      setSavedOutline(JSON.stringify(data.outline || []));
      setTab((t) => t || (data.format === 'docx' ? 'outline' : 'slides'));
    } catch (err) {
      setLoadError(err.message || 'Could not load this import');
    }
  }, [importId]);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => JSON.stringify(outline) !== savedOutline, [outline, savedOutline]);

  // Warn before leaving with unsaved outline edits.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  async function handleSave() {
    setSaving(true);
    try {
      const { outline: saved } = await saveImportOutline(importId, outline);
      setOutline(saved);
      setSavedOutline(JSON.stringify(saved));
      toast.success('Outline saved');
    } catch (err) {
      toast.error(err.message || 'Could not save the outline');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate(mode) {
    // Let any focused bullet field commit its edit first.
    document.activeElement?.blur?.();
    await new Promise((r) => setTimeout(r, 0));
    setCreating(mode);
    const latest = outlineRef.current;
    try {
      const deck = await createDeckFromImport(importId, mode === 'outline' ? { mode, outline: latest } : { mode });
      if (mode === 'outline') setSavedOutline(JSON.stringify(latest));
      toast.success(`Created “${deck.title}” with ${plural(deck.slideCount, 'slide')}`);
      navigate(`/editor/${deck.id}`);
    } catch (err) {
      toast.error(err.message || 'Could not create the presentation');
      setCreating(null);
    }
  }

  if (loadError) {
    return (
      <AppShell>
        <div className="review-page">
          <p className="alert alert-error" role="alert">{loadError}</p>
          <div className="review-error-actions">
            <button type="button" className="btn btn-secondary" onClick={load}><RotateCcw /> Retry</button>
            <Link to="/documents" className="btn btn-ghost">Back to documents</Link>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!doc) {
    return (
      <AppShell>
        <div className="review-page" aria-busy="true">
          <div className="skeleton" style={{ height: 28, width: 280 }} />
          <div className="skeleton" style={{ height: 14, width: 200, marginTop: 12 }} />
          <div className="review-layout" style={{ marginTop: 28 }}>
            <div className="skeleton" style={{ height: 420, borderRadius: 18 }} />
            <div className="skeleton" style={{ height: 420, borderRadius: 18 }} />
          </div>
        </div>
      </AppShell>
    );
  }

  const isDocx = doc.format === 'docx';
  const Icon = FORMAT_ICON[doc.format];
  const tabs = isDocx
    ? [{ key: 'outline', label: 'Outline' }, { key: 'document', label: 'Document preview' }]
    : [{ key: 'slides', label: 'Slides' }, { key: 'outline', label: 'Outline' }];
  const busy = !!creating;

  return (
    <AppShell>
      <div className="review-page">
        <Link to="/documents" className="review-back"><ArrowLeft aria-hidden="true" /> Documents</Link>

        <header className="review-head">
          <div className="review-file">
            <span className="review-file-icon"><Icon aria-hidden="true" /></span>
            <div>
              <h1>{doc.title}</h1>
              <p className="review-meta">
                <span className="mono">{doc.fileName}</span> · {FORMAT_LABEL[doc.format]} · {formatBytes(doc.fileSize)} · imported {timeAgo(doc.createdAt)}
              </p>
            </div>
          </div>
          <div className="review-actions">
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/decks')} disabled={busy}>Cancel</button>
            {tab !== 'outline' && (
              <button type="button" className="btn btn-secondary" onClick={() => setTab('outline')} disabled={busy}>
                <PencilRuler /> Review outline
              </button>
            )}
            {isDocx ? (
              <button type="button" className="btn btn-primary" onClick={() => handleCreate('outline')} disabled={busy || outline.length === 0}>
                <Wand2 /> {creating === 'outline' ? 'Generating…' : 'Generate presentation'}
              </button>
            ) : (
              <>
                {tab === 'outline' && (
                  <button type="button" className="btn btn-secondary" onClick={() => handleCreate('outline')} disabled={busy || outline.length === 0}>
                    <Wand2 /> {creating === 'outline' ? 'Generating…' : 'Generate from outline'}
                  </button>
                )}
                <button type="button" className="btn btn-primary" onClick={() => handleCreate('original')} disabled={busy}>
                  <ExternalLink /> {creating === 'original' ? 'Opening…' : 'Open in editor'}
                </button>
              </>
            )}
          </div>
        </header>

        {doc.deckIds?.length > 0 && (
          <p className="review-made">
            {plural(doc.deckIds.length, 'presentation')} already made from this file:{' '}
            {doc.deckIds.map((id, i) => (
              <span key={id}>{i > 0 && ', '}<Link to={`/editor/${id}`}>open #{i + 1}</Link></span>
            ))}
          </p>
        )}

        <div className="review-layout">
          <div className="review-main">
            <div className="review-tabs" role="tablist" aria-label="Import views">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  id={`tab-${t.key}`}
                  aria-selected={tab === t.key}
                  aria-controls={`panel-${t.key}`}
                  className="review-tab"
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {t.key === 'outline' && <span className="review-tab-count mono">{outline.length}</span>}
                  {t.key === 'slides' && <span className="review-tab-count mono">{doc.slides.length}</span>}
                </button>
              ))}
            </div>

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="review-panel">
              {tab === 'outline' && (
                <>
                  <div className="outline-bar">
                    <p className="field-hint">
                      {isDocx
                        ? 'Each item becomes one slide. Edit titles and bullets, reorder, or remove slides before generating.'
                        : 'Use this presentation as source material: the outline turns each slide’s text into a fresh, consistently laid-out deck.'}
                    </p>
                    <div className="outline-bar-actions">
                      {dirty && <span className="badge badge-warning">Unsaved changes</span>}
                      {dirty && (
                        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setOutline(JSON.parse(savedOutline))} disabled={saving}>
                          Discard
                        </button>
                      )}
                      <button type="button" className="btn btn-sm btn-secondary" onClick={handleSave} disabled={!dirty || saving}>
                        <Save /> {saving ? 'Saving…' : 'Save outline'}
                      </button>
                    </div>
                  </div>
                  <OutlineEditor outline={outline} images={doc.images} onChange={setOutline} />
                </>
              )}
              {tab === 'document' && <DocumentPreview blocks={doc.blocks} images={doc.images} headings={doc.analysis.headings} />}
              {tab === 'slides' && <SlidesPreview slides={doc.slides} info={doc.analysis.slides} />}
            </div>
          </div>

          <AnalysisPanel analysis={doc.analysis} />
        </div>
      </div>
    </AppShell>
  );
}

export default ImportReviewPage;
