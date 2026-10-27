import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContextToolbar from './ContextToolbar.jsx';
import InsertMenu from './InsertMenu.jsx';
import TableEditor from './TableEditor.jsx';
import ChartEditor from './ChartEditor.jsx';
import SlideRail from './SlideRail.jsx';
import { makeTable } from '../../data/tableOps.js';
import { defaultChart } from '../../data/chartOps.js';

const actions = () => new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
const slide = { id: 's1', blocks: [] };

describe('ContextToolbar', () => {
  it('shows text tools for a text box and toggles lists and bold', async () => {
    const a = actions();
    const block = { id: 'b', type: 'textbox', text: 'One\nTwo', fontSize: 18, fontWeight: 'bold' };
    render(<ContextToolbar slide={slide} selectedBlocks={[block]} primary={block} selection={{}} actions={a} painting={false} />);
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Numbered list' }));
    expect(a.list).toHaveBeenCalledWith('number');
    await userEvent.click(screen.getByRole('button', { name: 'Italic' }));
    expect(a.toggle).toHaveBeenCalledWith('fontStyle', 'italic', 'normal');
    await userEvent.click(screen.getByRole('button', { name: 'Increase font size' }));
    expect(a.format).toHaveBeenCalledWith({ fontSize: 20 });
    await userEvent.click(screen.getByRole('button', { name: 'Superscript' }));
    expect(a.script).toHaveBeenCalledWith('super');
  });

  it('finds fonts by name and applies the one picked', async () => {
    const a = actions();
    const block = { id: 'b', type: 'textbox', text: 'Hi', fontSize: 18 };
    render(<ContextToolbar slide={slide} selectedBlocks={[block]} primary={block} selection={{}} actions={a} painting={false} />);
    await userEvent.click(screen.getByRole('button', { name: /^Font:/ }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search fonts' }), 'garamond');
    await userEvent.click(screen.getByRole('option', { name: /EB Garamond/ }));
    expect(a.format).toHaveBeenCalledWith({ fontFamily: '"EB Garamond", serif' });
  });

  it('offers layouts and themes when nothing is selected', async () => {
    const a = actions();
    render(<ContextToolbar slide={slide} selectedBlocks={[]} selection={{}} actions={a} />);
    await userEvent.click(screen.getByRole('button', { name: 'Theme' }));
    const card = screen.getByText('Harbor').closest('.theme-card');
    await userEvent.click(within(card).getByRole('button', { name: 'All' }));
    expect(a.applyTheme).toHaveBeenCalledWith('harbor', true);
    await userEvent.click(screen.getByRole('button', { name: 'Layout' }));
    await userEvent.click(screen.getByRole('button', { name: /Comparison/ }));
    expect(a.applyLayout).toHaveBeenCalledWith('comparison');
  });

  it('aligns and groups from the Arrange menu, and unlocks locked elements', async () => {
    const a = actions();
    const blocks = [{ id: 'a', type: 'shape', locked: true }, { id: 'b', type: 'shape', locked: true }];
    render(<ContextToolbar slide={slide} selectedBlocks={blocks} selection={{}} actions={a} />);
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(a.lock).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Arrange' }));
    expect(screen.getByRole('menuitem', { name: 'Distribute horizontally' })).toBeDisabled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Align middle' }));
    expect(a.align).toHaveBeenCalledWith('middle');
  });
});

describe('InsertMenu', () => {
  it('inserts a table of the size picked', async () => {
    const onTable = vi.fn();
    render(<InsertMenu onText={vi.fn()} onShape={vi.fn()} onTable={onTable} onChart={vi.fn()} onImage={vi.fn()} onDivider={vi.fn()} onSlide={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await userEvent.click(screen.getByRole('tab', { name: /Table/ }));
    await userEvent.click(screen.getByRole('button', { name: '3 by 5 table' }));
    expect(onTable).toHaveBeenCalledWith(3, 5);
  });

  it('inserts shapes and text styles', async () => {
    const onShape = vi.fn();
    const onText = vi.fn();
    render(<InsertMenu onText={onText} onShape={onShape} onTable={vi.fn()} onChart={vi.fn()} onImage={vi.fn()} onDivider={vi.fn()} onSlide={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await userEvent.click(screen.getByRole('button', { name: 'Heading' }));
    expect(onText.mock.calls[0][0]).toMatchObject({ id: 'heading', fontWeight: 'bold' });
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await userEvent.click(screen.getByRole('tab', { name: /Shapes/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Arrow right' }));
    expect(onShape.mock.calls[0][0]).toMatchObject({ id: 'arrowRight' });
  });
});

describe('TableEditor', () => {
  it('edits cells, merges a range and adds rows', async () => {
    let table = makeTable(2, 3, { width: 300 });
    const onChange = vi.fn((t) => { table = t; });
    const { rerender } = render(<TableEditor block={{ id: 't', table }} onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Row 1, column 1' }), 'A');
    expect(table.rows[0].cells[0].text).toBe('A');
    rerender(<TableEditor block={{ id: 't', table }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('textbox', { name: 'Row 1, column 1' }));
    fireEvent.mouseDown(screen.getByRole('textbox', { name: 'Row 1, column 2' }), { shiftKey: true });
    rerender(<TableEditor block={{ id: 't', table }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Merge cells/ }));
    expect(table.rows[0].cells[0].colspan).toBe(2);
    rerender(<TableEditor block={{ id: 't', table }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Row below/ }));
    expect(table.rows).toHaveLength(3);
  });
});

describe('ChartEditor', () => {
  it('changes values and the chart type', async () => {
    let chart = defaultChart();
    const onChange = vi.fn((c) => { chart = c; });
    render(<ChartEditor block={{ id: 'c', chart }} onChange={onChange} />);
    const cell = screen.getByRole('textbox', { name: 'This year, Q3' });
    await userEvent.clear(cell);
    await userEvent.type(cell, '75{Enter}');
    expect(chart.series[0].values[2]).toBe(75);
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'pie');
    expect(chart.kind).toBe('pie');
  });
});

describe('SlideRail naming and hiding', () => {
  it('renames and hides a slide from its menu', async () => {
    const onRename = vi.fn();
    const onToggleHidden = vi.fn();
    const slides = [{ id: 's1', notes: '', blocks: [] }, { id: 's2', notes: '', blocks: [], hidden: true, name: 'Backup' }];
    render(<SlideRail slides={slides} activeIdx={0} peers={[]} onSelect={vi.fn()} onAdd={vi.fn()} onDuplicate={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} onRename={onRename} onToggleHidden={onToggleHidden} />);
    expect(screen.getByRole('button', { name: 'Slide 2: Backup, hidden' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Slide 2 actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Show slide' }));
    expect(onToggleHidden).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: 'Slide 1 actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name for slide 1' }), 'Intro{Enter}');
    expect(onRename).toHaveBeenCalledWith(0, 'Intro');
  });
});
