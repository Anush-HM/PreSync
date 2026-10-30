import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open:true
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    // Parallel jsdom runs with userEvent can take over 5s per test on loaded machines and CI runners
    testTimeout: 30000
  }
});
