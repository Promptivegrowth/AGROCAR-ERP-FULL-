import type { NextConfig } from "next";
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  runtimeCaching: [
    {
      urlPattern: /^\/pwa\/.*/,
      handler: "NetworkFirst",
      options: {
        cacheName: "pwa-pages",
        expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /^https:\/\/fkymlbhypbhnnklojbrp\.supabase\.co\/rest\/.*/,
      handler: "NetworkFirst",
      options: {
        cacheName: "supabase-api",
        expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 },
      },
    },
  ],
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "fkymlbhypbhnnklojbrp.supabase.co" },
    ],
  },
};

module.exports = withPWA(nextConfig);
