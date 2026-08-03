'use client'

import { useActionState, useState } from 'react'
import { Check, Copy, ExternalLink, KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { generarEnlaceEntrarComo, type AccesoState } from '@/modules/superadmin/accesoActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const init: AccesoState = {}

/**
 * ENTRAR COMO cualquier usuario (cliente, staff o superadmin) con un enlace
 * de un solo uso. El enlace abre la sesión de ESE usuario en el navegador
 * donde se abra — por eso la guía insiste en la ventana de incógnito.
 */
export function EntrarComoCard() {
  const [state, action, pending] = useActionState(generarEnlaceEntrarComo, init)
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    if (!state.url) return
    try {
      await navigator.clipboard.writeText(state.url)
      setCopiado(true)
      toast.success('Enlace copiado.')
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toast.error('No se pudo copiar; selecciónalo a mano.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden />
          Entrar como un usuario
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Escribe el email de cualquier usuario (cliente, empleado o admin) y
          genera un enlace de acceso de un solo uso para ver la plataforma
          exactamente como la ve esa persona.
        </p>
        <form action={action} className="flex flex-wrap gap-2">
          <Input
            type="email"
            name="email"
            required
            placeholder="email del usuario"
            className="min-w-56 flex-1"
          />
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Generar enlace
          </Button>
        </form>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}

        {state.url && (
          <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/10 p-4">
            <p className="text-sm font-semibold text-foreground">
              Enlace para {state.destinatario}
            </p>
            <p className="break-all rounded-lg bg-card p-2 font-mono text-xs text-muted-foreground">
              {state.url}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={copiar}>
                {copiado ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                Copiar
              </Button>
              <a href={state.url} target="_blank" rel="noopener noreferrer">
                <Button type="button" size="sm" variant="outline">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir
                </Button>
              </a>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              ⚠️ Ábrelo en una <strong>ventana de incógnito</strong>: quien lo
              abra queda con la sesión de ese usuario (si lo abres aquí,
              reemplaza tu sesión de superadmin y tendrás que volver a entrar).
              Es de un solo uso y expira solo. Cada enlace queda en la
              bitácora de auditoría.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
