import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    // Relative asset paths so the built dist serves correctly under the kiosk
    // URL (http://localhost:5174/) regardless of the mount path.
    base: './',
    define: {
      __NEXT_N__: JSON.stringify(env.NEXT_N || '12'),
      __REFRESH_MS__: JSON.stringify(env.REFRESH_MS || '300000'),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:5174',
      },
    },
  };
});
