'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    import('@sentry/nextjs')
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => {})
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning/15">
        <AlertTriangle className="h-6 w-6 text-warning-foreground" />
      </div>
      <h1 className="text-xl font-bold text-foreground">
        No se pudo cargar esta sección
      </h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        Ocurrió un error inesperado. Puedes reintentar sin salir del panel.
      </p>
      <Button onClick={() => reset()} className="mt-6">
        Reintentar
      </Button>
      {error.digest && (
        <p className="mt-4 text-xs text-muted-foreground">Código de error: {error.digest}</p>
      )}
    </div>
  )
}
