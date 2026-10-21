'use client'

import { useActionState, useEffect, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'
import {
  activarRenovacionAction,
  desactivarRenovacionAction,
  type RenovacionActionState,
} from '@/modules/pagos/renovacionActions'
import {
  RUTA_POLITICA_RENOVACION,
  TEXTO_VERSION_RENOVACION,
  partirTexto,
  renderizarTexto,
} from '@/modules/pagos/consentimientosCore'
import { etiquetaTarjeta } from '@/modules/pagos/avisosRenovacionCore'
import type { TarjetaDePantalla } from '@/modules/pagos/renovacionFormato'
import { cn } from '@membego/ui/cn'

const inicial: RenovacionActionState = {}

/**
 * LA RENOVACIÓN AUTOMÁTICA DE UNA MEMBRESÍA, en la propia membresía.
 *
 * Cuatro situaciones, y cada una dice la verdad sobre lo que va a pasar:
 *
 *  · **Activa**: con qué tarjeta, cuánto y cuándo. Se puede desactivar; la tarjeta
 *    sigue guardada. Si se activó antes de que existiera el registro de
 *    consentimientos (`HEREDADO`), se ofrece CONFIRMARLA con el texto completo.
 *  · **Apagada y con tarjetas guardadas**: se puede activar, y activarla es un
 *    CONSENTIMIENTO — el texto registrado a la vista, un enlace a las condiciones
 *    completas de la Política de pagos, y una casilla sin marcar. El botón no se
 *    habilita hasta marcarla.
 *  · **Apagada y con todas las tarjetas vencidas**: se dice, sin botón.
 *  · **Apagada y sin tarjetas**: no hay nada que activar. Se explica cómo llegar a
 *    tener una, sin un botón que no puede hacer nada.
 */
export function RenovacionAutomatica({
  membershipId,
  empresa,
  montoTexto,
  periodoTexto,
  proximoCobroTexto,
  puedeActivar,
  activa,
  heredada,
  tarjetaActual,
  tarjetas,
}: {
  membershipId: string
  empresa: string
  /** El precio vigente del plan, con formato: «RD$1,600». */
  montoTexto: string
  /** «cada 30 días», o `null` si no se conoce. */
  periodoTexto: string | null
  /** Cuándo vence la membresía y, por tanto, cuándo se cobraría. */
  proximoCobroTexto: string | null
  /** ¿La empresa puede cobrar con tarjeta ahora? Sin esto no se ofrece ACTIVAR (sí desactivar). */
  puedeActivar: boolean
  activa: boolean
  /** La renovación activa es de antes del registro de consentimientos. */
  heredada: boolean
  tarjetaActual: { id: string; marca: string | null; ultimos4: string | null } | null
  tarjetas: TarjetaDePantalla[]
}) {
  const router = useRouter()
  const vigentes = tarjetas.filter((t) => !t.vencida)

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
          <RefreshCw className="h-3.5 w-3.5 text-primary" aria-hidden />
        </span>
        Renovación automática
        {activa && (
          <span className="ml-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
            Activa
          </span>
        )}
      </h2>

      {activa && tarjetaActual ? (
        <div className="mt-3 space-y-4">
          <p className="text-sm leading-relaxed text-foreground">
            Se renovará sola con{' '}
            <strong className="font-semibold">
              {etiquetaTarjeta(tarjetaActual.marca, tarjetaActual.ultimos4)}
            </strong>
            {proximoCobroTexto ? ` en los días previos al ${proximoCobroTexto}` : ''}, por el precio
            vigente del plan (hoy {montoTexto}). Puedes desactivarla cuando quieras; tu tarjeta
            seguirá guardada.
          </p>
          <EnlaceCondiciones />
          <BotonConfirmado
            accion={desactivarRenovacionAction}
            estadoInicial={inicial}
            campos={{ membershipId }}
            variant="outline"
            size="sm"
            alExito={() => {
              toast.success('Renovación automática desactivada.')
              router.refresh()
            }}
            confirmacion={{
              titulo: '¿Desactivar la renovación automática?',
              descripcion: proximoCobroTexto
                ? `Tu membresía sigue activa hasta el ${proximoCobroTexto}. Después tendrás que renovarla tú. No se te cobrará automáticamente.`
                : 'Tu membresía sigue activa hasta su vencimiento. Después tendrás que renovarla tú. No se te cobrará automáticamente.',
              textoConfirmar: 'Sí, desactivar',
              textoCancelar: 'Mantenerla',
            }}
          >
            Desactivar renovación automática
          </BotonConfirmado>

          {heredada && puedeActivar && vigentes.some((t) => t.id === tarjetaActual.id) && (
            <div className="space-y-3 border-t border-border/60 pt-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Activaste esta renovación antes de que registráramos tu autorización. Si quieres
                seguir con ella, confírmala:
              </p>
              <FormularioDeAutorizacion
                membershipId={membershipId}
                empresa={empresa}
                montoTexto={montoTexto}
                periodoTexto={periodoTexto}
                tarjetas={vigentes.filter((t) => t.id === tarjetaActual.id)}
                textoBoton="Confirmar renovación automática"
                mensajeExito="Renovación automática confirmada."
              />
            </div>
          )}
        </div>
      ) : !puedeActivar ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          La renovación automática no está disponible en este negocio por ahora. Puedes renovar tu
          membresía a mano cuando venza.
        </p>
      ) : vigentes.length > 0 ? (
        <FormularioDeAutorizacion
          membershipId={membershipId}
          empresa={empresa}
          montoTexto={montoTexto}
          periodoTexto={periodoTexto}
          // Una tarjeta vencida no se ofrece: el cobro no la intentaría.
          tarjetas={vigentes}
          textoBoton="Activar renovación automática"
          mensajeExito="Renovación automática activada."
        />
      ) : tarjetas.length > 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Tus tarjetas guardadas están vencidas. Para activar la renovación automática, paga con una
          tarjeta vigente y marca «Guardar esta tarjeta para futuras compras».
        </p>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          La renovación automática cobra tu membresía sola con una tarjeta guardada. Para activarla,
          paga con tarjeta una vez y marca «Guardar esta tarjeta para futuras compras»; después
          vuelve aquí.
        </p>
      )}
    </section>
  )
}

