import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Logo from '../components/ui/Logo.jsx';
import { login, register } from '../data/authApi.js';
import '../styles/auth.css';

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Support both router state (normal navigation) and ?next= param (401 redirect)
  const searchParams = new URLSearchParams(location.search);
  const redirectTo = location.state?.from || searchParams.get('next') || '/decks';

  const [mode, setMode] = useState(searchParams.get('mode') === 'register' ? 'register' : 'login');
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
    <div className="auth-page login-page">
      <Logo />
      <form className="auth-card card" onSubmit={handleSubmit} noValidate>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="auth-sub">
          {mode === 'login'
            ? 'Sign in to edit presentations and go live.'
            : 'Your account lets you create, co-edit and present.'}
        </p>

        {mode === 'register' && (
          <div className="field">
            <label className="field-label" htmlFor="auth-name">Name</label>
            <input
              id="auth-name"
              className="input"
              placeholder="e.g. Priya Shah"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            className="input"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            className="input"
            type="password"
            placeholder="••••••••"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        <p className="auth-switch">
          {mode === 'login' ? (
            <>No account? <button type="button" className="link-btn" onClick={() => setMode('register')}>Create one</button></>
          ) : (
            <>Already have an account? <button type="button" className="link-btn" onClick={() => setMode('login')}>Sign in</button></>
          )}
        </p>

        <div className="auth-foot">
          <Link to="/join">Joining as an audience member? Enter a session code</Link>
          <ArrowRight aria-hidden="true" />
        </div>
      </form>
    </div>
  );
}

export default LoginPage;
