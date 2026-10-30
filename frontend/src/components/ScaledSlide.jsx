import { useLayoutEffect, useRef, useState } from 'react';
import SlideView from './SlideView.jsx';
import './SlideView.css';

// Renders a slide at its native 960×540 and scales it to the width of
// its container. Used for dashboard thumbnails and anywhere a slide has
// to shrink without re-wrapping its text.
function ScaledSlide({ slide, className = '', label, canvasWidth = 960, canvasHeight = 540 }) {
  const boxRef = useRef(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const update = () => setScale(el.clientWidth / canvasWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasWidth]);

  return (
    <div
      ref={boxRef}
      className={`scaled-slide ${className}`}
      style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <div className="scaled-slide-inner" style={{ transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden', width: canvasWidth, height: canvasHeight }}>
        <SlideView slide={slide} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />
      </div>
    </div>
  );
}

export default ScaledSlide;
