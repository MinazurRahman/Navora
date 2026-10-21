import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../components/Button.jsx';
import { Card } from '../../components/Card.jsx';
import { Alert } from '../../components/Feedback.jsx';
import { Field, Input } from '../../components/Field.jsx';
import { NavoraMark } from '../../components/Logo.jsx';
import { errorMessage, fieldErrors } from '../../lib/errors.js';
import { login, register } from './api.js';
import { safeNext } from './safeNext.js';
import { useAuth } from './useAuth.js';
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
      <form className={styles.form} onSubmit={onSubmit} noValidate>
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
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {showAlert && <Alert tone="danger">{errorMessage(error)}</Alert>}
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
