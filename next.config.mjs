/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Ensure app route handlers run dynamically
    forceSwcTransforms: true,
    // Enable instrumentation hook for global error handling
    instrumentationHook: true,
  },
};

export default nextConfig;
