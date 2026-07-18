import type { NextConfig } from 'next';

const securityHeaders = [
  // NFR-6: all traffic TLS; enforce it at the browser once seen.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
  // ADR §5.2: frame-ancestors none (legacy header + CSP directive).
  { key: 'X-Frame-Options', value: 'DENY' },
  // TODO(phase-1): full nonce-based CSP (no inline script) via middleware,
  // per ADR §5.2. For phase 0 we only ship the frame-ancestors directive.
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const nextConfig: NextConfig = {
  // NFR-13: portable standalone build, runnable anywhere.
  output: 'standalone',
  transpilePackages: ['@command-center/contracts', '@command-center/ui'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
