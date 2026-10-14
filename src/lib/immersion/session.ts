import { writable } from 'svelte/store';

/**
 * manga-immersion fork: the reader sits behind Authelia. In a home-screen app (PWA) there is no reload
 * button, and the service worker keeps serving the app shell after the login expired, so the app only
 * notices through failing /api calls. This checks the session when the app starts or comes back to
 * the foreground; the banner then offers a sign-in that goes through the login portal and back.
 */
export const sessionExpired = writable(false);

export async function checkSession(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl('/api/me', {
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store'
    });
    const expired = res.type === 'opaqueredirect' || res.status === 401 || res.status === 403;
    sessionExpired.set(expired);
    return !expired;
  } catch {
    return true; // offline: not a login problem
  }
}

/** Full navigation through Authelia (not handled by the service worker), back to the app after login. */
export function signInAgain(): void {
  window.location.assign('/api/login');
}

let started = false;

export function startSessionWatch(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void checkSession();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkSession();
  });
}
