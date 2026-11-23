import type { NextConfig } from 'next';

/**
 * Where the NestJS API lives. Server-only: the browser always calls the API same-origin through the
 * rewrites below, so cookies set by the API belong to this host and reach page requests (ACC-19).
 */
const backendOrigin = process.env.BACKEND_ORIGIN ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  // Rendering follows brief section 9 with route segment config (dynamic SSR, ISR via
  // `revalidate`), so Cache Components stays off; see frontend/README.md "Rendering strategy".
  turbopack: {
    // frontend/ has its own lockfile next to the repo root's (husky/commitlint tooling).
    root: __dirname,
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${backendOrigin}/api/:path*` },
      {
        source: '/uploads/:path*',
        destination: `${backendOrigin}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
