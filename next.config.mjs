/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Ensure app route handlers run dynamically
    forceSwcTransforms: true,
  },
};

export default nextConfig;
