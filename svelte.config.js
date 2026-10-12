import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://kit.svelte.dev/docs/integrations#preprocessors
  // for more information about preprocessors
  preprocess: vitePreprocess(),

  kit: {
    // Self-hosted static SPA (the app already runs with ssr=false and a hash router):
    // every route falls back to index.html and is served by nginx in the manga-web image.
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: true,
      strict: false
    })
  },

  vitePlugin: {
    inspector: true
  }
};

export default config;
