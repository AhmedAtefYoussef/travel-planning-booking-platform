import type { NextConfig } from 'next';
import { readServerEnv } from './src/shared/config/env';

const { BACKEND_URL } = readServerEnv();

const nextConfig: NextConfig = {
  // Brief section 9: rendering is chosen per route. Cache Components makes data dynamic by default;
  // public pages opt into caching with 'use cache' + cacheLife (ISR), private pages stay per-request.
  cacheComponents: true,
  partialPrefetching: true,
  typedRoutes: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
  // Same-origin API: the browser calls /api/* on this app and Next.js forwards it to the NestJS API,
  // so the httpOnly auth cookies are first-party and no CORS is involved (ACC-19).
  // Uploaded images are served by the API outside /api, so they are forwarded the same way.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` },
      {
        source: '/uploads/:path*',
        destination: `${BACKEND_URL}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
