/** @type {import('next').NextConfig} */
const nextConfig = {
  // API rewrites to route subdomains in monorepo setup
  async rewrites() {
    return [
      // GridGuide.ai dashboard
      { source: "/api/:path*", destination: "/api/:path*" },
    ];
  },

  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },

  // Image domains for product images
  images: {
    domains: [
      "cdn.gridguide.ai",
      "storage.googleapis.com",
      "s3.amazonaws.com",
    ],
  },

  // Bundle analyzer in dev
  ...(process.env.ANALYZE === "true" && {
    productionBrowserSourceMaps: false,
  }),
};

export default nextConfig;
