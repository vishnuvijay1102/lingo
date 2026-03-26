import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lingocoach.com',
  appName: 'LINGOCOACH',
  webDir: 'dist',
   server: {
    androidScheme: 'https'
  }
};

export default config;
