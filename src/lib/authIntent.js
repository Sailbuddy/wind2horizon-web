const KEY = 'w2h_auth_intent';

export function setAuthIntent(intent) {
  try {
    localStorage.setItem(KEY, JSON.stringify(intent));
  } catch {}
}

export function readAuthIntent() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAuthIntent() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}