/**
 * Las condiciones completas (aviso previo, intentos, cómo desactivarla) están en
 * la Política de pagos, a un clic: la casilla las incorpora sin repetirlas.
 */
function EnlaceCondiciones() {
  return (
    <p className="text-xs text-muted-foreground">
      <a
        href={RUTA_POLITICA_RENOVACION}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-4 hover:text-foreground"
      >
        Condiciones de la renovación automática
      </a>
    </p>
  )
}

/**
 * El formulario del CONSENTIMIENTO: la tarjeta, el texto registrado y una casilla sin
 * marcar. El botón no se habilita hasta marcarla, y el servidor además exige que el
 * formulario diga que se aceptó.
 *
 * El texto sale de `consentimientosCore`, que es lo que el servidor registra como
 * aceptado (`TEXTO_VERSION_RENOVACION`): pantalla y registro leen de la misma fuente.
 */
function FormularioDeAutorizacion({
  membershipId,
  empresa,
  montoTexto,
  periodoTexto,
  tarjetas,
  textoBoton,
  mensajeExito,
}: {
  membershipId: string
  empresa: string
  montoTexto: string
  periodoTexto: string | null
  tarjetas: TarjetaDePantalla[]
  textoBoton: string
  mensajeExito: string
}) {
  const router = useRouter()
  const idAcepto = useId()
  const idDetalle = `${idAcepto}-detalle`
  const [estado, enviar, pendiente] = useActionState(activarRenovacionAction, inicial)
  // La predeterminada si la hay (vienen ordenadas con ella primero).
  const [tarjetaId, setTarjetaId] = useState(tarjetas[0]?.id ?? '')
  const [acepto, setAcepto] = useState(false)

  useEffect(() => {
    if (estado.error) toast.error(estado.error)
    if (estado.success) {
      toast.success(mensajeExito)
      router.refresh()
    }
    // `mensajeExito` y `router` no cambian entre renders: solo reacciona el estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado])

  const texto = partirTexto(
    renderizarTexto(TEXTO_VERSION_RENOVACION, { empresa, monto: montoTexto, periodo: periodoTexto })
  )

  return (
    <form action={enviar} className="mt-3 space-y-4">
      <input type="hidden" name="membershipId" value={membershipId} />

      {tarjetas.length > 1 ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-foreground">¿Con qué tarjeta?</legend>
          {tarjetas.map((t) => (
            <label
              key={t.id}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-sm transition-colors',
                tarjetaId === t.id ? 'border-primary/50 bg-primary/5' : 'border-border/60 hover:border-primary/30'
              )}
            >
              <input
                type="radio"
                name="tarjetaId"
                value={t.id}
                checked={tarjetaId === t.id}
                onChange={() => setTarjetaId(t.id)}
                className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="font-medium text-foreground">{etiquetaTarjeta(t.marca, t.ultimos4)}</span>
              {t.predeterminada && <span className="text-xs text-muted-foreground">· predeterminada</span>}
            </label>
          ))}
        </fieldset>
      ) : (
        <>
          <input type="hidden" name="tarjetaId" value={tarjetaId} />
          <p className="flex items-center gap-2 text-sm text-foreground">
            <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            {/* Un solo hijo de texto: con dos, el `gap` del flex se suma al espacio y se ve doble. */}
            <span>
              Con{' '}
              <strong className="font-semibold">
                {etiquetaTarjeta(tarjetas[0].marca, tarjetas[0].ultimos4)}
              </strong>
            </span>
          </p>
        </>
      )}

      {/* El texto del consentimiento, tal como se registra: corto, y remite a
          las condiciones de la Política de pagos (enlace debajo). La fila entera
          es clicable (≥44px) y el detalle queda asociado a la casilla para el
          lector de pantalla. */}
      <label
        htmlFor={idAcepto}
        className={cn(
          'flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border bg-card p-4 transition-colors',
          acepto ? 'border-primary/50 bg-primary/5' : 'border-border/60 hover:border-primary/30'
        )}
      >
        <input
          id={idAcepto}
          name="acepto"
          type="checkbox"
          checked={acepto}
          onChange={(e) => setAcepto(e.target.checked)}
          aria-describedby={texto.detalle ? idDetalle : undefined}
          className="mt-0.5 h-5 w-5 shrink-0 cursor-[inherit] accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="min-w-0 text-sm">
          <span className="block font-semibold text-foreground">{texto.titulo}</span>
          {texto.detalle ? (
            <span id={idDetalle} className="mt-1 block leading-relaxed text-muted-foreground">
              {texto.detalle}
            </span>
          ) : null}
        </span>
      </label>

      <EnlaceCondiciones />

      <Button type="submit" disabled={!acepto || !tarjetaId || pendiente} className="w-full sm:w-auto">
        {pendiente && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
        {textoBoton}
      </Button>
    </form>
  )
}
