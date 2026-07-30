'use client'

import { useActionState, useEffect, useState } from 'react'
import { Landmark, Store, CheckCircle2, Loader2, MapPin, CreditCard } from 'lucide-react'
import { toast } from 'sonner'
import {
  avisarPagoPresencial,
  type PresencialState,
} from '@/modules/membresia/actions'
import { ComprobanteForm } from '@/components/membresia/ComprobanteForm'
import { PagoTokenCardnet } from '@/components/membresia/PagoTokenCardnet'
import { Button } from '@/components/ui/button'
import { cn } from '@membego/ui/cn'

interface MetodoTransferencia {
  id: string
  nombre: string
  titular: string | null
  numeroCuenta: string | null
  tipoCuenta: string | null
  instrucciones: string | null
}

interface MetodoPresencial {
  id: string
  nombre: string
  instrucciones: string | null
}

interface SucursalOption {
  id: string
  nombre: string
  direccion: string | null
}

interface Props {
  membershipId: string
  companyName: string
  transferencias: MetodoTransferencia[]
  presenciales: MetodoPresencial[]
  /** Sucursales activas para elegir dónde pagar. */
  sucursales: SucursalOption[]
  /** true = el cliente ya avisó que pagará en la sucursal. */
  avisoPresencialEnviado: boolean
  /** Referencia ya generada (persistida en la orden). */
  referencia: string | null
  /**
   * false = la empresa retiró la transferencia y esta membresía no se había
   * comprometido con ella. Se oculta la pestaña entera: no es lo mismo "no hay
   * cuentas cargadas todavía" (se muestra y se explica) que "este método ya no
   * se ofrece" (no debe aparecer).
   */
  transferenciaDisponible: boolean
  /** true = la empresa (CARTOWN) tiene la pasarela de tarjeta activa. */
  tarjetaDisponible: boolean
  /** Monto a mostrar en el botón de pago con tarjeta (ej. "RD$500"). */
  montoTexto: string
  /**
   * Config PÚBLICA de la pasarela hospedada de CardNET (llave pública + URLs).
   * No incluye la llave privada. Solo llega cuando `tarjetaDisponible`.
   */
  tokensConfig?: { publicKey: string; captureUrl: string; scriptUrl: string } | null
  /** Logo de la empresa para la cabecera de la ventana de pago. */
  logoUrl?: string | null
}

type Opcion = 'tarjeta' | 'transferencia' | 'presencial'

const initial: PresencialState = {}

/**
 * Dos formas de pagar un plan (o un cambio de plan):
 *  - Transferencia: datos bancarios + subir comprobante (flujo existente).
 *  - Presencial: el cliente avisa y paga en la sucursal; el encargado
 *    confirma el pago al recibirlo y el plan se activa.
 */
