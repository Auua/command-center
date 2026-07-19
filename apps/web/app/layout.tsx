import type { Metadata, Viewport } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { PwaRegister } from '@/components/pwa-register';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Command Center',
  description: 'Personal dashboard: learning, tasks, automations, mood, journal.',
  applicationName: 'Command Center',
  // iOS installed-PWA chrome (Phase 2 plan §4); pairs with app/manifest.ts.
  appleWebApp: {
    capable: true,
    title: 'Command Center',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  // Mirrors globals.css --cc-bg in both themes.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f5f2' },
    { media: '(prefers-color-scheme: dark)', color: '#131417' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
