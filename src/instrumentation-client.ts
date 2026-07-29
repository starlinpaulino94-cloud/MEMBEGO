import * as Sentry from '@sentry/nextjs'
import { limpiarEvento, limpiarMiga } from '@/modules/observabilidad/sentryLimpieza'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === 'production',
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? 'development',
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,

  tracesSampleRate: 0.2,

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      maskAllInputs: true,
      blockAllMedia: false,
      mask: ['[data-sentry-mask]', 'input[type="password"]', 'input[name="token"]', 'input[name="email"]'],
      block: ['[data-sentry-block]'],
    }),
    Sentry.browserTracingIntegration(),
    Sentry.breadcrumbsIntegration({
      console: true,
      dom: true,
      fetch: true,
      history: true,
      xhr: true,
    }),
  ],

  // Fase 6 · misma política que el servidor, escrita una sola vez.
  beforeSend(event) {
    return limpiarEvento(event)
  },

  // Antes solo se limpiaban las migas de `fetch` cuya URL contuviera '/auth/'
  // o 'token'. Las de NAVEGACIÓN no se tocaban, y son justo las que llevan
  // `?pase=` y `?code=` en la barra de direcciones.
  beforeBreadcrumb(breadcrumb) {
    return limpiarMiga(breadcrumb)
  },

  ignoreErrors: [
    'ResizeObserver loop',
    'AbortError',
    'NotAllowedError',
  ],
})

// Hook de navegación del App Router: marca el inicio de cada transición de
// ruta para el tracing (recomendado al usar instrumentation-client.ts).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
