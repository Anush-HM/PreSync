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
    expect(container.firstChild).toHaveStyle({ background: '#112233' });
    expect(screen.getByText('Styled')).toHaveStyle({
      fontWeight: 'bold',
      fontStyle: 'italic',
      textDecoration: 'underline',
      color: '#e74c3c',
      textAlign: 'center',
      fontFamily: 'Georgia, serif',
      left: '10px',
      top: '20px'
    });
    expect(screen.getByText('Plain')).toHaveStyle({ fontWeight: 'normal', textAlign: 'left', color: '#1a1a2e' });
  });
});
