import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { login, register } from '../data/authApi.js';
import './LoginPage.css';

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Support both router state (normal navigation) and ?next= param (401 redirect)
  const searchParams = new URLSearchParams(location.search);
  const redirectTo = location.state?.from || searchParams.get('next') || '/decks';

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await login({ email: email.trim(), password });
      } else {
        await register({ email: email.trim(), password, name: name.trim() });
      }
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="eyebrow"><span className="dot"></span>{mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'}</div>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="login-sub">
          {mode === 'login'
            ? 'Sign in to edit decks and go live.'
            : 'Editors get full access to co-edit and present decks.'}
        </p>

        {mode === 'register' && (
          <>
            <label className="login-label mono">NAME</label>
            <input
              className="login-input"
              placeholder="e.g. Priya Shah"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </>
        )}

        <label className="login-label mono">EMAIL</label>
        <input
          className="login-input"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="login-label mono">PASSWORD</label>
        <input
          className="login-input"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="login-error">{error}</p>}

        <button className="btn btn-amber login-submit" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        <p className="login-switch">
          {mode === 'login' ? (
            <>No account? <button type="button" className="link-btn" onClick={() => setMode('register')}>Create one</button></>
          ) : (
            <>Already have an account? <button type="button" className="link-btn" onClick={() => setMode('login')}>Sign in</button></>
          )}
        </p>

        <Link to="/join" className="login-join-link mono">Joining as an audience member? Use a room code →</Link>
      </form>
    </div>
  );
}

export default LoginPage;