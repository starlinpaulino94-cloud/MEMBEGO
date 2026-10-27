'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Gift, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { crearOfertaPrivada, type OfertaActionState } from '@/modules/ofertas/actions'
import { ClientePicker, type ClienteOption } from '@/components/ofertas/ClientePicker'
import { Button } from '@/components/ui/button'

const init: OfertaActionState = {}

const inputClase =
  'mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function CrearOfertaForm({ clientes }: { clientes: ClienteOption[] }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(crearOfertaPrivada, init)

  useEffect(() => {
    if (state.success && state.ofertaId) {
      toast.success(state.mensaje ?? 'Oferta creada.')
      router.push(`/admin/ofertas/${state.ofertaId}`)
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  return (
    <form action={formAction} className="space-y-6">
      <div className="rounded-2xl border border-border/70 bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">El regalo</h2>
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-medium text-muted-foreground">
            Título
            <input
              name="titulo"
              required
              maxLength={120}
              placeholder="Ej.: 12 lavados gratis al mes"
              className={inputClase}
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Descripción (opcional)
            <textarea
              name="descripcion"
              rows={2}
              maxLength={500}
              placeholder="Condiciones o detalles que verá el cliente al abrir su regalo…"
              className={inputClase}
            />
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">La regla de usos</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-muted-foreground">
            Cantidad de usos
            <input
              type="number"
              name="usosPorPeriodo"
              min={1}
              max={500}
              defaultValue={12}
              className={inputClase}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Se renuevan
            <select name="periodo" defaultValue="MENSUAL" className={inputClase}>
              <option value="MENSUAL">Cada mes</option>
              <option value="SEMANAL">Cada semana</option>
              <option value="TOTAL">Nunca (cupo único)</option>
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Válido hasta (opcional)
            <input type="date" name="vigenciaHasta" className={inputClase} />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Ej.: 12 usos · cada mes · válido hasta dentro de un año = 12 lavados
          gratis al mes por un año.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          ¿Quiénes reciben este regalo?
        </h2>
        <ClientePicker clientes={clientes} />
        <p className="mt-2 text-xs text-muted-foreground">
          Solo estas cuentas podrán reclamarlo. Si el link llega a otra persona,
          verá &quot;tu cuenta no aplica para esta promoción&quot;.
        </p>
      </div>

      <Button type="submit" disabled={pending} className="min-h-11 gap-2 font-semibold">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
        Crear regalo y generar link
      </Button>
    </form>
  )
}
