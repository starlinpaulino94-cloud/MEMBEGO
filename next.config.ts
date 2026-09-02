import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    // El chequeo de tipos NO corre en el build de despliegue, y no es una
    // relajación: `npx tsc --noEmit` es un check REQUERIDO del CI, así que un
    // error de tipos no puede llegar a `main`. Aquí solo repetía ese trabajo
    // sumando su pico de memoria (~2 GB medidos) encima de lo que webpack aún
    // retiene, en la máquina de Vercel (2 núcleos / 8 GB) — donde el build
    // entero pica en ~6 GB y el OOM killer lo mataba SIN mensaje: el log se
    // cortaba en seco en un punto distinto cada vez. Si esto se pone en false,
    // hay que subir la máquina de build de Vercel a la vez.
    ignoreBuildErrors: true,
  },
  experimental: {
    // El build de producción en Vercel (2 núcleos / 8 GB) murió por OOM
    // (SIGKILL). Esta opción hace que webpack libere memoria entre fases de
    // compilación a costa de un build algo más lento — necesario porque la app
    // ya tiene cientos de rutas.
    webpackMemoryOptimizations: true,
    serverActions: {
      // El formulario público de solicitudes (/solicitud-empresa) sube logo,
      // portada e imágenes de promoción (≤ 5 MB cada una) por Server Action.
      // El límite por defecto es 1 MB: con cualquier foto real, la petición
      // moría en el transporte y el negocio veía «Algo salió mal» — sin
      // llegar nunca a la validación. El formulario limita el TOTAL a 28 MB
      // en el navegador; este techo lo respalda con margen.
      bodySizeLimit: '30mb',
    },
  },
  images: {
    // En desarrollo local, Supabase Storage corre en 127.0.0.1 que es IP
    // privada; Next.js Image Optimization rechaza fetchear IPs privadas.
    // Desactivamos la optimización solo en dev para que <Image> funcione.
    unoptimized: process.env.NODE_ENV === 'development',
    remotePatterns: [
      {
        // Supabase Storage — all projects
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        // Local Supabase Storage (127.0.0.1)
        protocol: 'http',
        hostname: '127.0.0.1',
        port: '54321',
        pathname: '/storage/v1/object/public/**',
      },
      {
        // Local Supabase Storage (localhost)
        protocol: 'http',
        hostname: 'localhost',
        port: '54321',
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
              // Auditoría de producción · A-04. `'unsafe-eval'` se retiró y se
              // sustituyó por `'wasm-unsafe-eval'`.
              //
              // Lo único que necesitaba evaluación dinámica era el decodificador
              // wasm del escáner (html5-qrcode). `'unsafe-eval'` habilitaba ESO
              // y, de paso, `eval()` y `new Function()` sobre cualquier cadena:
              // justo la primitiva que convierte un XSS en ejecución de código
              // arbitrario. `'wasm-unsafe-eval'` permite compilar WebAssembly y
              // nada más, que es lo que el escáner realmente pide.
              //
              // `'unsafe-inline'` SE QUEDA, y conviene decir por qué en vez de
              // fingir que está resuelto: el runtime de Next.js inyecta scripts
              // inline para la hidratación. Quitarlo exige CSP por nonce en
              // TODAS las respuestas —el `proxy` ya emite el nonce, ver
              // `src/proxy.ts`— y verificar en navegador que ni la hidratación
              // ni el escáner se rompen. Está preparado, no activado: activarlo
              // sin esa prueba deja la aplicación en blanco, y una pantalla en
              // blanco no es más segura.
              // *.gtp-seglan.com / *.cardnet.com.do: el checkout hospedado de
              // CardNET (widget PWCheckout.js del middleware GTP/Seglan) carga
              // su script, abre su iframe y crea un worker (blob:) desde ese
              // dominio. Solo afecta a CARTOWN (única empresa con la pasarela).
              // Ver docs/PAGOS-CARDNET.md.
              // connect.facebook.net: el SDK del Alta Incrustada de WhatsApp.
              // Dominio EXACTO y no `*.facebook.net`: un comodín aquí abriría
              // cualquier subdominio presente y futuro de Meta, y solo hace
              // falta el que sirve el SDK. Ver docs/connect/whatsapp-embedded-signup.md.
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://connect.facebook.net https://*.cardnet.com.do https://*.gtp-seglan.com",
              // El widget crea un Web Worker desde un blob:; sin worker-src la
              // CSP cae a script-src (que no lleva blob:) y lo bloquea.
              "worker-src 'self' blob:",
              "style-src 'self' 'unsafe-inline' https://*.gtp-seglan.com",
              `img-src 'self' data: https: blob: ${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}`,
              "font-src 'self' data: https://*.gtp-seglan.com",
              // api.github.com se eliminó: no se usa en la app.
              // graph.facebook.com y www.facebook.com: el SDK de Meta consulta
              // la Graph API y publica el resultado del alta hacia su propio
              // dominio. Los dos EXACTOS, sin comodín.
              `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL || ''} https://*.supabase.co https://*.ingest.sentry.io https://*.sentry.io https://graph.facebook.com https://www.facebook.com https://*.cardnet.com.do https://*.gtp-seglan.com`,
              // cardnet.com.do: el reto 3DS del banco se pinta en un iframe y el
              // formulario que lo abre hace POST a la pasarela. Sin estas dos
              // reglas, el navegador bloquea la pantalla del banco. Solo afecta a
              // CARTOWN (única empresa con la pasarela); para las demás, nunca se
              // carga ese iframe. Ver docs/PAGOS-CARDNET.md.
              // www.facebook.com y web.facebook.com: el diálogo del Alta
              // Incrustada se pinta en un marco servido desde ahí. Son los dos
              // orígenes que el componente acepta por `postMessage`
              // (ORIGENES_META), y la lista se mantiene igual en los dos
              // sitios a propósito: si un día se abre uno aquí y no allá, el
              // mensaje llegaría y se descartaría sin explicación.
              "frame-src 'self' https://www.facebook.com https://web.facebook.com https://*.cardnet.com.do https://*.gtp-seglan.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self' https://*.cardnet.com.do https://*.gtp-seglan.com",
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

/**
 * Sentry en tiempo de BUILD (crear la release y subir los mapas de fuente).
 *
 * La organización y el proyecto se leen del entorno para poder corregirlos en
 * Vercel sin tocar código: cuando no cuadran con el token, el CLI responde
 * "Project not found" y el despliegue se llena de rojo aunque la app compile
 * perfectamente. Los valores de siempre quedan como respaldo.
 *
 * `SENTRY_UPLOAD=off` apaga la subida por completo aunque haya token — útil
 * para recuperar los ~2 min de build que se van en una subida que no llega.
 */
const sentryOrg = process.env.SENTRY_ORG || 'flash-tecnologi'
const sentryProject = process.env.SENTRY_PROJECT || 'membego'
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const subirASentry =
  Boolean(sentryAuthToken && sentryOrg && sentryProject) && process.env.SENTRY_UPLOAD !== 'off'

export default withSentryConfig(nextConfig, {
  org: sentryOrg,
  project: sentryProject,
  authToken: sentryAuthToken,

  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  sourcemaps: {
    // Sin subida no hay a dónde mandarlos: generarlos solo consume memoria del
    // build (el OOM de Vercel). Con subida activa, todo sigue igual.
    disable: !subirASentry,
    deleteSourcemapsAfterUpload: true,
  },
  release: {
    // Antes esto se intentaba SIEMPRE, aunque los mapas estuvieran desactivados:
    // de ahí el `releases new` → "Project not found" en cada despliegue. Si no
    // vamos a subir nada, tampoco hay release que crear.
    create: subirASentry,
    finalize: subirASentry,
  },
  // Un fallo hablando con Sentry NUNCA debe tumbar un despliegue de producción:
  // la telemetría es accesoria, la app no. El plugin trae varios caminos que
  // lanzan por defecto (y tumban el build); con este manejador se avisa una vez
  // y la compilación sigue.
  errorHandler: (err) => {
    console.warn('[sentry] no se pudo completar la subida; el build continúa:', err.message)
  },
  // Ubicación nueva de estas opciones desde @sentry/nextjs 10 (antes vivían
  // en la raíz y emitían deprecation warnings en cada build).
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: true,
    reactComponentAnnotation: { enabled: true },
  },
})
