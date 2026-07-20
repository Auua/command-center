import type { MetadataRoute } from 'next';

/**
 * PWA web app manifest (Phase 2 plan §4). Installable on Chromium and iOS
 * without offline support — sw.js deliberately has no fetch handler.
 * Colors mirror the light-theme surfaces in globals.css.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Command Center',
    short_name: 'Command Center',
    description: 'Personal dashboard: learning, tasks, automations, mood, journal.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f5f2',
    theme_color: '#f6f5f2',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
