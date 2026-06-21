import { defineConfig } from 'vite';

// On GitHub Pages the site is served from https://<user>.github.io/MinecraftClone/,
// so production builds need that base path. Local dev stays at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/MinecraftClone/' : '/',
}));
