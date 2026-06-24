import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kinora.app',
  appName: 'kInorA',
  webDir: 'apps/web/.next',
  server: {
    hostname: 'localhost',
    url: 'https://localhost',
  },
};

export default config;
