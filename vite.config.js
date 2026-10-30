import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const frontendDirectory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, frontendDirectory, '');
  // Defaults to the local Laragon installation used by this project.
  // For the PHP built-in server, set AGRITRACE_BACKEND_URL=http://127.0.0.1:8080
  // and leave AGRITRACE_BACKEND_PATH empty.
  const backendUrl = env.AGRITRACE_BACKEND_URL || 'http://127.0.0.1';
  // An empty AGRITRACE_BACKEND_PATH is meaningful (PHP built-in server), so only undefined falls back.
  const backendPath = (
    env.AGRITRACE_BACKEND_PATH ?? '/finalproject/AgriTrace/public'
  ).replace(/\/$/, '');

  return {
    base: './',
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, `${backendPath}/api`),
        },
        // Uploaded photos and videos are served by the backend's public folder.
        '/uploads': {
          target: backendUrl,
          changeOrigin: true,
          rewrite: (path) => `${backendPath}${path}`,
        },
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: `${frontendDirectory}index.html`,
          loginpage: `${frontendDirectory}loginpage.html`,
          profile: `${frontendDirectory}profile.html`,
          indexed: `${frontendDirectory}indexed.html`,
          database: `${frontendDirectory}database.html`,
          trace: `${frontendDirectory}trace.html`,
          adminCloud: `${frontendDirectory}admin-cloud.html`,
        },
      },
    },
  };
});
