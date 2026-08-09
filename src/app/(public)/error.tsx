'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function PublicError({
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
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-h2 text-foreground">Algo salió mal</h2>
      <p className="text-sm text-muted-foreground">No pudimos cargar esta página. Intenta de nuevo.</p>
      <div className="flex gap-3">
        <Button onClick={() => reset()} variant="outline">Reintentar</Button>
        <Link href="/"><Button>Inicio</Button></Link>
      </div>
    </div>
  )
}
