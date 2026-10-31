import { DOCUMENT_SHAPES } from './documentShapes.js';

function ShapeGlyph({ shape, color = 'currentColor' }) {
  const def = DOCUMENT_SHAPES.find((s) => s.id === shape) || DOCUMENT_SHAPES[0];
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" width="100%" height="100%">
      {def.id === 'rect' && <rect width="100" height="100" fill={color} />}
      {def.id === 'roundRect' && <rect width="100" height="100" rx="14" ry="20" fill={color} />}
      {def.id === 'ellipse' && <ellipse cx="50" cy="50" rx="50" ry="50" fill={color} />}
      {def.points && <polygon points={def.points} fill={color} />}
    </svg>
  );
}

export default ShapeGlyph;
