import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Route } from 'react-router-dom';
import RequireAuth from './RequireAuth.jsx';
import { setAuthToken } from '../data/apiConfig.js';
import { renderAt } from '../test/renderAt.jsx';

const routes = (
  <Route path="/decks" element={<RequireAuth><p>Secret decks</p></RequireAuth>} />
);

describe('RequireAuth', () => {
  it('redirects signed-out users to login and remembers where they were going', () => {
    renderAt('/decks', routes);
    const location = screen.getByTestId('location');
    expect(location).toHaveTextContent('/login');
    expect(JSON.parse(location.dataset.state)).toEqual({ from: '/decks' });
    expect(screen.queryByText('Secret decks')).not.toBeInTheDocument();
  });

  it('renders the page for signed-in users', () => {
    setAuthToken('tok');
    renderAt('/decks', routes);
    expect(screen.getByText('Secret decks')).toBeInTheDocument();
  });
});
