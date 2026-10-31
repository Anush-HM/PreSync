import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import ImportDialog from './ImportDialog.jsx';
import { uploadImport } from '../../data/importsApi.js';
import { uploadDocx } from '../../data/documentsApi.js';
import { renderAt } from '../../test/renderAt.jsx';

vi.mock('../../data/importsApi.js', async (orig) => {
  const real = await orig();
  return { ...real, uploadImport: vi.fn() };
});

vi.mock('../../data/documentsApi.js', () => ({ uploadDocx: vi.fn() }));

function renderDialog() {
  renderAt('/decks', <Route path="/decks" element={<ImportDialog kind="docx" onClose={() => {}} />} />);
  return userEvent.setup({ applyAccept: false });
}

const fileInput = () => document.querySelector('input[type="file"]');

beforeEach(() => vi.clearAllMocks());

describe('ImportDialog', () => {
  it('explains legacy .doc files instead of uploading them', async () => {
    const user = renderDialog();
    await user.upload(fileInput(), new File(['x'], 'old.doc'));
    expect(screen.getByRole('alert')).toHaveTextContent(/save it as \.docx/i);
    expect(uploadImport).not.toHaveBeenCalled();
  });

  it('rejects unsupported files and empty files', async () => {
    const user = renderDialog();
    await user.upload(fileInput(), new File(['x'], 'photo.png'));
    expect(screen.getByRole('alert')).toHaveTextContent(/isn’t a supported file/);
    await user.upload(fileInput(), new File([], 'empty.docx'));
    expect(screen.getByRole('alert')).toHaveTextContent('This file is empty.');
    expect(uploadImport).not.toHaveBeenCalled();
  });

  it('uploads a Word file, shows progress, and opens it in the document editor', async () => {
    let finish;
    let hooks;
    uploadDocx.mockImplementation((file, h) => {
      hooks = h;
      return { promise: new Promise((r) => { finish = r; }), abort: vi.fn() };
    });
    const user = renderDialog();
    await user.upload(fileInput(), new File(['hello'], 'plan.docx'));

    expect(uploadImport).not.toHaveBeenCalled();
    expect(screen.getByText('plan.docx')).toBeInTheDocument();
    hooks.onProgress(0.5);
    expect(await screen.findByText('50%')).toBeInTheDocument();
    hooks.onUploaded();
    expect(await screen.findByText(/Reading the document/)).toBeInTheDocument();

    finish({ id: 'doc-1' });
    expect(await screen.findByTestId('location')).toHaveTextContent('/documents/doc-1');
  });

  it('sends PowerPoint files to the review screen', async () => {
    uploadImport.mockReturnValue({ promise: Promise.resolve({ id: 'imp-1' }), abort: vi.fn() });
    const user = renderDialog();
    await user.upload(fileInput(), new File(['hello'], 'deck.pptx'));
    expect(await screen.findByTestId('location')).toHaveTextContent('/imports/imp-1');
    expect(uploadDocx).not.toHaveBeenCalled();
  });

  it('shows the server error and retries the same file', async () => {
    uploadDocx
      .mockImplementationOnce(() => ({ promise: Promise.reject(new Error('Could not read this Word document: broken')), abort: vi.fn() }))
      .mockReturnValueOnce({ promise: new Promise(() => {}), abort: vi.fn() });
    const user = renderDialog();
    await user.upload(fileInput(), new File(['hello'], 'plan.docx'));
    expect(await screen.findByRole('alert')).toHaveTextContent('broken');
    await user.click(screen.getByRole('button', { name: /Retry/ }));
    expect(uploadDocx).toHaveBeenCalledTimes(2);
  });

  it('cancels an upload in progress', async () => {
    const abort = vi.fn();
    uploadImport.mockReturnValue({ promise: new Promise(() => {}), abort });
    const user = renderDialog();
    await user.upload(fileInput(), new File(['hello'], 'deck.pptx'));
    await user.click(screen.getByRole('button', { name: /Cancel import/ }));
    expect(abort).toHaveBeenCalled();
  });
});
