const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export function clearAuthSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function readStoredSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(USER_KEY);
  if (!token || !raw) {
    return { token: null, user: null };
  }
  try {
    return { token, user: JSON.parse(raw) };
  } catch {
    clearAuthSession();
    return { token: null, user: null };
  }
}

export function persistSession(user, token) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
