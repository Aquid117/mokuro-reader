/** Best-effort client diagnostics → manga-api (/api/client-log), so device-only failures (iPad) are visible on the server. */
export function reportClientIssue(msg: string, ctx: Record<string, unknown> = {}): void {
  try {
    void fetch('/api/client-log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ msg: msg.slice(0, 500), ctx, ua: navigator.userAgent.slice(0, 200) })
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Reject if a promise does not settle in time (Safari storage APIs can hang). */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}
