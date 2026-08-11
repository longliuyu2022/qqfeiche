import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/multiplayer': {
        target: 'ws://127.0.0.1:3010',
        ws: true,
      },
    },
  },
});
