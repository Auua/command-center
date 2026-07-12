import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Command Center',
  description: 'Personal dashboard: learning, tasks, automations, mood, journal.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
