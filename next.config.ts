import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // El build de producción en Vercel (2 núcleos / 8 GB) murió por OOM
    // (SIGKILL). Esta opción hace que webpack libere memoria entre fases de
    // compilación a costa de un build algo más lento — necesario porque la app
    // ya tiene cientos de rutas.
    webpackMemoryOptimizations: true,
  },
  images: {
    remotePatterns: [
      {
        // Supabase Storage — all projects
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  transpilePackages: ['@membego/ui'],
  redirects: async () => {
    return [
      // Alias amigable del perfil público (membego.com/empresa/slug).
      {
        source: '/empresa/:slug*',
        destination: '/empresas/:slug*',
        permanent: true,
      },
    ]
  },
  headers: async () => {
    return [
      {
        source: '/:path*',
        headers: [
          // Prevent clickjacking attacks
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          // Prevent MIME type sniffing
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // Nota: X-XSS-Protection se eliminó a propósito. Está obsoleto, los
          // navegadores modernos lo ignoran y en algunos casos introduce
          // vulnerabilidades. La protección real la da la Content-Security-Policy.
          // Referrer Policy: send minimal info to other sites
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Enforce HTTPS
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          // Content Security Policy: restrict resource loading
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // 'unsafe-inline'/'unsafe-eval' los requieren el runtime inline de
              // Next.js y el decodificador wasm de html5-qrcode. Endurecerlos a
              // CSP basada en nonce es un cambio mayor que necesita pruebas en
              // navegador (scanner + hidratación) y se dejó como paso futuro.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              // api.github.com se eliminó: no se usa en la app.
              "connect-src 'self' https://*.supabase.co https://*.ingest.sentry.io https://*.sentry.io",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join('; '),
          },
          // Permissions Policy (formerly Feature Policy)
          {
            key: 'Permissions-Policy',
            // geolocation=(self): el selector de ubicación del perfil ofrece
            // "usar mi ubicación" (opcional). camera=(self) para el scanner QR.
            value: 'geolocation=(self), microphone=(), camera=(self), payment=()',
          },
        ],
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  org: 'flash-tecnologi',
  project: 'membego',
  authToken: process.env.SENTRY_AUTH_TOKEN,

  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  sourcemaps: {
    // Sin SENTRY_AUTH_TOKEN no hay a dónde subirlos: generarlos solo consume
    // memoria del build (el OOM de Vercel). Con token, todo sigue igual.
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
  // Ubicación nueva de estas opciones desde @sentry/nextjs 10 (antes vivían
  // en la raíz y emitían deprecation warnings en cada build).
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: true,
    reactComponentAnnotation: { enabled: true },
  },
})
