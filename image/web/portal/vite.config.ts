// Build du portail : deux pages (application et connexion), sorties dans dist/.
// Le JSX est compilé pour Preact par Vite (oxc), sans preset ni Babel.
import { defineConfig } from 'vite';

export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      input: { index: 'index.html', login: 'login.html' },
    },
  },
});
