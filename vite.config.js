import { defineConfig } from 'vite';

// Use relative asset paths in production so the site works at ANY GitHub Pages
// subpath (i.e. regardless of the repository name) — rename-proof. Dev stays at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
}));
