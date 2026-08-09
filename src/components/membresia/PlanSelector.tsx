'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  seleccionarPlan,
  type SeleccionState,
} from '@/modules/membresia/actions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'

export interface PlanOption {
  id: string
  nombre: string
  precio: string
  esIlimitado: boolean
  descripcion: string | null
  beneficios: string[]
}

const initial: SeleccionState = {}

export function PlanSelector({
  planes,
  disabled,
}: {
  planes: PlanOption[]
  disabled?: boolean
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<string | null>(null)
  const [state, formAction, pending] = useActionState(seleccionarPlan, initial)

  useEffect(() => {
    if (state.success) {
      toast.success('Plan seleccionado. Pendiente de confirmación de pago.')
      router.refresh()
    }
  }, [state.success, router])

  return (
    <form action={formAction} className="space-y-6">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="planId" value={selected ?? ''} />
      <div className="grid gap-6 md:grid-cols-3">
        {planes.map((plan) => {
          const active = selected === plan.id
          return (
            <button
              type="button"
              key={plan.id}
              onClick={() => setSelected(plan.id)}
              disabled={disabled}
              className={cn(
                'flex flex-col rounded-2xl border-2 p-6 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
                active
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-border bg-card hover:border-primary/30'
              )}
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xl font-semibold">{plan.nombre}</h3>
                {plan.esIlimitado && (
                  <Badge className="bg-warning/15 text-warning">
                    Ilimitado
                  </Badge>
                )}
              </div>
              <p className="mb-4 text-2xl font-bold text-foreground">
                RD${plan.precio}
                <span className="text-sm font-normal text-muted-foreground">/mes</span>
              </p>
              <ul className="space-y-2">
                {plan.beneficios.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {b}
                  </li>
                ))}
              </ul>
            </button>
          )
        })}
      </div>
      {!disabled && (
        <Button
          type="submit"
          disabled={!selected || pending}
          className="w-full bg-primary hover:bg-primary/90 md:w-auto"
        >
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Elegir plan
        </Button>
      )}
    </form>
  )
}
