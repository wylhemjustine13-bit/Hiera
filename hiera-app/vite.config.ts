import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Split large optional document libraries into their own cacheable chunks.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/pdfjs-dist/')) return 'pdf-tools';
          if (id.includes('/xlsx/')) return 'spreadsheet-tools';
          if (id.includes('/mammoth/') || id.includes('/jszip/')) return 'document-tools';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor';
        },
      },
    },
    // The document readers are intentionally substantial; keep a warning for unusually large chunks.
    chunkSizeWarningLimit: 1200,
  },
});
