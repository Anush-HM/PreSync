// Shapes offered by Insert › Shape. Paths are drawn by PreSync in a
// 0–1000 box that stretches over the block (the `path` shape's format,
// shared with import and export), so each one stays editable and exports
// to PowerPoint as a freeform and to PDF as vector outlines.

const star = (points, inner) => {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : 500;
    const a = (Math.PI * i) / points - Math.PI / 2;
    out.push(`${Math.round(500 + r * Math.cos(a))} ${Math.round(500 + r * Math.sin(a))}`);
  }
  return `M${out.join(' L')} Z`;
};

const polygon = (sides) => {
  const out = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides - Math.PI / 2;
    out.push(`${Math.round(500 + 500 * Math.cos(a))} ${Math.round(500 + 500 * Math.sin(a))}`);
  }
  return `M${out.join(' L')} Z`;
};

export const SHAPE_GROUPS = [
  {
    id: 'basic', label: 'Basic',
    shapes: [
      { id: 'rect', label: 'Rectangle', shape: 'rect' },
      { id: 'roundRect', label: 'Rounded rectangle', shape: 'roundRect' },
      { id: 'ellipse', label: 'Ellipse', shape: 'ellipse' },
      { id: 'triangle', label: 'Triangle', path: 'M500 0 L1000 1000 L0 1000 Z' },
      { id: 'rightTriangle', label: 'Right triangle', path: 'M0 0 L1000 1000 L0 1000 Z' },
      { id: 'diamond', label: 'Diamond', path: 'M500 0 L1000 500 L500 1000 L0 500 Z' },
      { id: 'pentagon', label: 'Pentagon', path: polygon(5) },
      { id: 'hexagon', label: 'Hexagon', path: 'M250 0 L750 0 L1000 500 L750 1000 L250 1000 L0 500 Z' },
      { id: 'parallelogram', label: 'Parallelogram', path: 'M200 0 L1000 0 L800 1000 L0 1000 Z' },
      { id: 'trapezoid', label: 'Trapezoid', path: 'M200 0 L800 0 L1000 1000 L0 1000 Z' },
      { id: 'plus', label: 'Plus', path: 'M350 0 L650 0 L650 350 L1000 350 L1000 650 L650 650 L650 1000 L350 1000 L350 650 L0 650 L0 350 L350 350 Z' },
      { id: 'frame', label: 'Frame', path: 'M0 0 L1000 0 L1000 1000 L0 1000 Z M100 100 L100 900 L900 900 L900 100 Z' }
    ]
  },
  {
    id: 'arrows', label: 'Lines and arrows',
    shapes: [
      { id: 'line', label: 'Line', shape: 'line' },
      { id: 'arrowRight', label: 'Arrow right', path: 'M0 300 L600 300 L600 0 L1000 500 L600 1000 L600 700 L0 700 Z' },
      { id: 'arrowLeft', label: 'Arrow left', path: 'M1000 300 L400 300 L400 0 L0 500 L400 1000 L400 700 L1000 700 Z' },
      { id: 'arrowUp', label: 'Arrow up', path: 'M300 1000 L300 400 L0 400 L500 0 L1000 400 L700 400 L700 1000 Z' },
      { id: 'arrowDown', label: 'Arrow down', path: 'M300 0 L300 600 L0 600 L500 1000 L1000 600 L700 600 L700 0 Z' },
      { id: 'arrowBoth', label: 'Double arrow', path: 'M0 500 L250 0 L250 300 L750 300 L750 0 L1000 500 L750 1000 L750 700 L250 700 L250 1000 Z' },
      { id: 'chevron', label: 'Chevron', path: 'M0 0 L700 0 L1000 500 L700 1000 L0 1000 L300 500 Z' },
      { id: 'pointer', label: 'Pointer', path: 'M0 0 L750 0 L1000 500 L750 1000 L0 1000 Z' },
      { id: 'thinArrow', label: 'Thin arrow', path: 'M0 440 L820 440 L820 260 L1000 500 L820 740 L820 560 L0 560 Z' }
    ]
  },
  {
    id: 'callouts', label: 'Stars and callouts',
    shapes: [
      { id: 'star5', label: 'Star', path: star(5, 200) },
      { id: 'star8', label: 'Burst', path: star(8, 330) },
      { id: 'heart', label: 'Heart', path: 'M500 1000 C150 750 0 520 0 300 C0 120 140 0 290 0 C390 0 460 60 500 140 C540 60 610 0 710 0 C860 0 1000 120 1000 300 C1000 520 850 750 500 1000 Z' },
      { id: 'speech', label: 'Speech bubble', path: 'M80 0 L920 0 Q1000 0 1000 80 L1000 640 Q1000 720 920 720 L420 720 L200 1000 L240 720 L80 720 Q0 720 0 640 L0 80 Q0 0 80 0 Z' },
      { id: 'banner', label: 'Banner', path: 'M0 0 L1000 0 L880 500 L1000 1000 L0 1000 L120 500 Z' },
      { id: 'badge', label: 'Badge', path: polygon(8) }
    ]
  }
];

export const SHAPES = SHAPE_GROUPS.flatMap((g) => g.shapes);

export function shapeById(id) {
  return SHAPES.find((s) => s.id === id) || null;
}

// The block fields for a preset (shape, and path for freeforms).
export function shapeFields(preset) {
  return preset.path ? { shape: 'path', path: preset.path } : { shape: preset.shape };
}
