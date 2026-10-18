import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ErrorNotice, Field } from '../components/ui';
import { fieldErrors } from '../lib/errors';

function useReturnTo() {
  const location = useLocation();
  return (location.state as { from?: string } | null)?.from ?? '/';
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const returnTo = useReturnTo();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const fields = fieldErrors(error);
  return (
    <div className="auth">
      <div className="auth__panel">
        <h1>Sign in</h1>
        <p className="muted">Save trips, review places and add places you know.</p>
        {error !== null && <ErrorNotice error={error} />}
        <form onSubmit={onSubmit} className="stack">
          <Field label="Email" error={fields.email}>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" error={fields.password}>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <button className="btn btn--primary btn--block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="muted">
          New to Navora? <Link to="/register" state={{ from: returnTo }}>Create an account</Link>
        </p>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const returnTo = useReturnTo();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(name.trim(), email.trim(), password);
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const fields = fieldErrors(error);
  return (
    <div className="auth">
      <div className="auth__panel">
        <h1>Create your account</h1>
        <p className="muted">Plan trips that fit your days, then keep them for later.</p>
        {error !== null && <ErrorNotice error={error} />}
        <form onSubmit={onSubmit} className="stack">
          <Field label="Name" error={fields.name}>
            <input autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" error={fields.email}>
            <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" hint="At least 8 characters." error={fields.password}>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <button className="btn btn--primary btn--block" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="muted">
          Already have an account? <Link to="/login" state={{ from: returnTo }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
