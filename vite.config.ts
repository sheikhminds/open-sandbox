import {defineConfig, loadEnv} from 'vite';
import react from '@vitejs/plugin-react';

import {chatApiPlugin} from './server/chatApi';

export default defineConfig(({mode}) => {
  // Load .env for the server-side proxy only. Because the keys are not
  // VITE_-prefixed, Vite does not expose them in the client bundle.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['REFLECTION_API_KEY', 'REFLECTION_MODEL'] as const) {
    if (!process.env[key] && env[key]) process.env[key] = env[key];
  }

  return {
    plugins: [react(), chatApiPlugin()],
    server: {host: true, port: 5173},
    preview: {host: true, port: 4173},
  };
});
