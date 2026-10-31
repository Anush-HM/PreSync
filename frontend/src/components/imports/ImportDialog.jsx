import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, FileText, Presentation, FileType2, RotateCcw, X, CheckCircle2, AlertCircle } from 'lucide-react';
import Dialog from '../ui/Dialog.jsx';
import { formatBytes } from '../../data/format.js';
import { IMPORT_ACCEPT_ALL, MAX_IMPORT_MB, uploadImport, validateImportFile } from '../../data/importsApi.js';
import { uploadDocx } from '../../data/documentsApi.js';
import { FORMAT_ICON } from './formatIcons.js';
import './imports.css';

const TITLES = {
  any: 'Import a file',
  docx: 'Import a Word document',
  pptx: 'Import a PowerPoint'
};

const DESCRIPTIONS = {
  any: 'Word documents open in the document editor. PowerPoint and PDF files are analysed so you can review them before anything is created.',
  docx: 'The document opens in the document editor, ready to edit and download.',
  pptx: 'PreSync reads the file’s structure and shows you what it found before anything is created.'
};

// Drag-and-drop upload with progress, cancel and retry. On success a
// Word file opens in the document editor, and anything else on the
// review screen for the analysed file.
// phase: idle → uploading → analyzing → (navigate) | error
function ImportDialog({ kind = 'any', onClose }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const uploadRef = useRef(null);
  const [file, setFile] = useState(null);
  const [format, setFormat] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  // Abort an in-flight upload if the dialog unmounts.
  useEffect(() => () => uploadRef.current?.abort(), []);

  function pick(f) {
    if (!f) return;
    const result = validateImportFile(f);
    setFile(f);
    setProgress(0);
    if (result.error) {
      setFormat(null);
      setError(result.error);
      setPhase('error');
      return;
    }
    setFormat(result.format);
    start(f, result.format);
  }

  function start(f = file, fileFormat = format) {
    setError('');
    setPhase('uploading');
    setProgress(0);
    const isWord = fileFormat === 'docx';
    const upload = (isWord ? uploadDocx : uploadImport)(f, {
      onProgress: setProgress,
      onUploaded: () => setPhase('analyzing')
    });
    uploadRef.current = upload;
    upload.promise
      .then((result) => {
        uploadRef.current = null;
        setPhase('done');
        navigate(isWord ? `/documents/${result.id}` : `/imports/${result.id}`);
      })
      .catch((err) => {
        uploadRef.current = null;
        if (err.cancelled) {
          setPhase('idle');
          setFile(null);
          return;
        }
        setError(err.message || 'Import failed');
        setPhase('error');
      });
  }

  function cancel() {
    uploadRef.current?.abort();
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (phase === 'uploading' || phase === 'analyzing') return;
    pick(e.dataTransfer.files?.[0]);
  }

  const busy = phase === 'uploading' || phase === 'analyzing' || phase === 'done';
  const Icon = (format && FORMAT_ICON[format]) || FileText;
  const pct = Math.round(progress * 100);

  return (
    <Dialog
      title={TITLES[kind] || TITLES.any}
      description={DESCRIPTIONS[kind] || DESCRIPTIONS.any}
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      footer={
        busy ? (
          <button type="button" className="btn btn-ghost" onClick={cancel} disabled={phase === 'done'}>
            <X /> Cancel import
          </button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        )
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept={IMPORT_ACCEPT_ALL}
        hidden
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }}
      />

      {!file || phase === 'idle' ? (
        <div
          className={`dropzone${dragging ? ' is-dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <UploadCloud className="dropzone-icon" aria-hidden="true" />
          <p className="dropzone-title">Drag a file here</p>
          <p className="dropzone-or">or</p>
          <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} data-autofocus>
            Browse files
          </button>
          <ul className="format-chips" aria-label="Supported formats">
            <li className={kind === 'docx' ? 'is-hint' : ''}><FileText aria-hidden="true" />Word .docx</li>
            <li className={kind === 'pptx' ? 'is-hint' : ''}><Presentation aria-hidden="true" />PowerPoint .pptx</li>
            <li><FileType2 aria-hidden="true" />PDF .pdf</li>
          </ul>
          <p className="field-hint">Up to {MAX_IMPORT_MB} MB. Legacy .doc and .ppt files need to be re-saved first.</p>
        </div>
      ) : (
        <div className={`upload-card${phase === 'error' ? ' is-error' : ''}`}>
          <div className="upload-file">
            <span className="upload-file-icon"><Icon aria-hidden="true" /></span>
            <div className="upload-file-text">
              <strong title={file.name}>{file.name}</strong>
              <span>{formatBytes(file.size)}</span>
            </div>
            {phase === 'error' ? <AlertCircle className="upload-state is-error" aria-hidden="true" />
              : phase === 'done' ? <CheckCircle2 className="upload-state is-ok" aria-hidden="true" /> : null}
          </div>

          {phase !== 'error' && (
            <div className="upload-progress" role="status" aria-live="polite">
              <div
                className={`progress-track${phase === 'analyzing' ? ' is-indeterminate' : ''}`}
                role="progressbar"
                aria-label={phase === 'uploading' ? 'Upload progress' : 'Analysing'}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={phase === 'uploading' ? pct : undefined}
              >
                <div className="progress-fill" style={phase === 'uploading' ? { width: `${pct}%` } : undefined} />
              </div>
              <p className="upload-step">
                {phase === 'uploading' && <>Uploading… <span className="mono">{pct}%</span></>}
                {phase === 'analyzing' && (format === 'docx' ? 'Reading the document: headings, lists, tables and pictures…' : 'Analysing structure: headings, lists, tables, pictures and slides…')}
                {phase === 'done' && (format === 'docx' ? 'Done. Opening the document…' : 'Analysis complete. Opening the review…')}
              </p>
            </div>
          )}

          {phase === 'error' && (
            <>
              <p className="alert alert-error" role="alert">{error}</p>
              <div className="upload-actions">
                {format && (
                  <button type="button" className="btn btn-secondary" onClick={() => start()}>
                    <RotateCcw /> Retry
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => inputRef.current?.click()}>
                  Choose another file
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

export default ImportDialog;
