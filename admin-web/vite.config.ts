import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [TanStackRouterVite({ target: 'react', autoCodeSplitting: true }), react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: process.env.VITE_API_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
