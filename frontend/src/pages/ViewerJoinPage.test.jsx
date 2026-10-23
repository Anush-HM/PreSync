import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import ViewerJoinPage from './ViewerJoinPage.jsx';
import { joinRoomByCode } from '../data/roomsApi.js';
import { renderAt } from '../test/renderAt.jsx';

vi.mock('../data/roomsApi.js', () => ({ joinRoomByCode: vi.fn() }));

function renderJoin() {
  renderAt('/join', <Route path="/join" element={<ViewerJoinPage />} />);
  return userEvent.setup();
}

describe('ViewerJoinPage', () => {
  it('asks for a code before calling the backend', async () => {
    const user = renderJoin();
    await user.type(screen.getByPlaceholderText('e.g. Priya'), 'Priya');
    await user.click(screen.getByRole('button', { name: 'Join session' }));
    expect(screen.getByText('Enter the code your presenter shared.')).toBeInTheDocument();
    expect(joinRoomByCode).not.toHaveBeenCalled();
  });

  it('asks for a display name before calling the backend', async () => {
    const user = renderJoin();
    await user.type(screen.getByPlaceholderText('e.g. K7QX2M'), 'k7qx2m');
    await user.click(screen.getByRole('button', { name: 'Join session' }));
    expect(screen.getByText(/Add a display name/)).toBeInTheDocument();
    expect(joinRoomByCode).not.toHaveBeenCalled();
  });

  it('joins with an upper-cased code and opens the live view', async () => {
    joinRoomByCode.mockResolvedValue({ viewerId: 'v1', roomId: 'r1', currentSlideId: 's1' });
    const user = renderJoin();
    await user.type(screen.getByPlaceholderText('e.g. K7QX2M'), 'k7qx2m');
    await user.type(screen.getByPlaceholderText('e.g. Priya'), '  Priya ');
    await user.click(screen.getByRole('button', { name: 'Join session' }));

    expect(joinRoomByCode).toHaveBeenCalledWith('K7QX2M', 'Priya');
    const location = await screen.findByTestId('location');
    expect(location).toHaveTextContent('/view/K7QX2M');
    expect(JSON.parse(location.dataset.state)).toEqual({
      displayName: 'Priya',
      viewerId: 'v1',
      currentSlideId: 's1'
    });
  });

  it('shows the error when the join fails', async () => {
    joinRoomByCode.mockRejectedValue(new Error('Session has ended'));
    const user = renderJoin();
    await user.type(screen.getByPlaceholderText('e.g. K7QX2M'), 'ABCD');
    await user.type(screen.getByPlaceholderText('e.g. Priya'), 'Priya');
    await user.click(screen.getByRole('button', { name: 'Join session' }));
    expect(await screen.findByText('Session has ended')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join session' })).toBeEnabled();
  });
});
