import { useState } from 'react';
import Dialog from '../ui/Dialog.jsx';

// Only formats that really work are offered, and each says what it keeps.
const FORMATS = [
  {
    id: 'pdf', label: 'PDF', ext: '.pdf', options: ['hidden', 'notes'],
    keeps: 'Every slide drawn as it looks, with selectable text.',
    loses: 'Picture shadows and text highlight are not drawn. Text in fonts the server lacks uses a standard font.'
  },
  {
    id: 'pptx', label: 'PowerPoint', ext: '.pptx', options: [],
    keeps: 'Editable text, tables, native charts, shapes, pictures and speaker notes. Hidden slides stay in the file, marked hidden.',
    loses: 'Gradients become their first colour; picture borders are left out.'
  },
  {
    id: 'docx', label: 'Word outline', ext: '.docx', options: ['hidden', 'notes'],
    keeps: 'A document to read or edit: slide titles as headings, text with its formatting, tables, chart data, pictures and notes.',
    loses: 'Slide layout, positions and shapes are not kept. Slides that only exist as a picture stay a picture and are labelled.'
  },
  {
    id: 'png', label: 'Slide as PNG', ext: '.png', options: [], slideOnly: true,
    keeps: 'The current slide as an image at twice its size.',
    loses: 'Pictures linked from other websites can’t be included.'
  },
  {
    id: 'jpeg', label: 'Slide as JPEG', ext: '.jpg', options: [], slideOnly: true,
    keeps: 'The current slide as a smaller image file.',
    loses: 'Pictures linked from other websites can’t be included.'
  }
];

const OPTION_LABELS = {
  hidden: 'Include hidden slides',
  notes: 'Include speaker notes'
};

function ExportDialog({ hiddenCount = 0, onExport, onClose, busy }) {
  const [format, setFormat] = useState('pdf');
  const [options, setOptions] = useState({ hidden: false, notes: false, docxNotes: true });
  const spec = FORMATS.find((f) => f.id === format);
  const notesOn = format === 'docx' ? options.docxNotes : options.notes;

  function submit(e) {
    e.preventDefault();
    const chosen = spec.options.includes('hidden') || spec.options.includes('notes')
      ? { includeHidden: options.hidden, notes: notesOn }
      : undefined;
    onExport(format, chosen);
  }

  return (
    <Dialog
      title="Export"
      onClose={onClose}
      size="md"
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="export-form" className="btn btn-primary" disabled={busy}>{busy ? 'Exporting…' : `Download ${spec.ext}`}</button>
        </>
      }
    >
      <form id="export-form" className="export-form" onSubmit={submit}>
        <fieldset className="export-formats">
          <legend className="field-label">Format</legend>
          {FORMATS.map((f) => (
            <label key={f.id} className={`export-format${format === f.id ? ' is-on' : ''}`}>
              <input type="radio" name="format" value={f.id} checked={format === f.id} onChange={() => setFormat(f.id)} />
              <span className="export-format-name">{f.label}</span>
              <span className="export-format-ext mono">{f.ext}</span>
            </label>
          ))}
        </fieldset>
        <div className="export-about" aria-live="polite">
          <p><strong>Keeps:</strong> {spec.keeps}</p>
          <p className="field-hint"><strong>Not kept:</strong> {spec.loses}</p>
        </div>
        {spec.options.length > 0 && (
          <fieldset className="export-options">
            <legend className="field-label">Options</legend>
            {spec.options.includes('hidden') && (
              <label className="check">
                <input type="checkbox" checked={options.hidden} onChange={(e) => setOptions({ ...options, hidden: e.target.checked })} />
                {OPTION_LABELS.hidden}{hiddenCount ? ` (${hiddenCount})` : ''}
              </label>
            )}
            {spec.options.includes('notes') && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={notesOn}
                  onChange={(e) => setOptions(format === 'docx' ? { ...options, docxNotes: e.target.checked } : { ...options, notes: e.target.checked })}
                />
                {OPTION_LABELS.notes}{format === 'pdf' ? ' (a notes page after each slide that has notes)' : ''}
              </label>
            )}
          </fieldset>
        )}
      </form>
    </Dialog>
  );
}

export default ExportDialog;
