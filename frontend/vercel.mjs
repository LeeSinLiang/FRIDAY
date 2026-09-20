// Evaluated by Vercel with the deployment's environment, not by Vite.
const origin = process.env.FRIDAY_API_ORIGIN;
if (!origin) throw new Error('FRIDAY_API_ORIGIN must identify this environment\'s API deployment');
const url = new URL(origin);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
  throw new Error('FRIDAY_API_ORIGIN must be a plain HTTPS origin');
}

export const config = {
  framework: 'vite',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [
    { source: '/api/:path*/', destination: `${url.origin}/api/:path*/` },
    { source: '/api/:path*', destination: `${url.origin}/api/:path*` },
    { source: '/_allauth/:path*/', destination: `${url.origin}/_allauth/:path*/` },
    { source: '/_allauth/:path*', destination: `${url.origin}/_allauth/:path*` },
    ...['/', '/rooms', '/room/:id', '/cart', '/account/:path*', '/checkout'].map(source => ({ source, destination: '/index.html' })),
  ],
  headers: [{ source: '/(.*)', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  ] }],
};
