<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button, Input, Spinner } from 'flowbite-svelte';
  import { showSnackbar } from '$lib/util';

  /**
   * manga-immersion fork: import series from the remote mokuro-bunko catalog (mokuro.moe) into the
   * server library. The download runs on the server (manga-api); this page only searches and watches.
   */
  interface RemoteSeries {
    name: string;
    path: string;
    volume_count: number;
    total_pages: number;
    total_chars: number;
    titles?: { native?: string; romaji?: string; english?: string };
    community?: { score?: number; genres?: string[] };
  }
  interface Job {
    id: number;
    series: string;
    status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
    files_total: number;
    files_done: number;
    bytes_total: number;
    bytes_done: number;
    current_file: string | null;
    error: string | null;
    updated_at: number;
  }

  let query = $state('');
  let results = $state<RemoteSeries[]>([]);
  let searching = $state(false);
  let jobs = $state<Job[]>([]);
  let error = $state<string | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
      credentials: 'same-origin'
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
    return body as T;
  }

  async function search() {
    searching = true;
    error = null;
    try {
      const r = await api<{ series: RemoteSeries[] }>(
        `/api/import/catalog?q=${encodeURIComponent(query)}&limit=60`
      );
      results = r.series;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      searching = false;
    }
  }

  function onInput() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(search, 300);
  }

  async function refreshJobs() {
    try {
      jobs = (await api<{ jobs: Job[] }>('/api/import/jobs')).jobs;
    } catch {
      /* keep old list */
    }
  }

  async function startImport(s: RemoteSeries) {
    try {
      await api('/api/import', { method: 'POST', body: JSON.stringify({ series: s.path }) });
      showSnackbar(`Import queued: ${s.name}`);
      await refreshJobs();
    } catch (e) {
      showSnackbar(`Import failed: ${(e as Error).message}`);
    }
  }

  async function cancel(j: Job) {
    await api(`/api/import/jobs/${j.id}`, { method: 'DELETE' }).catch(() => {});
    await refreshJobs();
  }

  const mb = (n: number) => (n / 1048576).toFixed(0);
  const importedNames = $derived(
    new Set(jobs.filter((j) => j.status === 'done').map((j) => j.series))
  );
  const activeNames = $derived(
    new Set(
      jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => j.series)
    )
  );

  onMount(() => {
    void search();
    void refreshJobs();
    timer = setInterval(refreshJobs, 3000);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-4">
  <h1 class="text-xl font-semibold">Import from mokuro.moe</h1>
  <p class="text-sm text-gray-500 dark:text-gray-400">
    Series are downloaded by the server into the manga library (with their OCR files). When a job is
    done, open the catalog and tap the refresh icon; the series then appears as a cloud placeholder
    you can download to this device.
  </p>

  <Input
    bind:value={query}
    oninput={onInput}
    placeholder="Search title (native / romaji / english)…"
  />
  {#if error}<p class="text-sm text-red-500">{error}</p>{/if}

  {#if jobs.length}
    <div class="rounded-lg border border-gray-300 p-3 dark:border-gray-700">
      <h2 class="mb-2 text-sm font-semibold">Server jobs</h2>
      <ul class="space-y-2 text-sm">
        {#each jobs.slice(0, 12) as j (j.id)}
          <li class="flex flex-col gap-1">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate font-medium">{j.series}</span>
              <span
                class="shrink-0 text-xs uppercase {j.status === 'error'
                  ? 'text-red-500'
                  : j.status === 'done'
                    ? 'text-green-500'
                    : 'text-gray-400'}">{j.status}</span
              >
            </div>
            {#if j.status === 'running' || j.status === 'queued'}
              <div class="h-1.5 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
                <div
                  class="h-full bg-primary-600"
                  style:width={`${j.bytes_total ? Math.min(100, (100 * j.bytes_done) / j.bytes_total) : 0}%`}
                ></div>
              </div>
              <div class="flex items-center justify-between text-xs text-gray-500">
                <span
                  >{j.files_done}/{j.files_total} files · {mb(j.bytes_done)} / {mb(j.bytes_total)} MB
                  {j.current_file ? `· ${j.current_file}` : ''}</span
                >
                <button class="text-red-400 hover:underline" onclick={() => cancel(j)}
                  >cancel</button
                >
              </div>
            {:else if j.error}
              <div class="text-xs text-red-400">{j.error}</div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if searching}
    <div class="flex items-center gap-2 text-sm text-gray-400"><Spinner size="4" /> Searching…</div>
  {/if}
  <ul class="divide-y divide-gray-200 dark:divide-gray-700">
    {#each results as s (s.path)}
      <li class="flex items-center justify-between gap-3 py-2">
        <div class="min-w-0">
          <div class="truncate font-medium">{s.titles?.native || s.name}</div>
          <div class="truncate text-xs text-gray-500">
            {s.name}{s.titles?.english ? ` · ${s.titles.english}` : ''} · {s.volume_count} vol · {s.total_pages}
            pages
            {s.community?.genres?.length ? ` · ${s.community.genres.slice(0, 3).join(', ')}` : ''}
          </div>
        </div>
        {#if importedNames.has(s.path)}
          <span class="shrink-0 text-xs text-green-500">imported</span>
        {:else if activeNames.has(s.path)}
          <span class="shrink-0 text-xs text-gray-400">in progress</span>
        {:else}
          <Button size="xs" onclick={() => startImport(s)}>Import</Button>
        {/if}
      </li>
    {/each}
  </ul>
</div>
