import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ElementsPanel from './ElementsPanel.jsx';
import CommandPalette from './CommandPalette.jsx';
import ShortcutsDialog from './ShortcutsDialog.jsx';
import InsertMenu from './InsertMenu.jsx';
import Menu from '../ui/Menu.jsx';
import { ToastProvider } from '../ui/Toast.jsx';

vi.mock('../../data/templatesApi.js', () => ({
  listTemplates: vi.fn(),
  deleteTemplate: vi.fn(),
  createDeckFromTemplate: vi.fn(),
  createDeckFromStarter: vi.fn()
}));
const api = await import('../../data/templatesApi.js');
const { default: TemplateGallery } = await import('../templates/TemplateGallery.jsx');

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('ElementsPanel', () => {
  it('searches the library, filters by kind and inserts in the chosen icon colour', async () => {
    const onInsert = vi.fn();
    render(<ElementsPanel onInsert={onInsert} />);
    expect(screen.getByRole('searchbox', { name: 'Search elements' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Icons' }));
    await userEvent.type(screen.getByRole('searchbox'), 'security');
    expect(screen.getByRole('button', { name: 'Lock' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Launch rocket' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Icon colour #8f2638' }));
    await userEvent.click(screen.getByRole('button', { name: 'Shield' }));
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'icon-shield' }), '#8f2638');
  });

  it('remembers recently used elements and offers this deck’s pictures again', async () => {
    const onDeckImage = vi.fn();
    const img = { key: 's1:b1', url: 'data:image/png;base64,AAAA', alt: 'Team photo', width: 400, height: 300 };
    const { unmount } = render(<ElementsPanel onInsert={() => {}} deckImages={[img]} onDeckImage={onDeckImage} />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert Team photo' }));
    expect(onDeckImage).toHaveBeenCalledWith(img);
    await userEvent.click(screen.getAllByRole('button', { name: 'Trophy' })[0]);
    unmount();
    render(<ElementsPanel onInsert={() => {}} />);
    const recent = screen.getByRole('region', { name: 'Recently used' });
    expect(recent.querySelectorAll('.asset-tile')).toHaveLength(1);
  });

  it('says so when nothing matches', async () => {
    render(<ElementsPanel onInsert={() => {}} />);
    await userEvent.type(screen.getByRole('searchbox'), 'zzqqxx');
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it('opens from the Insert menu on request', async () => {
    const { rerender } = render(<InsertMenu onAsset={() => {}} deckImages={[]} />);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    rerender(<InsertMenu onAsset={() => {}} deckImages={[]} request={{ tab: 'elements' }} />);
    expect(await screen.findByRole('searchbox', { name: 'Search elements' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Elements' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('CommandPalette', () => {
  it('filters commands, moves with the arrow keys and runs the chosen one', async () => {
    const run = { a: vi.fn(), b: vi.fn(), c: vi.fn() };
    const onClose = vi.fn();
    const commands = [
      { id: 'a', label: 'Align left', group: 'Arrange', run: run.a },
      { id: 'b', label: 'Align right', group: 'Arrange', run: run.b },
      { id: 'c', label: 'Insert table', group: 'Insert', run: run.c, disabled: true }
    ];
    render(<CommandPalette commands={commands} onClose={onClose} />);
    const input = screen.getByRole('combobox', { name: 'Search commands' });
    expect(input).toHaveFocus();
    await userEvent.type(input, 'align');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(run.b).toHaveBeenCalled());
    expect(run.a).not.toHaveBeenCalled();
  });

  it('does not run a disabled command', async () => {
    const run = vi.fn();
    render(<CommandPalette commands={[{ id: 'x', label: 'Group', group: 'Arrange', run, disabled: true }]} onClose={() => {}} />);
    await userEvent.keyboard('{Enter}');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('ShortcutsDialog and Menu toggles', () => {
  it('lists the shortcuts by group', () => {
    render(<ShortcutsDialog onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Text' })).toHaveTextContent('Bulleted list');
  });

  it('shows a toggle item as a checkbox', async () => {
    const onSelect = vi.fn();
    render(<Menu label="More" icon={() => null} items={[{ label: 'Snap to guides', checked: true, onSelect }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const item = screen.getByRole('menuitemcheckbox', { name: 'Snap to guides' });
    expect(item).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(item);
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('TemplateGallery', () => {
  it('previews a starter template and creates a deck from it', async () => {
    api.listTemplates.mockResolvedValue([]);
    api.createDeckFromStarter.mockResolvedValue({ id: 'd1', title: 'Lesson plan' });
    const onCreated = vi.fn();
    render(<ToastProvider><TemplateGallery onClose={() => {}} onCreated={onCreated} /></ToastProvider>);
    await userEvent.click(screen.getByRole('option', { name: /Lesson plan/ }));
    expect(screen.getByRole('complementary', { name: 'Lesson plan preview' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use “Lesson plan”' }));
    expect(api.createDeckFromStarter).toHaveBeenCalledWith(expect.objectContaining({ id: 'lesson' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'd1', title: 'Lesson plan' }));
  });

  it('lists saved templates and deletes one', async () => {
    api.listTemplates.mockResolvedValue([{ id: 't1', name: 'Team pitch', description: 'Sales', slideCount: 3, thumbnail: null }]);
    api.deleteTemplate.mockResolvedValue(undefined);
    const onCreated = vi.fn();
    render(<ToastProvider><TemplateGallery onClose={() => {}} onCreated={onCreated} /></ToastProvider>);
    await userEvent.click(await screen.findByRole('tab', { name: 'My templates (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete template Team pitch' }));
    expect(api.deleteTemplate).toHaveBeenCalledWith('t1');
    expect(await screen.findByText('No saved templates yet.')).toBeInTheDocument();
  });
});
