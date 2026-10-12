import type { ExplainContext } from './context';

export interface ExplanationData {
  translation: string;
  literal: string;
  register: string;
  breakdown: {
    text: string;
    reading: string;
    dictionaryForm: string;
    meaning: string;
    role: string;
  }[];
  grammar: {
    pattern: string;
    inText: string;
    explanation: string;
    german: string | null;
    russian: string | null;
  }[];
  notes: string[];
  ocrSuspect: string | null;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export interface ExplainResult {
  id: string;
  text: string;
  explanation: ExplanationData;
  cached: boolean;
  messages: AiMessage[];
}

export interface AiStatus {
  configured: boolean;
  model: string;
  dailyLimit: number;
  today: { requests: number; inputTokens: number; outputTokens: number };
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    redirect: 'manual'
  });
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) {
    throw new Error('Not signed in to the reader backend, reload the page');
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json')
    ? ((await res.json()) as Record<string, unknown>)
    : null;
  if (!res.ok) throw new Error(String(data?.error ?? `backend error ${res.status}`));
  if (!data) throw new Error('unexpected response from backend');
  return data as T;
}

export const aiApi = {
  status: () => request<AiStatus>('GET', '/api/ai/status'),
  explain: (ctx: ExplainContext & { image?: string; fresh?: boolean }) =>
    request<ExplainResult>('POST', '/api/ai/explain', ctx),
  get: (id: string) => request<ExplainResult>('GET', `/api/ai/explain/${id}`)
};

export interface SseEvent {
  event: string;
  data: string;
}

/** Splits a text/event-stream body into events (handles chunk boundaries and CRLF). */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: SseEvent) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const flush = (chunk: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length) onEvent({ event, data: data.join('\n') });
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    let m: RegExpMatchArray | null;
    while ((m = buf.match(/\r?\n\r?\n/)) && m.index !== undefined) {
      flush(buf.slice(0, m.index));
      buf = buf.slice(m.index + m[0].length);
    }
    if (done) {
      if (buf.trim()) flush(buf);
      return;
    }
  }
}

/** Follow-up question: streams the answer through onDelta; resolves when done, throws on error. */
export async function askFollowup(
  id: string,
  question: string,
  onDelta: (d: string) => void
): Promise<void> {
  const res = await fetch(`/api/ai/explain/${id}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
    credentials: 'same-origin',
    redirect: 'manual'
  });
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) {
    throw new Error('Not signed in to the reader backend, reload the page');
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `backend error ${res.status}`);
  }
  let error: string | null = null;
  let finished = false;
  await readSse(res.body, (e) => {
    if (e.event === 'delta') onDelta(JSON.parse(e.data) as string);
    else if (e.event === 'error')
      error = (JSON.parse(e.data) as { message?: string }).message ?? 'failed';
    else if (e.event === 'done') finished = true;
  });
  if (error) throw new Error(error);
  if (!finished) throw new Error('the answer was cut off, try again');
}
