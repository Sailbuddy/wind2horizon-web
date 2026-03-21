export function setAuthIntent(payload) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem('w2h_auth_intent', JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function getAuthIntent() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem('w2h_auth_intent');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAuthIntent() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem('w2h_auth_intent');
  } catch {
    // ignore
  }
}