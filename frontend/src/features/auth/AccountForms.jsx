import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../components/Button.jsx';
import { Card } from '../../components/Card.jsx';
import { ErrorAlert } from '../../components/ErrorState.jsx';
import { Field, Input } from '../../components/Field.jsx';
import { useToast } from '../../components/useToast.js';
import { fieldErrors } from '../../lib/errors.js';
import { changePassword, updateProfile } from './api.js';
import styles from './ProfilePage.module.css';

function focusFirstInvalid(form) {
  requestAnimationFrame(() => form?.querySelector('[aria-invalid="true"]')?.focus());
}

// Name and email. The backend asks for the current password only when the email changes.
export function EditProfileForm({ user }) {
  const toast = useToast();
  const formRef = useRef(null);
  const [values, setValues] = useState({ name: user.name, email: user.email, currentPassword: '' });
  const [errors, setErrors] = useState({});
  const emailChanged = values.email.trim().toLowerCase() !== user.email.toLowerCase();
  const nameChanged = values.name.trim() !== user.name;

  const save = useMutation({
    mutationFn: updateProfile,
    onSuccess: (updated) => {
      setValues({ name: updated.name, email: updated.email, currentPassword: '' });
      toast.show({ tone: 'success', message: 'Your profile was updated.' });
    },
    onError: (error) => {
      setErrors(error.code === 'EMAIL_ALREADY_REGISTERED' ? { email: 'Another account already uses this email.' } : fieldErrors(error));
      focusFirstInvalid(formRef.current);
    },
  });

  const update = (field) => (event) => {
    setValues((v) => ({ ...v, [field]: event.target.value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  function onSubmit(event) {
    event.preventDefault();
    const found = {};
    if (!values.name.trim()) found.name = 'Enter your name.';
    if (!values.email.trim()) found.email = 'Enter your email address.';
    if (emailChanged && !values.currentPassword) found.currentPassword = 'Enter your current password to change your email.';
    setErrors(found);
    if (Object.keys(found).length) return focusFirstInvalid(event.currentTarget);
    const fields = {};
    if (nameChanged) fields.name = values.name.trim();
    if (emailChanged) Object.assign(fields, { email: values.email.trim(), currentPassword: values.currentPassword });
    save.mutate(fields);
  }

  const otherError = save.error && !['VALIDATION_ERROR', 'EMAIL_ALREADY_REGISTERED'].includes(save.error.code) ? save.error : null;

  return (
    <Card>
      <form ref={formRef} className={styles.form} onSubmit={onSubmit} noValidate>
        <h2 className={styles.formTitle}>Edit profile</h2>
        {otherError && <ErrorAlert error={otherError} />}
        <Field label="Name" error={errors.name}>
          {(props) => <Input {...props} autoComplete="name" maxLength={100} value={values.name} onChange={update('name')} />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(props) => <Input {...props} type="email" autoComplete="email" maxLength={254} value={values.email} onChange={update('email')} />}
        </Field>
        {emailChanged && (
          <Field label="Current password" hint="Needed to change your email." error={errors.currentPassword}>
            {(props) => (
              <Input {...props} type="password" autoComplete="current-password" value={values.currentPassword} onChange={update('currentPassword')} />
            )}
          </Field>
        )}
        <div>
          <Button type="submit" loading={save.isPending} disabled={!nameChanged && !emailChanged}>
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  );
}

// Changing the password signs out every other device; this one gets a new session.
export function ChangePasswordForm({ user }) {
  const toast = useToast();
  const formRef = useRef(null);
  const empty = { currentPassword: '', newPassword: '', confirm: '' };
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState({});

  const save = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setValues(empty);
      toast.show({ tone: 'success', message: 'Password changed. You were signed out on your other devices.' });
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      focusFirstInvalid(formRef.current);
    },
  });

  const update = (field) => (event) => {
    setValues((v) => ({ ...v, [field]: event.target.value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  function onSubmit(event) {
    event.preventDefault();
    const found = {};
    if (!values.currentPassword) found.currentPassword = 'Enter your current password.';
    if (values.newPassword.length < 8) found.newPassword = 'Use at least 8 characters.';
    else if (values.newPassword === values.currentPassword) found.newPassword = 'Choose a password different from the current one.';
    if (values.confirm !== values.newPassword) found.confirm = 'The passwords do not match.';
    setErrors(found);
    if (Object.keys(found).length) return focusFirstInvalid(event.currentTarget);
    save.mutate({ currentPassword: values.currentPassword, newPassword: values.newPassword });
  }

  const otherError = save.error && save.error.code !== 'VALIDATION_ERROR' ? save.error : null;

  return (
    <Card>
      <form ref={formRef} className={styles.form} onSubmit={onSubmit} noValidate>
        <h2 className={styles.formTitle}>Change password</h2>
        <p className={styles.note}>You will stay signed in here; other devices are signed out.</p>
        {otherError && <ErrorAlert error={otherError} />}
        {/* Lets password managers file the new password under this account. */}
        <input type="email" autoComplete="username" value={user.email} readOnly hidden />
        <Field label="Current password" error={errors.currentPassword}>
          {(props) => <Input {...props} type="password" autoComplete="current-password" value={values.currentPassword} onChange={update('currentPassword')} />}
        </Field>
        <Field label="New password" hint="At least 8 characters." error={errors.newPassword}>
          {(props) => <Input {...props} type="password" autoComplete="new-password" maxLength={128} value={values.newPassword} onChange={update('newPassword')} />}
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          {(props) => <Input {...props} type="password" autoComplete="new-password" maxLength={128} value={values.confirm} onChange={update('confirm')} />}
        </Field>
        <div>
          <Button type="submit" loading={save.isPending}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}
