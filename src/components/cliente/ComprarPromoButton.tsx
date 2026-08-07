'use client'

/**
 * Fase E5/E8 · CTA único de adquisición de una promoción (panel del cliente).
 *
 * El botón es SIEMPRE "Adquirir promoción" (gratis o de pago), nunca
 * "Ver promoción" ni "Solicitar". Al presionarlo se muestra una confirmación
 * con el resumen (gratis vs. precio) antes de crear la solicitud:
 *   · Gratis  → confirmar → activada → ofrecer cita (omitible) → QR.
 *   · De pago → confirmar → solicitud → pantalla de pago → QR al validar.
 */

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Sparkles, Ticket, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { solicitarCompraPromocion, type CompraState } from '@/modules/promociones/compraActions'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const init: CompraState = {}

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 2 }).format(n)
}

export function ComprarPromoButton({
  promocionId,
  precio,
  agotada,
  yaAdquirida = false,
  unSoloUso = false,
  retorno,
}: {
  promocionId: string
  precio: number
  agotada: boolean
  /** El cliente ya alcanzó el límite de adquisiciones de esta promoción. */
  yaAdquirida?: boolean
  /** El límite por cliente es 1 (mostrar "un solo uso"). */
  unSoloUso?: boolean
  /** Fase 4 · contexto de ubicación: se encadena al detalle de la compra. */
  retorno?: string
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(solicitarCompraPromocion, init)
  const [confirmar, setConfirmar] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const esGratis = precio <= 0
  // Ruta interna ya sanitizada por la página; solo se anexa cuando vino del mapa.
  const retornoQs = retorno ? `?retorno=${encodeURIComponent(retorno)}` : ''

  useEffect(() => {
    if (state.success && state.compraId) {
      toast.success(
        state.activada
          ? '¡Promoción activada! Tu QR está listo.'
          : 'Solicitud creada. Completa el pago para activarla.'
      )
      // Activada: pasamos por el paso OPCIONAL de agendar cita (esa pantalla
      // se salta sola si la empresa no tiene agenda). Si quedó pendiente de
      // pago, va directo al detalle a completar la transferencia. `retorno`
      // preserva el contexto del mapa a lo largo de ese camino.
      router.push(
        state.activada
          ? `/cliente/mis-promociones/${state.compraId}/agendar${retornoQs}`
          : `/cliente/mis-promociones/${state.compraId}${retornoQs}`
      )
    } else if (state.error) {
      toast.error(state.error)
      // Ya tiene una compra viva de esta promo: llevarlo a esa compra.
      if (state.compraId) router.push(`/cliente/mis-promociones/${state.compraId}${retornoQs}`)
    }
  }, [state, router, retornoQs])

  if (yaAdquirida) {
    return (
      <div className="space-y-2">
        <Button size="xl" className="w-full gap-2 font-bold" disabled>
          <CheckCircle2 className="h-5 w-5" />
          Ya la adquiriste{unSoloUso ? ' · un solo uso' : ''}
        </Button>
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link href="/cliente/mis-promociones">Ver mis beneficios</Link>
        </Button>
      </div>
    )
  }

  if (agotada) {
    return (
      <Button size="xl" className="w-full font-bold" disabled>
        Promoción agotada
      </Button>
    )
  }

  return (
    <>
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="promocionId" value={promocionId} />
        <Button
          type="button"
          size="xl"
          className="w-full gap-2 font-bold shadow-glow"
          disabled={pending}
          onClick={() => setConfirmar(true)}
        >
          {pending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : esGratis ? (
            <Sparkles className="h-5 w-5" />
          ) : (
            <Ticket className="h-5 w-5" />
          )}
          Adquirir promoción
        </Button>
      </form>

      <ConfirmDialog
        open={confirmar}
        title="Adquirir promoción"
        description={
          esGratis
            ? 'Esta promoción es gratuita. Al confirmar se activará al instante y tendrás tu QR listo para canjear.'
            : `El costo es ${fmtRD(precio)}. Al confirmar crearemos tu solicitud y podrás completar el pago por transferencia para activarla.`
        }
        confirmText={esGratis ? 'Activar ahora' : 'Continuar al pago'}
        cancelText="Cancelar"
        isLoading={pending}
        onConfirm={() => {
          // Cierra el diálogo de inmediato; el botón principal muestra el
          // spinner mientras se procesa (evita setState dentro del efecto).
          setConfirmar(false)
          formRef.current?.requestSubmit()
        }}
        onCancel={() => setConfirmar(false)}
      />
    </>
  )
}
