import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import DocumentPreview from './DocumentPreview.jsx';

const style = { fontSize: 16, fontFamily: '"Times New Roman", serif', fontWeight: 'normal', fontStyle: 'normal', fill: '#000000' };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function preview(blocks, extra = {}) {
  const { container } = render(<DocumentPreview blocks={blocks} images={[{ id: 'img-1', dataUrl: PNG, widthPx: 100, heightPx: 100 }]} headings={[]} {...extra} />);
  // The visible pages, not the hidden copy used for measuring.
  return container.querySelector('.doc-paper');
}

describe('DocumentPreview', () => {
  it('turns tabs into boxes sized to the paragraph’s tab stops', () => {
    const paper = preview([
      { type: 'paragraph', text: 'Guide\tHOD', runs: [{ text: 'Guide', style }, { text: '\t', style }, { text: 'HOD', style }], layout: { tabs: [{ pos: 600, type: 'right', leader: 'none' }] } }
    ]);
    const p = paper.querySelector('p[data-tabs]');
    expect(JSON.parse(p.dataset.tabs)).toEqual([{ pos: 600, type: 'right', leader: 'none' }]);
    expect(p.querySelectorAll('.docp-tab')).toHaveLength(1);
    expect(p.textContent).toBe('Guide HOD');
  });

  it('keeps the slide marker out of the heading’s text flow', () => {
    const paper = preview([{ type: 'heading', level: 1, text: 'Acknowledgement', runs: [{ text: 'Acknowledgement', style }], layout: { align: 'center' } }], {
      headings: [{ blockIndex: 0, startsSlide: true }]
    });
    const heading = paper.querySelector('.doc-h1');
    expect(heading).toHaveClass('has-slide-marker');
    expect(heading.querySelector('.doc-slide-marker')).toHaveTextContent('New slide');
  });

  it('places floating pictures the way Word did', () => {
    const paper = preview([
      { type: 'image', imageId: 'img-1', float: { wrap: 'square', align: 'right' } },
      { type: 'image', imageId: 'img-1', float: { wrap: 'front', align: 'left', x: 40, y: 12 } },
      { type: 'image', imageId: 'img-1', float: { wrap: 'inline', align: 'center' } }
    ]);
    expect(paper.querySelector('.docp-float')).toHaveClass('is-right');
    expect(paper.querySelector('.docp-free-box')).toHaveStyle({ left: '40px', top: '12px' });
    expect(paper.querySelector('.doc-img-wrap')).toHaveStyle({ textAlign: 'center' });
  });

  it('uses class names that the document editor’s stylesheet does not style', () => {
    const paper = preview([{ type: 'title', text: 'Report', runs: [{ text: 'Report', style }] }, { type: 'paragraph', text: 'Body', runs: [{ text: 'Body', style }] }]);
    expect(paper.querySelector('.doc-flow, .doc-title, .doc-header, .doc-footer')).toBeNull();
    expect(paper.querySelector('.docp-title')).toHaveTextContent('Report');
  });
});
