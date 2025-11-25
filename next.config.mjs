/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Ensure app route handlers run dynamically
    forceSwcTransforms: true,
  },
};

export default nextConfig;
