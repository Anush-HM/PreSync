import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SlideRail from './SlideRail.jsx';
import PropertiesPanel from './PropertiesPanel.jsx';

const slide = (id, text) => ({ id, notes: '', blocks: [{ id: `${id}-b`, type: 'textbox', x: 10, y: 10, width: 300, fontSize: 24, text }] });

describe('SlideRail', () => {
  function setup(overrides = {}) {
    const props = {
      slides: [slide('s1', 'One'), slide('s2', 'Two'), slide('s3', 'Three')],
      activeIdx: 1,
      peers: [],
      onSelect: vi.fn(),
      onAdd: vi.fn(),
      onDuplicate: vi.fn(),
      onMove: vi.fn(),
      onDelete: vi.fn(),
      ...overrides
    };
    render(<SlideRail {...props} />);
    return props;
  }

  it('numbers every slide and marks the active one', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Slide 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Slide 2' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Slide 3' })).not.toHaveAttribute('aria-current');
  });

  it('moves between slides with the arrow keys', async () => {
    const props = setup();
    screen.getByRole('button', { name: 'Slide 2' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(props.onSelect).toHaveBeenLastCalledWith(2);
    await userEvent.keyboard('{Home}');
    expect(props.onSelect).toHaveBeenLastCalledWith(0);
  });

  it('runs actions for the slide whose menu was opened', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Slide 3 actions' }));
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(props.onMove).toHaveBeenCalledWith(2, -1);
    await userEvent.click(screen.getByRole('button', { name: 'Slide 1 actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete slide' }));
    expect(props.onDelete).toHaveBeenCalledWith(0);
  });

  it('does not offer deleting the only slide', async () => {
    setup({ slides: [slide('s1', 'Only')], activeIdx: 0 });
    await userEvent.click(screen.getByRole('button', { name: 'Slide 1 actions' }));
    expect(screen.getByRole('menuitem', { name: 'Delete slide' })).toBeDisabled();
  });

  // Test H: the sidebar lists each slide's own title, in order, and falls
  // back to "Slide N" for slides without one; the list scrolls on its own.
  it('labels slides with their real titles, falling back to the slide number', () => {
    const titled = (id, title, body) => ({
      id,
      notes: '',
      blocks: [
        { id: `${id}-d`, type: 'textbox', role: 'decor', x: 0, y: 0, width: 200, fontSize: 40, text: 'Company' },
        ...(title ? [{ id: `${id}-t`, type: 'textbox', role: 'title', x: 10, y: 10, width: 600, fontSize: 32, text: title }] : []),
        { id: `${id}-b`, type: 'textbox', x: 10, y: 100, width: 600, fontSize: 18, text: body }
      ]
    });
    const slides = [titled('a', null, 'Cover text'), titled('b', 'Table of Contents', '1. Introduction'), titled('c', 'Introduction', 'Body')];
    setup({ slides, activeIdx: 0 });
    expect(screen.getByRole('button', { name: /^Slide 1$/ })).toBeInTheDocument();
    expect([...document.querySelectorAll('.rail-title')].map((e) => e.textContent)).toEqual(['Slide 1', 'Table of Contents', 'Introduction']);
    expect(screen.getByRole('button', { name: /^Slide 2: Table of Contents/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Slide 3: Introduction/ })).toBeInTheDocument();
    expect(document.querySelector('.rail-list')).toBeInTheDocument();
  });

  it('names collaborators viewing a slide', () => {
    setup({ peers: [{ clientId: 7, name: 'Ada', color: '#A3D4B2', activeSlideIdx: 0 }] });
    expect(screen.getByRole('button', { name: 'Slide 1, Ada here' })).toBeInTheDocument();
  });
});

describe('PropertiesPanel', () => {
  const base = {
    slide: { id: 's1', backgroundColor: '#ffffff', blocks: [] },
    slideIndex: 0,
    onFormat: vi.fn(),
    onToggle: vi.fn(),
    onRestack: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onBackground: vi.fn()
  };

  it('shows slide settings when nothing is selected', async () => {
    const onBackground = vi.fn();
    render(<PropertiesPanel {...base} onBackground={onBackground} selectedBlocks={[]} primary={undefined} />);
    expect(screen.getByRole('heading', { name: 'Slide 1' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Text style' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Slide background #1a1a2e' }));
    expect(onBackground).toHaveBeenCalledWith('#1a1a2e');
  });

  it('formats the selected text', async () => {
    const block = { id: 'b1', type: 'textbox', fontSize: 24, fontWeight: 'bold', textAlign: 'left' };
    const onFormat = vi.fn();
    const onToggle = vi.fn();
    render(<PropertiesPanel {...base} onFormat={onFormat} onToggle={onToggle} selectedBlocks={[block]} primary={block} />);
    expect(screen.getByRole('heading', { name: 'Text' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Italic' }));
    expect(onToggle).toHaveBeenCalledWith('fontStyle', 'italic', 'normal');
    await userEvent.click(screen.getByRole('button', { name: 'Increase font size' }));
    expect(onFormat).toHaveBeenCalledWith({ fontSize: 26 });
    await userEvent.click(screen.getByRole('button', { name: 'Align center' }));
    expect(onFormat).toHaveBeenCalledWith({ textAlign: 'center' });
  });

  it('only allows restacking a single element', () => {
    const a = { id: 'a', type: 'textbox', fontSize: 16 };
    const b = { id: 'b', type: 'image', fontSize: 16 };
    render(<PropertiesPanel {...base} selectedBlocks={[a, b]} primary={a} />);
    expect(screen.getByRole('heading', { name: '2 elements' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'To front' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeEnabled();
  });
});
