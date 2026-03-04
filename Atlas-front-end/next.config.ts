import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ── Required for Docker multi-stage build ─────────────────────────────────
  // `standalone` mode outputs a self-contained server in .next/standalone/
  // that can be started with `node server.js` without the full node_modules.
  // This is what the Dockerfile's runner stage copies and executes.
  output: 'standalone',

  // ── Build-time relaxations ────────────────────────────────────────────────
  // Keep these in dev to allow iterating without fixing every TS/lint error.
  // Remove or flip to `false` before shipping to production.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // ── Allowed image domains for next/image ──────────────────────────────────
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
