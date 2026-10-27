import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SlideView from './SlideView.jsx';

describe('SlideView', () => {
  it('renders block formatting and the slide background', () => {
    const { container } = render(
      <SlideView
        slide={{
          backgroundColor: '#112233',
          blocks: [
            {
              id: 'b1', type: 'textbox', x: 10, y: 20, width: 300, fontSize: 24, text: 'Styled',
              fontWeight: 'bold', fontStyle: 'italic', underline: true, fill: '#e74c3c',
              textAlign: 'center', fontFamily: 'Georgia, serif'
            },
            { id: 'b2', type: 'textbox', x: 10, y: 80, width: 300, fontSize: 16, text: 'Plain' }
          ]
        }}
      />
    );
    expect(container.firstChild).toHaveStyle({ backgroundColor: '#112233' });
    expect(screen.getByText('Styled').closest('.slide-text')).toHaveStyle({
      fontWeight: 'bold',
      fontStyle: 'italic',
      textDecoration: 'underline',
      color: '#e74c3c',
      textAlign: 'center',
      fontFamily: 'Georgia, serif',
      left: '10px',
      top: '20px'
    });
    expect(screen.getByText('Plain').closest('.slide-text')).toHaveStyle({ fontWeight: 'normal', textAlign: 'left', color: '#1a1a2e' });
  });

  it('keeps mixed formatting, list hanging indents and paragraph spacing', () => {
    const { container } = render(
      <SlideView
        slide={{
          blocks: [
            {
              id: 'b1', type: 'textbox', x: 0, y: 0, width: 300, fontSize: 18,
              text: '•\u00a0\u00a0Bold label: normal text\nSecond paragraph',
              styles: [{ start: 3, end: 14, style: { fontWeight: 'bold' } }],
              paragraphSpacing: 6
            }
          ]
        }}
      />
    );
    const bold = screen.getByText('Bold label:');
    expect(bold.tagName).toBe('SPAN');
    expect(bold).toHaveStyle({ fontWeight: 'bold' });
    const paras = container.querySelectorAll('.slide-para');
    expect(paras).toHaveLength(2);
    expect(paras[0]).toHaveClass('is-list');
    expect(paras[0].querySelector('.slide-marker').textContent).toBe('•\u00a0\u00a0');
    expect(paras[1]).toHaveStyle({ marginTop: '6px' });
  });

  it('draws shapes, tables and gradient backgrounds', () => {
    const { container } = render(
      <SlideView
        slide={{
          backgroundGradient: { angle: 180, stops: [{ pos: 0, color: '#102a43' }, { pos: 1, color: '#2e5e4e' }] },
          blocks: [
            { id: 's', type: 'shape', shape: 'ellipse', x: 10, y: 10, width: 100, height: 50, background: '#c89b3c', stroke: '#ffffff', strokeWidth: 2 },
            {
              id: 't', type: 'table', x: 0, y: 100, width: 200, height: 60, text: '',
              table: {
                columns: [100, 100],
                rows: [
                  { height: 30, cells: [{ text: 'Head', colspan: 2, background: '#1f3864', fill: '#ffffff' }, { text: '', covered: true }] },
                  { height: 30, cells: [{ text: 'A' }, { text: 'B', borders: { top: { color: '#000000', width: 1 } } }] }
                ]
              }
            }
          ]
        }}
      />
    );
    expect(container.firstChild.style.backgroundImage).toContain('linear-gradient(180deg');
    const ellipse = container.querySelector('ellipse');
    expect(ellipse.getAttribute('fill')).toBe('#c89b3c');
    expect(ellipse.getAttribute('stroke')).toBe('#ffffff');
    const head = screen.getByText('Head').closest('td');
    expect(head).toHaveAttribute('colspan', '2');
    expect(head).toHaveStyle({ background: '#1f3864', color: '#ffffff' });
    expect(container.querySelectorAll('tr')[0].querySelectorAll('td')).toHaveLength(1);
  });

  it('draws charts from their data with an accessible summary', () => {
    const { container } = render(
      <SlideView
        slide={{
          blocks: [{
            id: 'c1', type: 'chart', x: 40, y: 30, width: 400, height: 240, fontSize: 16, text: '',
            chart: { kind: 'column', title: 'Results', categories: ['Precision', 'Recall'], series: [{ name: 'Model', values: [0.91, 0.88], color: '#4f81bd' }] }
          }]
        }}
      />
    );
    const svg = container.querySelector('svg.slide-chart');
    expect(svg).toHaveStyle({ left: '40px', top: '30px' });
    expect(svg.getAttribute('aria-label')).toMatch(/Column chart: Results\. Model: Precision 0\.91, Recall 0\.88/);
    const bars = [...svg.querySelectorAll('rect')].filter((r) => r.getAttribute('fill') === '#4f81bd');
    expect(bars).toHaveLength(2);
    expect(screen.getByText('Precision')).toBeInTheDocument();
  });
});
