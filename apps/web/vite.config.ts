import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Use the shared package's TS source directly (its dist is CommonJS for the API).
    alias: { '@overlook/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  build: {
    // Served from localhost only; PrimeReact's shared chunk is ~520 kB (136 kB gzipped) and cached.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks, so app changes don't invalidate them.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          primereact: ['primereact/api', 'primereact/button', 'primereact/card', 'primereact/datatable', 'primereact/column', 'primereact/dialog', 'primereact/dropdown', 'primereact/multiselect', 'primereact/toast', 'primereact/tag', 'primereact/menu'],
          charts: ['chart.js', 'primereact/chart'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4317' },
  },
});
