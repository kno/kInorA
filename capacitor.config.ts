import type { CapacitorConfig } from '@capacitor/cli';

// Only inject a live-reload server block when CAP_SERVER_URL is explicitly
// provided AND we are not in a production build.  This prevents cleartext
// from being compiled into a release APK/AAB.
const devServerUrl = process.env.CAP_SERVER_URL;
const isProduction = process.env.NODE_ENV === 'production';

const config: CapacitorConfig = {
  appId: 'com.kinora.app',
  appName: 'kInorA',
  webDir: 'apps/web/.next',
  // Dev live-reload: run `CAP_SERVER_URL=http://localhost:3000 npx cap sync`
  // For Android emulator use http://10.0.2.2:3000 as CAP_SERVER_URL.
  // The server block (including cleartext) is omitted entirely in production.
  ...(devServerUrl && !isProduction
    ? {
        server: {
          hostname: 'localhost',
          url: devServerUrl,
          // cleartext is needed only for localhost / emulator loopback.
          // Cleartext to arbitrary hosts is blocked by network_security_config.xml.
          cleartext: true,
        },
      }
    : {}),
};

export default config;
