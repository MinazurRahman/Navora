import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server runs on 5173 (already in the backend's CORS_ORIGINS) and forwards
// /api and the health probes to the backend, so the browser only ever talks to one origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.VITE_DEV_BACKEND_URL || 'http://localhost:3000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        '/ready': { target: backend, changeOrigin: true },
        '/health': { target: backend, changeOrigin: true },
      },
    },
  };
});
