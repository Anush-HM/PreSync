// Shapes offered in documents, named after their Word preset so .docx
// export can write them directly. Polygon points are in a 100×100 box;
// keep in step with POLYGONS in backend documentPdfService.js.
export const DOCUMENT_SHAPES = [
  { id: 'rect', label: 'Rectangle', width: 200, height: 120 },
  { id: 'roundRect', label: 'Rounded rectangle', width: 200, height: 120 },
  { id: 'ellipse', label: 'Ellipse', width: 160, height: 120 },
  { id: 'triangle', label: 'Triangle', width: 140, height: 120, points: '50,0 100,100 0,100' },
  { id: 'diamond', label: 'Diamond', width: 130, height: 130, points: '50,0 100,50 50,100 0,50' },
  { id: 'hexagon', label: 'Hexagon', width: 150, height: 130, points: '25,0 75,0 100,50 75,100 25,100 0,50' },
  { id: 'star5', label: 'Star', width: 130, height: 130, points: '50,0 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35' },
  { id: 'rightArrow', label: 'Arrow', width: 200, height: 100, points: '0,25 60,25 60,0 100,50 60,100 60,75 0,75' }
];
