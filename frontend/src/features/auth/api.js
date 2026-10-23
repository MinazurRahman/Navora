import { request } from '../../api/client.js';
import { getSession, rotateSession, setSession } from '../../api/session.js';

function storeSession({ user, tokens }) {
  setSession({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user });
  return user;
}

export async function register({ name, email, password }) {
  const { data } = await request('/auth/register', { method: 'POST', body: { name, email, password } });
  return storeSession(data);
}

export async function login({ email, password }) {
  const { data } = await request('/auth/login', { method: 'POST', body: { email, password } });
  return storeSession(data);
}

export async function getMe({ signal } = {}) {
  const { data } = await request('/auth/me', { signal });
  return data.user;
}

// fields: { name?, email?, currentPassword? }. Keeps the stored session's user in step.
export async function updateProfile(fields) {
  const { data } = await request('/auth/me', { method: 'PATCH', body: fields });
  const session = getSession();
  if (session) setSession({ ...session, user: data.user });
  return data.user;
}

// The backend revokes every session and returns a new one for this device; stored as a
// rotation so a duplicated tab of this device adopts it instead of being signed out.
export async function changePassword({ currentPassword, newPassword }) {
  const { data } = await request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
  rotateSession({ accessToken: data.tokens.accessToken, refreshToken: data.tokens.refreshToken, user: data.user });
  return data.user;
}

// Resolves the same whether or not the email is registered.
export async function requestPasswordReset(email) {
  await request('/auth/forgot-password', { method: 'POST', body: { email } });
}

// token comes from the reset link's #token= fragment. Every session is signed out.
export async function resetPassword({ token, newPassword }) {
  await request('/auth/reset-password', { method: 'POST', body: { token, newPassword } });
}

export { logout } from '../../api/client.js';
