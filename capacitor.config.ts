import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kinora.app',
  appName: 'kInorA',
  webDir: 'apps/web/.next',
  server: {
    hostname: 'localhost',
    /** Dev: carga desde el servidor Next.js (requiere `pnpm start:web`).
     *  Para producción, comenta `url` y Capacitor usará `webDir`.
     *  Para emulador Android usa 10.0.2.2 en lugar de localhost. */
    url: process.env.CAP_SERVER_URL ?? 'http://localhost:3000',
    cleartext: true,
  },
};

export default config;
