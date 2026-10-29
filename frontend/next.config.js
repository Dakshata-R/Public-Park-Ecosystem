/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a second dev server (e.g. against another API) run beside the first
  // without sharing — and corrupting — its build cache.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  // Compile only the icons and chart parts a page imports, not the whole library.
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
};

module.exports = nextConfig;
