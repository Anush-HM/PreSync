import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InviteDialog from './InviteDialog.jsx';
import ConnectionPill from './ConnectionPill.jsx';
import { joinLinkFor } from './joinLink.js';

describe('joinLinkFor', () => {
  it('points at the join page with the code filled in', () => {
    expect(joinLinkFor('K7QX2M', 'https://presync.app')).toBe('https://presync.app/join?code=K7QX2M');
  });
});

describe('InviteDialog', () => {
  it('shows the code, the join link and a QR code for that link', () => {
    render(<InviteDialog code="K7QX2M" onClose={() => {}} />);
    expect(screen.getByText('K7QX2M')).toBeInTheDocument();
    expect(screen.getByLabelText('Join link')).toHaveValue(`${window.location.origin}/join?code=K7QX2M`);
    const qr = screen.getByRole('img', { name: /QR code that opens the join page for session K7QX2M/ });
    expect(qr.querySelector('path').getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);
  });

  it('copies the code', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<InviteDialog code="K7QX2M" onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith('K7QX2M');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});

describe('ConnectionPill', () => {
  it.each([
    ['connecting', 'Connecting…'],
    ['live', 'Live'],
    ['reconnecting', 'Reconnecting…'],
    ['ended', 'Ended']
  ])('labels the %s state', (state, label) => {
    render(<ConnectionPill state={state} />);
    expect(screen.getByRole('status')).toHaveTextContent(label);
  });
});
