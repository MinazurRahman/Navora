import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert } from '../../components/Feedback.jsx';
import { errorMessage } from '../../lib/errors.js';
import { loginWithGoogle } from './api.js';
import styles from './AuthPages.module.css';

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';

let scriptPromise;
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = undefined; // allow a retry on the next visit
      reject(new Error('Google sign-in could not be loaded'));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

const MESSAGES = {
  INVALID_GOOGLE_TOKEN: 'Google sign-in could not be verified. Try again.',
  GOOGLE_ACCOUNT_MISMATCH: 'An account with this email is linked to a different Google account. Sign in with your password instead.',
  GOOGLE_SIGNIN_UNAVAILABLE: 'Google sign-in is unavailable right now. Try again shortly, or use your email and password.',
};

// Google's own button (its branding rules ask for it). Hidden when no client ID is set.
// Storing the session re-renders the page, which then redirects like a normal sign-in.
export function GoogleSignIn({ text = 'continue_with' }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const buttonRef = useRef(null);
  const [loadError, setLoadError] = useState(null);
  const mutation = useMutation({ mutationFn: loginWithGoogle });
  const { mutate } = mutation; // stable across renders

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => mutate(credential),
          ux_mode: 'popup',
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text,
          width: Math.min(buttonRef.current.offsetWidth || 360, 400),
        });
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, text, mutate]);

  if (!clientId) return null;

  const error = mutation.error;
  return (
    <div className={styles.google}>
      {error && <Alert tone="danger">{MESSAGES[error.code] ?? errorMessage(error)}</Alert>}
      {loadError && <Alert tone="warning">{loadError}. Use your email and password instead.</Alert>}
      <div ref={buttonRef} className={styles.googleButton} aria-busy={mutation.isPending || undefined} />
      <p className={styles.divider}>
        <span>or use your email</span>
      </p>
    </div>
  );
}
