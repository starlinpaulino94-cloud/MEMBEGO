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

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Sparkles, Ticket, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { solicitarCompraPromocion, type CompraState } from '@/modules/promociones/compraActions'
import { Button } from '@/components/ui/button'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'

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
  empresaNueva = false,
  empresa,
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
  /**
   * La persona todavía no es cliente de este negocio. Al adquirir se creará su
   * ficha allí y empezará a seguirlo, así que el diálogo lo dice ANTES de
   * confirmar. Empezar a seguir a alguien sin haberlo pedido es de las cosas
   * que más molestan de una app; avisarlo cuesta una frase.
   */
  empresaNueva?: boolean
  /** Nombre del negocio, para nombrarlo en ese aviso. */
  empresa?: string
}) {
  const router = useRouter()
  const esGratis = precio <= 0
  // Ruta interna ya sanitizada por la página; solo se anexa cuando vino del mapa.
  const retornoQs = retorno ? `?retorno=${encodeURIComponent(retorno)}` : ''

  /**
   * A dónde va la persona después. El toast lo pone `BotonConfirmado`; aquí
   * queda solo la navegación, que es lo propio de esta pantalla.
   */
  function alTerminar(estado: CompraState) {
    if (!estado.compraId) return
    // Activada: pasa por el paso OPCIONAL de agendar cita (esa pantalla se
    // salta sola si la empresa no tiene agenda). Si quedó pendiente de pago, va
    // directo al detalle a completar la transferencia. `retorno` preserva el
    // contexto del mapa a lo largo de ese camino.
    router.push(
      estado.success && estado.activada
        ? `/cliente/mis-promociones/${estado.compraId}/agendar${retornoQs}`
        : `/cliente/mis-promociones/${estado.compraId}${retornoQs}`
    )
  }

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
    <BotonConfirmado
      accion={solicitarCompraPromocion}
      estadoInicial={init}
      campos={{ promocionId }}
      size="xl"
      className="w-full gap-2 font-bold shadow-glow"
      // El éxito trae dos mensajes distintos —activada o pendiente de pago— y
      // los dos llevan a sitios distintos.
      alExito={(estado) => {
        if (!estado.compraId) return
        toast.success(
          estado.activada
            ? '¡Promoción activada! Tu QR está listo.'
            : 'Solicitud creada. Completa el pago para activarla.'
        )
        alTerminar(estado)
      }}
      // El fallo más común es «ya tienes una compra de esta promoción», y trae
      // el id: llevar allí es más útil que dejar a la persona mirando el error.
      alFallar={alTerminar}
      confirmacion={{
        titulo: 'Adquirir promoción',
        descripcion:
          (esGratis
            ? 'Esta promoción es gratuita. Al confirmar se activará al instante y tendrás tu QR listo para canjear.'
            : `El costo es ${fmtRD(precio)}. Al confirmar crearemos tu solicitud y podrás completar el pago por transferencia para activarla.`) +
          (empresaNueva
            ? ` También empezarás a seguir a ${empresa ?? 'este negocio'} para enterarte de sus novedades.`
            : ''),
        textoConfirmar: esGratis ? 'Activar ahora' : 'Continuar al pago',
        textoCancelar: 'Cancelar',
      }}
    >
      {esGratis ? (
        <Sparkles className="h-5 w-5" aria-hidden />
      ) : (
        <Ticket className="h-5 w-5" aria-hidden />
      )}
      Adquirir promoción
    </BotonConfirmado>
  )
}
