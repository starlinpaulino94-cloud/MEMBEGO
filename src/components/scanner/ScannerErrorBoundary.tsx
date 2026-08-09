'use client'

import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  onReset?: () => void
}

interface State {
  error: Error | null
}

export class ScannerErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    try {
      import('@sentry/nextjs').then((Sentry) => {
        Sentry.captureException(error, { tags: { boundary: 'scanner' } })
      }).catch(() => {})
    } catch {}
     
    console.error('[scanner-boundary]', error)
  }

  handleReset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <div className="rounded-xl border border-destructive/25 bg-destructive/10 p-6 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-card shadow-sm">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <div>
            <h3 className="text-h2 text-destructive">Error en el escáner</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Ocurrió un problema inesperado. Reintenta; si persiste, contacta al
              administrador. El detalle técnico ya fue reportado automáticamente.
            </p>
          </div>
          {/* El stack solo en desarrollo: al empleado nunca se le muestran internals. */}
          {process.env.NODE_ENV === 'development' && error.stack && (
            <pre className="max-h-40 overflow-auto rounded-lg bg-card p-3 text-left text-caption leading-tight text-muted-foreground">
              {error.stack}
            </pre>
          )}
          <Button onClick={this.handleReset} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
