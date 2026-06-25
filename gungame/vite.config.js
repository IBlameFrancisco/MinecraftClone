import { defineConfig } from 'vite';

// GunGame is served from the repo root path /gungame/ when colocated, but builds
// standalone too. Base is relative so the dist works wherever it's hosted.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  server: { host: true },
});
