'use client'

/**
 * Sembrar la demostración de Excursiones. Solo aparece en empresas marcadas
 * como DEMO: la marca es lo que garantiza que estos datos no se mezclen con
 * los de una empresa real ni entren en las métricas de la plataforma.
 */

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  sembrarDemoExcursiones,
  type SiembraActionState,
} from '@/modules/excursiones/demo/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: SiembraActionState = {}

export function SembrarDemoExcursiones({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(sembrarDemoExcursiones, init)

  useEffect(() => {
    if (state.success) {
      toast.success('Demostración sembrada.')
      router.refresh()
    }
  }, [state.success, router])

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">Demostración de Excursiones</p>
            <p className="mt-1 text-small text-muted-foreground">
              Carga una operación completa y creíble: tres excursiones con sus precios, cuatro
              vendedores con su QR, veintiún clientes captados, doce reservas —una a medio
              cobrar y otra cancelada—, sus ventas con comisiones calculadas por el motor real,
              una liquidación pagada y los embarques del día.
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              Los clientes se crean como los de mostrador: no pueden iniciar sesión. Solo se
              puede sembrar una vez, y solo en empresas demo.
            </p>

            {state.error ? (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            ) : null}
            {state.success ? (
              <Alert className="mt-3">
                <AlertDescription>{state.success}</AlertDescription>
              </Alert>
            ) : null}

            <form action={formAction} className="mt-3">
              <input type="hidden" name="companyId" value={companyId} />
              <Button type="submit" disabled={pending} className="gap-2">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Sembrar la demostración
              </Button>
            </form>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
