/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Asegurar que el service worker se sirva con el Content-Type correcto
        // y sin cache agresivo (sino las actualizaciones del SW no se aplican).
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          { key: 'Content-Type', value: 'application/manifest+json' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
    ]
  },
};

export default nextConfig;
