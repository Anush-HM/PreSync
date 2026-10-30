import { AlertTriangle, NotebookPen } from 'lucide-react';
import ScaledSlide from '../ScaledSlide.jsx';
import './review.css';

// Slide-by-slide preview of a PowerPoint or PDF exactly as it will open
// in the editor, with per-slide notes on content that was left out.
function SlidesPreview({ slides, info, canvasWidth, canvasHeight }) {
  return (
    <ol className="slides-preview" aria-label="Slide preview">
      {slides.map((slide, i) => {
        const meta = info?.[i] || {};
        return (
          <li key={slide.id || i} className="slides-preview-item">
            <div className="slides-preview-frame">
              <ScaledSlide slide={slide} canvasWidth={canvasWidth} canvasHeight={canvasHeight} label={`Slide ${i + 1}${meta.title ? `: ${meta.title}` : ''}`} />
            </div>
            <div className="slides-preview-meta">
              <span className="mono slides-preview-num">{i + 1}</span>
              <span className="slides-preview-title" title={meta.title || ''}>{meta.title || 'Untitled slide'}</span>
              {meta.hasNotes && <NotebookPen aria-label="Has speaker notes" className="slides-preview-icon" />}
            </div>
            {(meta.notSupported?.length > 0 || meta.empty) && (
              <p className="slides-preview-warn">
                <AlertTriangle aria-hidden="true" />
                {meta.empty ? 'Nothing extractable on this slide' : `Not imported: ${meta.notSupported.join(', ')}`}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default SlidesPreview;
