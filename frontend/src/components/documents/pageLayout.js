// What each page shows around the text. Keep these rules in step with
// the page layout section of backend services/documentContent.js, which
// the .docx and PDF exports use.

export const PAGE_GAP = 24;
export const DEFAULT_ZONE_INCHES = 0.5;
const EMPTY_SLOTS = { left: '', center: '', right: '' };
const PT_PX = 96 / 72;

export const BORDER_STYLES = [
  { id: 'solid', label: 'Solid' },
  { id: 'double', label: 'Double line' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'groove', label: 'Grooved' }
];
export const BORDER_WIDTHS = [0.5, 1, 1.5, 2.25, 3, 4.5, 6];
export const BORDER_COLORS = [
  { id: '#000000', label: 'Black' },
  { id: '#5b625d', label: 'Dark gray' },
  { id: '#2e5e4e', label: 'Forest green' },
  { id: '#16324f', label: 'Deep navy' }
];
export const MAX_BORDER_INSET = 31;

export const NUMBER_POSITIONS = [
  { id: 'top-center', label: 'Header, top centre' },
  { id: 'top-right', label: 'Header, top right' },
  { id: 'bottom-center', label: 'Footer, bottom centre' },
  { id: 'bottom-right', label: 'Footer, bottom right' }
];

export const PAGE_NUMBER_TOKENS = [
  { label: '1', text: '{page}' },
  { label: 'Page 1', text: 'Page {page}' },
  { label: 'Page 1 of 5', text: 'Page {page} of {pages}' }
];

const slots = (left, center, right) => ({ left, center, right });
export const HEADER_PRESETS = [
  { id: 'basic', label: 'Basic', slots: slots('{title}', '', ''), rule: false },
  { id: 'threeColumn', label: 'Three-column (academic)', slots: slots('{title}', 'Department / College Name', '{date}'), rule: false },
  { id: 'accent', label: 'Accent line', slots: slots('{title}', '', ''), rule: true },
  { id: 'titlePage', label: 'Title & page number', slots: slots('{title}', '', 'Page {page}'), rule: false }
];
export const FOOTER_PRESETS = [
  { id: 'number', label: 'Centered number', slots: slots('', '{page}', ''), rule: false },
  { id: 'pageNumber', label: 'Centered Page 1', slots: slots('', 'Page {page}', ''), rule: false },
  { id: 'split', label: 'Split academic', slots: slots('Author name / USN', '', 'Page {page} of {pages}'), rule: false },
  { id: 'threePart', label: 'Three-part', slots: slots('Confidential', 'Page {page}', '{date}'), rule: false },
  { id: 'topBorder', label: 'Top border', slots: slots('', '{page}', ''), rule: true }
];

export function parsePageRanges(text) {
  const pages = new Set();
  for (const part of String(text || '').split(',')) {
    const m = /^\s*(\d{1,4})\s*(?:-\s*(\d{1,4})\s*)?$/.exec(part);
    if (!m) continue;
    const from = Number(m[1]);
    const to = Math.min(Number(m[2] || m[1]), from + 2000);
    for (let n = from; n <= to; n++) pages.add(n);
  }
  return pages;
}

export function borderOnPage(border, pageIndex) {
  if (!border) return false;
  if (border.scope === 'first') return pageIndex === 0;
  if (border.scope === 'exceptFirst') return pageIndex > 0;
  if (border.scope === 'pages') return parsePageRanges(border.pages).has(pageIndex + 1);
  return true;
}

// Odd pages use header and footer; even pages their own when asked.
export function zoneSource(layout, pageIndex) {
  return layout.differentOddEven && pageIndex % 2 === 1 ? 'even' : 'main';
}

export function zoneSlots(layout, zone, pageIndex) {
  const source = zoneSource(layout, pageIndex) === 'even' ? layout.even : layout;
  return source?.[zone] || EMPTY_SLOTS;
}

export function zoneRule(layout, zone, pageIndex) {
  if (pageIndex === 0 && layout.differentFirstPage) return false;
  return !!layout[`${zone}Rule`];
}

export const zoneDistance = (layout, zone) => (layout[`${zone}Distance`] ?? DEFAULT_ZONE_INCHES) * 96;

export function dateTexts(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    { label: 'DD/MM/YYYY', text: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}` },
    { label: 'Month DD, YYYY', text: now.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }) }
  ];
}

export function zoneTexts(layout, zone, pageIndex) {
  const first = pageIndex === 0;
  const out = first && layout.differentFirstPage ? { ...EMPTY_SLOTS } : { ...zoneSlots(layout, zone, pageIndex) };
  const n = layout.pageNumbers;
  if (n && !(first && (n.hideOnFirst || layout.differentFirstPage))) {
    const [at, side] = n.position.split('-');
    if ((at === 'top') === (zone === 'header')) {
      const number = n.format === 'pageOf' ? 'Page {page} of {pages}' : '{page}';
      out[side] = out[side] ? `${out[side]} ${number}` : number;
    }
  }
  return out;
}

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function fillTokens(text, { page, pages, title }) {
  return text.replace(/\{(page|pages|title|date)\}/g, (_, t) => ({ page, pages, title, date: today() })[t]);
}

// The border as CSS for a box over the page.
export function borderStyle(border) {
  const inset = border.inset * PT_PX;
  const line = `${border.width}pt ${border.style === 'groove' ? 'groove' : border.style} ${border.color}`;
  const side = (on) => (on ? line : 'none');
  return {
    inset,
    borderTop: side(border.sides.top),
    borderRight: side(border.sides.right),
    borderBottom: side(border.sides.bottom),
    borderLeft: side(border.sides.left)
  };
}
