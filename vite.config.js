import { defineConfig } from 'vite';

const multiplayerTarget = process.env.NEON_APEX_MULTIPLAYER_TARGET || 'ws://127.0.0.1:3010';

export default defineConfig({
  server: {
    proxy: {
      '/multiplayer': {
        target: multiplayerTarget,
        ws: true,
      },
    },
  },
});
