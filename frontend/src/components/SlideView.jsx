import { blockTextStyle, legacyFitScale, slideBackgroundStyle } from '../data/slideFormat.js';
import './SlideView.css';

// Read-only render of one slide, shared by the presenter and viewer
// pages so formatting set in the editor shows up the same everywhere.
function SlideView({ slide }) {
  const blocks = slide.blocks || [];
  const s = legacyFitScale(blocks);

  return (
    <div className="stage-slide" style={slideBackgroundStyle(slide)}>
      {blocks.map((b) => {
        if (b.type === 'image' && b.imageUrl) {
          return (
            <img
              key={b.id}
              src={b.imageUrl}
              alt=""
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              style={{
                position: 'absolute',
                left: (b.x || 0) * s,
                top: (b.y || 0) * s,
                width: (b.width || 300) * s,
                height: b.height ? b.height * s : 'auto',
                objectFit: 'contain',
                display: 'block',
              }}
            />
          );
        }
        if (b.type === 'image') {
          // Image left out of a lightweight payload (e.g. a dashboard
          // thumbnail) or missing its source: keep its footprint visible.
          return (
            <div
              key={b.id}
              className="slide-image-placeholder"
              style={{
                left: (b.x || 0) * s,
                top: (b.y || 0) * s,
                width: (b.width || 300) * s,
                height: (b.height || 160) * s
              }}
            />
          );
        }
        return (
          <div key={b.id} style={blockTextStyle(b, s)}>
            {b.text}
          </div>
        );
      })}
    </div>
  );
}

export default SlideView;
