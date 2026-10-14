import { get } from 'svelte/store';
import { providerManager } from '$lib/util/sync/provider-manager';
import { getConfiguredProviderType } from '$lib/util/sync/provider-detection';

/**
 * manga-immersion fork: connect to the server's own mokuro-bunko without typing credentials.
 *
 * manga-api hands out the Bunko `reader` login on the public site (Authelia-protected, same-origin,
 * never on the loopback debug port). The reader logs in through the normal WebDAV provider, so tokens,
 * progress and profile sync work exactly as after a manual login. Runs at startup and again whenever
 * the WebDAV session loses its password (the provider drops it after a rejected request).
 */
export interface BunkoCredentials {
  serverUrl: string;
  username: string;
  password: string;
}

export type AutoConnectResult = 'connected' | 'already' | 'skipped' | 'failed';

let running: Promise<AutoConnectResult> | null = null;
let failures = 0;
let lastAttempt = 0;

export async function fetchBunkoCredentials(
  fetchImpl: typeof fetch = fetch
): Promise<BunkoCredentials | null> {
  try {
    const res = await fetchImpl('/api/bunko/credentials', {
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store'
    });
    if (res.type === 'opaqueredirect' || !res.ok) return null;
    const d = (await res.json()) as Partial<BunkoCredentials>;
    if (typeof d.serverUrl !== 'string' || !d.serverUrl) return null;
    return { serverUrl: d.serverUrl, username: d.username ?? '', password: d.password ?? '' };
  } catch {
    return null;
  }
}

/** Is the reader already connected to Bunko (or deliberately using another provider)? */
export function connectionState(): 'connected' | 'other-provider' | 'needs-login' {
  const type = getConfiguredProviderType();
  if (type && type !== 'webdav') return 'other-provider';
  const st = get(providerManager.status);
  const wd = st.providers.webdav;
  if (st.currentProviderType === 'webdav' && wd?.isAuthenticated && !wd.needsAttention) {
    return 'connected';
  }
  return 'needs-login';
}

export function ensureBunkoConnection(reason: string): Promise<AutoConnectResult> {
  if (running) return running;
  running = (async (): Promise<AutoConnectResult> => {
    const state = connectionState();
    if (state === 'connected') return 'already';
    if (state === 'other-provider') return 'skipped';
    // back off after repeated failures (server down, Bunko rate limit) instead of hammering it
    const now = Date.now();
    if (failures >= 3 && now - lastAttempt < 10 * 60_000) return 'skipped';
    lastAttempt = now;
    const creds = await fetchBunkoCredentials();
    if (!creds) return 'skipped';
    try {
      const provider = await providerManager.getOrLoadProvider('webdav');
      await provider.login(creds);
      await providerManager.setCurrentProvider(provider);
      failures = 0;
      console.log(`[bunko-autoconnect] connected (${reason})`);
      void import('$lib/util/sync/unified-cloud-manager')
        .then(async ({ unifiedCloudManager }) => {
          await unifiedCloudManager.fetchAllCloudVolumes();
          await unifiedCloudManager.syncProgress();
        })
        .catch((e) => console.warn('[bunko-autoconnect] post-connect sync failed', e));
      return 'connected';
    } catch (e) {
      failures++;
      console.warn(`[bunko-autoconnect] login failed (${reason})`, e);
      return 'failed';
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

let started = false;

/** Call once after the providers restored their sessions. */
export function startBunkoAutoConnect(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void ensureBunkoConnection('startup');
  providerManager.status.subscribe((st) => {
    if (st.providers.webdav?.needsAttention) void ensureBunkoConnection('session lost');
  });
}