export function OpcionesPago({
  membershipId,
  companyName,
  transferencias,
  presenciales,
  sucursales,
  avisoPresencialEnviado,
  referencia,
  transferenciaDisponible,
  tarjetaDisponible,
  montoTexto,
  tokensConfig,
  logoUrl,
}: Props) {
  // Las opciones que existen para esta membresía, en orden de preferencia.
  // Presencial (efectivo en sucursal) SIEMPRE está. Tarjeta y transferencia
  // aparecen si están disponibles.
  const opciones: { key: Opcion; icon: typeof Landmark; titulo: string; detalle: string }[] = [
    ...(tarjetaDisponible
      ? [{ key: 'tarjeta' as const, icon: CreditCard, titulo: 'Tarjeta', detalle: 'Paga ahora con tu tarjeta y actívalo al instante' }]
      : []),
    ...(transferenciaDisponible
      ? [{ key: 'transferencia' as const, icon: Landmark, titulo: 'Transferencia', detalle: 'Paga desde tu banco y sube el comprobante' }]
      : []),
    { key: 'presencial' as const, icon: Store, titulo: 'En la sucursal', detalle: 'Paga en efectivo al visitar el local' },
  ]

  // Por defecto: tarjeta si está; si no, la primera disponible. Si el cliente
  // ya avisó que pagará presencial, se respeta esa elección.
  const inicial: Opcion = avisoPresencialEnviado ? 'presencial' : opciones[0].key
  const [opcion, setOpcion] = useState<Opcion>(inicial)
  const [state, formAction, pending] = useActionState(avisarPagoPresencial, initial)

  useEffect(() => {
    if (state.success) toast.success('Aviso enviado. Te esperamos en la sucursal.')
    if (state.error) toast.error(state.error)
  }, [state])

  const avisado = avisoPresencialEnviado || state.success === true
  const referenciaActual = state.referencia ?? referencia
  const sucursal = presenciales[0] ?? null

  return (
    <div className="space-y-5">
      {/* Selector de forma de pago: se muestra si hay más de una opción */}
      {opciones.length > 1 && (
      <div>
        <h3 className="text-sm font-medium text-foreground">¿Cómo prefieres pagar?</h3>
        <div className={cn('mt-2 grid gap-3', opciones.length >= 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {opciones.map(({ key, icon: Icon, titulo, detalle }) => (
            <button
              key={key}
              type="button"
              onClick={() => setOpcion(key)}
              aria-pressed={opcion === key}
              className={cn(
                'rounded-2xl border p-4 text-left transition',
                opcion === key
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border/70 bg-card hover:border-primary/40'
              )}
            >
              <Icon
                className={cn('h-5 w-5', opcion === key ? 'text-primary' : 'text-muted-foreground')}
                aria-hidden
              />
              <p className="mt-2 text-sm font-semibold text-foreground">{titulo}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{detalle}</p>
            </button>
          ))}
        </div>
      </div>
      )}

      {opcion === 'tarjeta' && tokensConfig ? (
        <PagoTokenCardnet
          membershipId={membershipId}
          montoTexto={montoTexto}
          publicKey={tokensConfig.publicKey}
          captureUrl={tokensConfig.captureUrl}
          scriptUrl={tokensConfig.scriptUrl}
          companyName={companyName}
          logoUrl={logoUrl}
        />
      ) : opcion === 'transferencia' ? (
        <div className="space-y-5">
          {transferencias.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">Datos para el pago</h3>
              {transferencias.map((m) => (
                <div key={m.id} className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
                  <p className="font-medium text-foreground">{m.nombre}</p>
                  {m.titular && <p className="text-muted-foreground">Titular: {m.titular}</p>}
                  {m.numeroCuenta && (
                    <p className="text-muted-foreground">
                      Cuenta: {m.numeroCuenta}
                      {m.tipoCuenta ? ` (${m.tipoCuenta})` : ''}
                    </p>
                  )}
                  {m.instrucciones && (
                    <p className="mt-1 text-xs text-muted-foreground">{m.instrucciones}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">
              {companyName} aún no publicó cuentas para transferencia. Puedes pagar
              en la sucursal con la otra opción.
            </p>
          )}

          <ComprobanteForm
            membershipId={membershipId}
            metodosPago={transferencias.map((m) => ({ id: m.id, nombre: m.nombre }))}
          />
        </div>
      ) : avisado ? (
        <div className="rounded-2xl border border-success/25 bg-success/10 p-5">
          <p className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden /> Aviso enviado
          </p>
          {referenciaActual && (
            <div className="mt-3 rounded-xl bg-card p-4 text-center">
              <p className="text-xs text-muted-foreground">
                Muestra esta referencia al pagar en caja
              </p>
              <p className="mt-1 font-mono text-2xl font-bold tracking-[0.2em] text-foreground">
                {referenciaActual}
              </p>
            </div>
          )}
          <p className="mt-3 text-sm text-foreground">
            Te esperamos en {sucursal?.nombre || `la sucursal de ${companyName}`}.
            Cuando la persona encargada reciba tu pago, lo confirmará y tu plan se
            activará al instante.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-muted/30 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              Dirígete a {sucursal?.nombre || `la sucursal de ${companyName}`} para
              realizar tu pago
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              La persona encargada recibirá tu pago, lo confirmará y tu plan se
              activará al instante — sin subir ningún comprobante.
            </p>
            {sucursal?.instrucciones && (
              <p className="mt-2 text-xs text-muted-foreground">{sucursal.instrucciones}</p>
            )}
          </div>

          <form action={formAction} className="space-y-3">
            <input type="hidden" name="membershipId" value={membershipId} />
            {sucursal && <input type="hidden" name="metodoPagoId" value={sucursal.id} />}
            {sucursales.length > 1 ? (
              <div className="space-y-1.5">
                <label htmlFor="sucursalId" className="text-sm font-medium text-foreground">
                  ¿En cuál sucursal pagarás?
                </label>
                <select
                  id="sucursalId"
                  name="sucursalId"
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                      {s.direccion ? ` — ${s.direccion}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              sucursales[0] && (
                <input type="hidden" name="sucursalId" value={sucursales[0].id} />
              )
            )}
            <Button type="submit" disabled={pending} className="w-full py-6 text-base font-semibold">
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Pagaré en la sucursal
            </Button>
          </form>
          <p className="text-center text-xs text-muted-foreground">
            Avisamos al equipo para que te espere; tu plan queda reservado mientras tanto.
          </p>
        </div>
      )}
    </div>
  )
}
