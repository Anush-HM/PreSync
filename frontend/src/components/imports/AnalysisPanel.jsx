import { AlertTriangle, CheckCircle2, ListTree, Lightbulb, Layers } from 'lucide-react';
import { plural } from '../../data/format.js';
import './review.css';

const STAT_LABELS = {
  pages: 'Pages (as saved)',
  slides: 'Slides',
  headings: 'Headings',
  paragraphs: 'Paragraphs',
  listItems: 'List items',
  tables: 'Tables',
  images: 'Pictures',
  words: 'Words',
  textBoxes: 'Text boxes',
  notes: 'With notes',
  charts: 'Charts'
};

// Everything the deterministic analysis found: counts, heading
// hierarchy, topics, key points and what could not be imported.
function AnalysisPanel({ analysis }) {
  const stats = { ...(analysis.pageCount && analysis.kind === 'docx' ? { pages: analysis.pageCount } : {}), ...analysis.stats };
  const warnings = analysis.warnings || [];
  const isDocx = analysis.kind === 'docx';

  return (
    <aside className="analysis" aria-label="Structure analysis">
      <section className="analysis-card">
        <h2 className="analysis-h">Analysis</h2>
        <dl className="analysis-stats">
          {Object.entries(stats)
            .filter(([key, v]) => STAT_LABELS[key] && v !== null && v !== undefined)
            .map(([key, value]) => (
              <div key={key}>
                <dt>{STAT_LABELS[key]}</dt>
                <dd className="mono">{Number(value).toLocaleString()}</dd>
              </div>
            ))}
        </dl>
        <p className="analysis-suggest">
          <Layers aria-hidden="true" />
          {isDocx
            ? <>Suggested <strong>{plural(analysis.suggestedSlides, 'slide')}</strong> from {plural(analysis.majorTopics.length, 'section')}</>
            : <>{plural(analysis.slideCount, 'slide')} in original order</>}
        </p>
      </section>

      <section className="analysis-card">
        <h2 className="analysis-h">
          {warnings.length ? <AlertTriangle aria-hidden="true" className="is-warn" /> : <CheckCircle2 aria-hidden="true" className="is-ok" />}
          {warnings.length ? `Conversion notes (${warnings.length})` : 'No conversion issues'}
        </h2>
        {warnings.length > 0 ? (
          <ul className="analysis-warnings">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        ) : (
          <p className="field-hint">Everything PreSync detected in this file can be imported.</p>
        )}
      </section>

      {analysis.headings?.length > 0 && (
        <section className="analysis-card">
          <h2 className="analysis-h"><ListTree aria-hidden="true" />{isDocx ? 'Heading hierarchy' : 'Slide titles'}</h2>
          <ol className="analysis-tree">
            {analysis.headings.map((h, i) => (
              <li key={i} style={{ paddingLeft: `${(h.level - 1) * 14}px` }} className={h.startsSlide ? 'starts-slide' : ''}>
                <span className="analysis-tree-level mono" aria-label={isDocx ? `Heading ${h.level}` : `Slide ${h.slideIndex + 1}`}>
                  {isDocx ? `H${h.level}` : h.slideIndex + 1}
                </span>
                <span>{h.text}</span>
              </li>
            ))}
          </ol>
          {isDocx && <p className="field-hint">Highlighted headings start a new slide.</p>}
        </section>
      )}

      {analysis.keyPoints?.length > 0 && (
        <section className="analysis-card">
          <h2 className="analysis-h"><Lightbulb aria-hidden="true" />Key points</h2>
          <ul className="analysis-points">
            {analysis.keyPoints.map((k, i) => <li key={i}>{k}</li>)}
          </ul>
          <p className="field-hint">Taken from the opening line of each {isDocx ? 'section' : 'slide'}.</p>
        </section>
      )}
    </aside>
  );
}

export default AnalysisPanel;
