import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  test: {
    // Unit and component tests only; browser tests in e2e/ run with Playwright.
    include: ['src/**/*.test.{js,jsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
  },
});
