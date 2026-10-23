import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../components/Button.jsx';
import { Card } from '../../components/Card.jsx';
import { Alert } from '../../components/Feedback.jsx';
import { Field, Input } from '../../components/Field.jsx';
import { NavoraMark } from '../../components/Logo.jsx';
import { errorMessage, fieldErrors } from '../../lib/errors.js';
import { login, register, requestPasswordReset, resetPassword } from './api.js';
import { GoogleSignIn } from './GoogleSignIn.jsx';
import { safeNext } from './safeNext.js';
import { useAuth } from './useAuth.js';
import { ErrorAlert } from '../../components/ErrorState.jsx';
import styles from './AuthPages.module.css';

function focusFirstInvalid(form) {
  requestAnimationFrame(() => form.querySelector('[aria-invalid="true"]')?.focus());
}

function AuthLayout({ title, intro, children, footer }) {
  return (
    <main className={`container ${styles.page}`}>
      <title>{`${title} | NAVORA`}</title>
      <Card className={styles.card}>
        <div className={styles.header}>
          <NavoraMark className={styles.mark} />
          <h1 className={styles.title}>{title}</h1>
          <p className="muted">{intro}</p>
        </div>
        {children}
      </Card>
      <p className={styles.footer}>{footer}</p>
    </main>
  );
}

// Signed-in visitors have nothing to do here; send them on. This also completes a
// successful sign-in, because storing the session re-renders the page.
function useRedirectIfSignedIn() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  return { redirect: status === 'authenticated' ? <Navigate to={next} replace /> : null, next };
}

