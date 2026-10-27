import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import Dialog from '../ui/Dialog.jsx';
import QrCode from './QrCode.jsx';
import { joinLinkFor } from './joinLink.js';
import './live.css';

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Older browsers and non-secure origins: fall back to a hidden field.
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const ok = document.execCommand('copy');
  field.remove();
  if (!ok) throw new Error('Copy is not available in this browser');
}

// How the audience gets in: the code, a join link and a QR code that
// opens the same link with the code filled in.
function InviteDialog({ code, onClose }) {
  const link = joinLinkFor(code);
  const [copied, setCopied] = useState(null);
  const [error, setError] = useState('');

  async function handleCopy(kind, text) {
    setError('');
    try {
      await copyText(text);
      setCopied(kind);
      setTimeout(() => setCopied((k) => (k === kind ? null : k)), 2000);
    } catch (err) {
      setError(err.message || 'Could not copy');
    }
  }

  return (
    <Dialog title="Invite your audience" description="Anyone with the code can watch. No account needed." onClose={onClose} size="md">
      <div className="invite">
        <div className="invite-qr">
          <QrCode value={link} size={188} label={`QR code that opens the join page for session ${code}`} />
          <p className="field-hint">Scan with a phone camera</p>
        </div>
        <div className="invite-details">
          <div className="field">
            <span className="field-label">Session code</span>
            <div className="invite-row">
              <span className="invite-code mono" aria-label={`Session code ${code.split('').join(' ')}`}>{code}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleCopy('code', code)} data-autofocus>
                {copied === 'code' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied === 'code' ? 'Copied' : 'Copy code'}
              </button>
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="invite-link">Join link</label>
            <div className="invite-row">
              <input id="invite-link" className="input mono invite-link" readOnly value={link} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleCopy('link', link)}>
                {copied === 'link' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied === 'link' ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
          <p className="field-hint">People can also go to <span className="mono">{window.location.host}/join</span> and type the code.</p>
          {error && <p className="alert alert-error" role="alert">{error}</p>}
          <p className="sr-only" aria-live="polite">{copied ? `${copied === 'code' ? 'Code' : 'Link'} copied` : ''}</p>
        </div>
      </div>
    </Dialog>
  );
}

export default InviteDialog;
