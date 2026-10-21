import { request } from '../../api/client.js';
import { setSession } from '../../api/session.js';

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

export { logout } from '../../api/client.js';