export function LoginPage() {
  const { redirect, next } = useRedirectIfSignedIn();
  const { sessionExpired } = useAuth();
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const mutation = useMutation({
    mutationFn: login,
    onError: (error) => setErrors(fieldErrors(error)),
  });

  if (redirect) return redirect;

  const update = (field) => (event) => setValues((v) => ({ ...v, [field]: event.target.value }));

  function onSubmit(event) {
    event.preventDefault();
    const found = {};
    if (!values.email.trim()) found.email = 'Enter your email address.';
    if (!values.password) found.password = 'Enter your password.';
    setErrors(found);
    if (Object.keys(found).length) return focusFirstInvalid(event.currentTarget);
    mutation.mutate({ email: values.email.trim(), password: values.password });
  }

  const error = mutation.error;
  const showAlert = error && error.code !== 'VALIDATION_ERROR';

  return (
    <AuthLayout
      title="Sign in"
      intro="Plan trips and contribute places."
      footer={
        <>
          New to NAVORA? <Link to={`/register${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link>
        </>
      }
    >
      <GoogleSignIn text="signin_with" />
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {sessionExpired && !showAlert && (
          <Alert tone="warning">Your session has ended. Sign in again to continue where you left off.</Alert>
        )}
        {showAlert && (
          <Alert tone="danger">
            {error.code === 'INVALID_CREDENTIALS' ? 'The email or password is incorrect.' : errorMessage(error)}
          </Alert>
        )}
        <Field label="Email" error={errors.email}>
          {(props) => (
            <Input {...props} type="email" autoComplete="email" value={values.email} onChange={update('email')} />
          )}
        </Field>
        <Field label="Password" error={errors.password}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={values.password}
              onChange={update('password')}
            />
          )}
        </Field>
        <Link to="/forgot-password" className={styles.forgot}>
          Forgot your password?
        </Link>
        <Button type="submit" loading={mutation.isPending} className={styles.submit}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { redirect, next } = useRedirectIfSignedIn();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const mutation = useMutation({
    mutationFn: register,
    onError: (error) =>
      setErrors(
        error.code === 'EMAIL_ALREADY_REGISTERED'
          ? { email: 'An account with this email already exists. Sign in instead.' }
          : fieldErrors(error),
      ),
  });

  if (redirect) return redirect;

  const update = (field) => (event) => setValues((v) => ({ ...v, [field]: event.target.value }));

  function onSubmit(event) {
    event.preventDefault();
    const found = {};
    if (!values.name.trim()) found.name = 'Enter your name.';
    if (!values.email.trim()) found.email = 'Enter your email address.';
    if (values.password.length < 8) found.password = 'Use at least 8 characters.';
    setErrors(found);
    if (Object.keys(found).length) return focusFirstInvalid(event.currentTarget);
    mutation.mutate({ name: values.name.trim(), email: values.email.trim(), password: values.password });
  }

  const error = mutation.error;
  const showAlert = error && error.code !== 'VALIDATION_ERROR' && error.code !== 'EMAIL_ALREADY_REGISTERED';

  return (
    <AuthLayout
      title="Create an account"
      intro="Save trips, generate itineraries and suggest places."
      footer={
        <>
          Already have an account? <Link to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in</Link>
        </>
      }
    >
      <GoogleSignIn text="signup_with" />
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {showAlert && <ErrorAlert error={error} />}
        <Field label="Name" error={errors.name}>
          {(props) => (
            <Input {...props} autoComplete="name" maxLength={100} value={values.name} onChange={update('name')} />
          )}
        </Field>
        <Field label="Email" error={errors.email}>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              maxLength={254}
              value={values.email}
              onChange={update('email')}
            />
          )}
        </Field>
        <Field label="Password" hint="At least 8 characters." error={errors.password}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={values.password}
              onChange={update('password')}
            />
          )}
        </Field>
        <Button type="submit" loading={mutation.isPending} className={styles.submit}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState();
  const mutation = useMutation({ mutationFn: requestPasswordReset, onError: (err) => setError(fieldErrors(err).email) });

  function onSubmit(event) {
    event.preventDefault();
    if (!email.trim()) {
      setError('Enter your email address.');
      return focusFirstInvalid(event.currentTarget);
    }
    mutation.mutate(email.trim());
  }

  const otherError = mutation.error && mutation.error.code !== 'VALIDATION_ERROR' ? mutation.error : null;

  return (
    <AuthLayout
      title="Reset your password"
      intro="Enter the email of your account and we will send you a link to choose a new password."
      footer={
        <>
          Remembered it? <Link to="/login">Sign in</Link>
        </>
      }
    >
      {mutation.isSuccess ? (
        <Alert tone="success" title="Check your email" role="status">
          If an account uses {email.trim()}, a link to reset its password is on its way. It works once, for 30 minutes.
        </Alert>
      ) : (
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {otherError && <ErrorAlert error={otherError} />}
          <Field label="Email" error={error}>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(undefined);
                }}
              />
            )}
          </Field>
          <Button type="submit" loading={mutation.isPending} className={styles.submit}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

// Opened from the mailed link: /reset-password#token=<token>. The token is read once and
// removed from the address bar, so it does not stay in the browser history.
export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
  const [values, setValues] = useState({ newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const mutation = useMutation({ mutationFn: resetPassword, onError: (err) => setErrors(fieldErrors(err)) });

  useEffect(() => {
    if (location.hash) navigate({ pathname: location.pathname, search: location.search }, { replace: true });
  }, [location, navigate]);

  const update = (field) => (event) => {
    setValues((v) => ({ ...v, [field]: event.target.value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  function onSubmit(event) {
    event.preventDefault();
    const found = {};
    if (values.newPassword.length < 8) found.newPassword = 'Use at least 8 characters.';
    if (values.confirm !== values.newPassword) found.confirm = 'The passwords do not match.';
    setErrors(found);
    if (Object.keys(found).length) return focusFirstInvalid(event.currentTarget);
    mutation.mutate({ token, newPassword: values.newPassword });
  }

  const linkProblem = !token || mutation.error?.code === 'INVALID_RESET_TOKEN';
  const otherError =
    mutation.error && !['VALIDATION_ERROR', 'INVALID_RESET_TOKEN'].includes(mutation.error.code) ? mutation.error : null;

  return (
    <AuthLayout
      title="Choose a new password"
      intro="You will be signed out everywhere, then sign in with the new password."
      footer={<Link to="/login">Back to sign in</Link>}
    >
      {mutation.isSuccess ? (
        <Alert tone="success" title="Your password was changed" role="status">
          <Link to="/login">Sign in</Link> with your new password.
        </Alert>
      ) : linkProblem ? (
        <Alert tone="warning" title="This reset link cannot be used">
          It may be incomplete, already used, or older than 30 minutes. <Link to="/forgot-password">Ask for a new link</Link>.
        </Alert>
      ) : (
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {otherError && <ErrorAlert error={otherError} />}
          <Field label="New password" hint="At least 8 characters." error={errors.newPassword}>
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="new-password"
                maxLength={128}
                value={values.newPassword}
                onChange={update('newPassword')}
              />
            )}
          </Field>
          <Field label="Confirm new password" error={errors.confirm}>
            {(props) => (
              <Input {...props} type="password" autoComplete="new-password" maxLength={128} value={values.confirm} onChange={update('confirm')} />
            )}
          </Field>
          <Button type="submit" loading={mutation.isPending} className={styles.submit}>
            Change password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
