'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function AuthError({
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
    <div className="w-full max-w-md space-y-4 text-center">
      <h2 className="text-xl font-bold">Error de autenticación</h2>
      <p className="text-small text-muted-foreground">
        No pudimos procesar tu solicitud. Intenta de nuevo.
      </p>
      <div className="flex justify-center gap-3">
        <Button onClick={() => reset()} variant="outline">
          Reintentar
        </Button>
        <Link href="/login">
          <Button>Ir al login</Button>
        </Link>
      </div>
    </div>
  )
}
