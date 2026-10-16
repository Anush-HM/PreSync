import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';

function renderApp(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe('App routes', () => {
  it('shows the 404 page for unknown paths', () => {
    renderApp('/no-such-page');
    expect(screen.getByRole('heading', { name: '404' })).toBeInTheDocument();
  });

  it('lets viewers reach the join page without an account', async () => {
    renderApp('/join');
    expect(await screen.findByRole('heading', { name: 'Enter the room code' })).toBeInTheDocument();
  });

  it('sends signed-out users from the decks page to login', async () => {
    renderApp('/decks');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });
});
