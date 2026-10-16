import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import LoginPage from './LoginPage.jsx';
import { login, register } from '../data/authApi.js';
import { renderAt } from '../test/renderAt.jsx';

vi.mock('../data/authApi.js', () => ({ login: vi.fn(), register: vi.fn() }));

function renderLogin(entry = '/login') {
  renderAt(entry, <Route path="/login" element={<LoginPage />} />);
  return userEvent.setup();
}

async function fillCredentials(user) {
  await user.type(screen.getByPlaceholderText('you@example.com'), ' priya@example.com ');
  await user.type(screen.getByPlaceholderText('••••••••'), 'hunter22');
}

describe('LoginPage', () => {
  it('requires an email and password', async () => {
    const user = renderLogin();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Email and password are required.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in and goes to the decks page by default', async () => {
    login.mockResolvedValue({ id: 'u1' });
    const user = renderLogin();
    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(login).toHaveBeenCalledWith({ email: 'priya@example.com', password: 'hunter22' });
    expect(await screen.findByTestId('location')).toHaveTextContent('/decks');
  });

  it('returns to the ?next= page after a session-expiry redirect', async () => {
    login.mockResolvedValue({ id: 'u1' });
    const user = renderLogin('/login?next=%2Feditor%2Fd1');
    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/editor/d1');
  });

  it('registers with a name in create-account mode', async () => {
    register.mockResolvedValue({ id: 'u1' });
    const user = renderLogin();
    await user.click(screen.getByRole('button', { name: 'Create one' }));
    await user.type(screen.getByPlaceholderText('e.g. Priya Shah'), 'Priya Shah');
    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(register).toHaveBeenCalledWith({
      email: 'priya@example.com',
      password: 'hunter22',
      name: 'Priya Shah'
    });
    expect(login).not.toHaveBeenCalled();
  });

  it('shows the backend error and stays on the page', async () => {
    login.mockRejectedValue(new Error('Invalid email or password'));
    const user = renderLogin();
    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(screen.queryByTestId('location')).not.toBeInTheDocument();
  });
});
