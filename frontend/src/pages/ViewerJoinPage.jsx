import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Logo from '../components/ui/Logo.jsx';
import { joinRoomByCode } from '../data/roomsApi.js';
import '../styles/auth.css';

function ViewerJoinPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // A shared join link (/join?code=K7QX2M) pre-fills the code.
  const [code, setCode] = useState(() => (params.get('code') || '').toUpperCase().slice(0, 8));
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  async function handleJoin(e) {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length < 4) {
      setError('Enter the code your presenter shared.');
      return;
    }
    if (!name.trim()) {
      setError('Add a display name so your notes and questions are yours.');
      return;
    }

    setJoining(true);
    setError('');
    try {
      // Real join-by-code call — issues a viewerId scoped to this room,
      // used to tag this session's notes and Q&A submissions.
      const { viewerId, currentSlideId } = await joinRoomByCode(cleanCode, name.trim());
      navigate(`/view/${cleanCode}`, {
        state: { displayName: name.trim(), viewerId, currentSlideId }
      });
    } catch (err) {
      setError(err.message || 'Could not join that session.');
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="auth-page join-page">
      <Logo />
      <form className="auth-card card" onSubmit={handleJoin} noValidate>
        <h1>Enter the room code</h1>
        <p className="auth-sub">No account needed, just the code and a name.</p>

        <div className="field">
          <label className="field-label" htmlFor="join-code">Session code</label>
          <input
            id="join-code"
            className="input code-input"
            placeholder="e.g. K7QX2M"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="join-name">Display name</label>
          <input
            id="join-name"
            className="input"
            placeholder="e.g. Priya"
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <span className="field-hint">Your presenter sees this name in the session’s attendee list.</span>
        </div>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={joining}>
          {joining ? 'Joining…' : 'Join session'}
        </button>
      </form>
    </div>
  );
}

export default ViewerJoinPage;
