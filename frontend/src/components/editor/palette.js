// Colours offered in every colour menu: PreSync's palette first (forest,
// charcoal, crimson and their tints), then a neutral and accent row.
export const PALETTE = [
  '#171a19', '#2b302d', '#5b625d', '#8a8f88', '#c9cec9', '#f2f4f0', '#ffffff',
  '#1d4532', '#285c43', '#347653', '#76c893', '#a3d4b2', '#d6e8dc', '#eef3ef',
  '#5e1823', '#8f2638', '#ac3045', '#f08a98', '#f0a1ad', '#f6dde1', '#fbf6f2',
  '#16324f', '#2f6f9f', '#4f6d9a', '#c89b3c', '#e4b66a', '#d27a3a', '#7a5a8c'
];

export const HIGHLIGHTS = ['#fff3a3', '#d6f5c9', '#cde7ff', '#ffd9e0', '#ffe4c2', '#e6dcff'];

// Keeps toolbar buttons from taking focus, so a text selection being
// edited on the canvas stays selected while it is formatted.
export function keepCanvasFocus(e) {
  if (e.target.closest('button')) e.preventDefault();
}
