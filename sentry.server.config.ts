import * as Sentry from '@sentry/nextjs'
import { limpiarEvento } from './src/modules/observabilidad/sentryLimpieza'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === 'production',
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? 'development',
  release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,

  tracesSampleRate: 0.2,

  integrations: [
    Sentry.prismaIntegration(),
  ],

  // Fase 6 · la política de limpieza vive en un solo sitio para que servidor y
  // navegador no se desincronicen. Ver src/modules/observabilidad/sentryLimpieza.ts.
  beforeSend(event) {
    return limpiarEvento(event)
  },

  ignoreErrors: [
    'NEXT_REDIRECT',
    'NEXT_NOT_FOUND',
  ],
})
