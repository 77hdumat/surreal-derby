import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GH_PAGES ? '/surreal-derby/' : '/',
  server: { port: 5180, open: false, allowedHosts: ['.trycloudflare.com'] },
  preview: { port: 4173, allowedHosts: ['.trycloudflare.com'] },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
