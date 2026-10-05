import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  // The NUI page is served from https://cfx-nui-<resource>/..., so assets must resolve relative to it.
  base: './',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../../dist/web/nui', import.meta.url)),
    emptyOutDir: true,
    // FiveM's NUI runs Chromium 103.
    target: 'chrome103',
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
