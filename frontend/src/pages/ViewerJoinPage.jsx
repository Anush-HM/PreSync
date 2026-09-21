import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { joinRoomByCode } from '../data/roomsApi.js';
import './ViewerJoinPage.css';

function ViewerJoinPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
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
    <div className="join-page">
      <form className="join-card" onSubmit={handleJoin}>
        <div className="eyebrow"><span className="dot"></span>JOIN A SESSION</div>
        <h1>Enter the room code</h1>
        <p className="join-sub">No account needed — just the code and a name.</p>

        <label className="join-label mono">ROOM CODE</label>
        <input
          className="join-input mono"
          placeholder="e.g. K7QX2M"
          maxLength={8}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
        />

        <label className="join-label mono">DISPLAY NAME</label>
        <input
          className="join-input"
          placeholder="e.g. Priya"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {error && <p className="join-error">{error}</p>}

        <button className="btn btn-amber join-submit" type="submit" disabled={joining}>
          {joining ? 'Joining…' : 'Join session'}
        </button>
      </form>
    </div>
  );
}

export default ViewerJoinPage;