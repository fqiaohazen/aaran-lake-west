import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load all environment variables (including non-VITE_ variables like 'mapid' set in AWS Amplify)
  const env = loadEnv(mode, process.cwd(), '');

  const rawApiKey = (
    env.VITE_GOOGLE_MAPS_API_KEY ||
    env.GOOGLE_MAPS_API_KEY ||
    env.GOOGLE_MAP_TOKEN ||
    env.GOOGLE_MAPS_TOKEN ||
    env.mapid ||
    env.MAPID ||
    env.MAP_ID ||
    env.VITE_MAPID ||
    env.VITE_MAP_ID ||
    ''
  ).trim();

  const rawMapId = (
    env.VITE_GOOGLE_MAPS_MAP_ID ||
    env.mapid ||
    env.MAPID ||
    env.MAP_ID ||
    ''
  ).trim();

  // If the user placed their Google Maps API key (starts with "AIza") into `mapid` or `VITE_GOOGLE_MAPS_MAP_ID`,
  // automatically route it to the API key and use 'DEMO_MAP_ID' as the vector Map ID.
  const resolvedApiKey =
    rawApiKey || (rawMapId.startsWith('AIza') ? rawMapId : '');
  const resolvedMapId =
    rawMapId && !rawMapId.startsWith('AIza') ? rawMapId : 'DEMO_MAP_ID';

  return {
    plugins: [react()],
    define: {
      __AMPLIFY_GOOGLE_MAPS_API_KEY__: JSON.stringify(resolvedApiKey),
      __AMPLIFY_GOOGLE_MAPS_MAP_ID__: JSON.stringify(resolvedMapId),
    },
    server: {
      port: 5173,
      host: true,
    },
  };
});
