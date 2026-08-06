import * as Sentry from '@sentry/nextjs'
import type { SessionUser } from '@/types'

export function setSentryUser(user: SessionUser | null) {
  if (!user) {
    Sentry.setUser(null)
    return
  }
  Sentry.setUser({
    id: user.metadata.dbUserId || user.supabaseId,
    email: user.email,
  })
  Sentry.setTag('user.role', user.metadata.role)
  if (user.metadata.companyId) {
    Sentry.setTag('company.id', user.metadata.companyId)
  }
}

export function captureSupabaseError(
  error: unknown,
  context: { operation: string; table?: string; [key: string]: unknown }
) {
  Sentry.withScope((scope) => {
    scope.setTag('source', 'supabase')
    scope.setTag('operation', context.operation)
    if (context.table) scope.setTag('table', context.table)
    scope.setContext('supabase', context)
    if (error instanceof Error) {
      Sentry.captureException(error)
    } else {
      Sentry.captureMessage(`Supabase error: ${context.operation}`, {
        level: 'error',
        extra: { error, ...context },
      })
    }
  })
}

export function capturarErrorInesperado(
  contexto: string,
  e: unknown,
  extra?: Record<string, unknown>
) {
  console.error(`[${contexto}]`, e)
  Sentry.withScope((scope) => {
    scope.setTag('source', 'server-action')
    scope.setTag('contexto', contexto)
    scope.setContext('accion', { contexto, ...extra })
    if (e instanceof Error) {
      Sentry.captureException(e)
    } else {
      Sentry.captureMessage(`Server action error: ${contexto}`, {
        level: 'error',
        extra: { error: e },
      })
    }
  })
}
