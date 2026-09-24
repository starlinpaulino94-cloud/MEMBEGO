'use client'

import { useActionState, useEffect, useState, type ReactNode } from 'react'
import { Gift, MapPin, QrCode } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  abrirQrAction,
  reportarIncidenciaAction,
  reservarAction,
  type EstadoAccion,
} from '@/modules/supply/actions'
import {
  SUPPLY_INCIDENCIA_TIPO_LABELS,
  SUPPLY_ORIGEN_LABELS,
  type SupplyOrigenLabelKey,
} from '@/modules/supply/catalogo'
import { MINUTOS_QR } from '@/modules/supply/minutos-qr'

interface Beneficio {
  derechoId: string
  voucherId: string | null
  producto: string
  variante: string | null
  proveedor: string
  venceAt: Date
  origen: string
  campana: string | null
  exigeReserva: boolean
  reservaAt: Date | null
  precioPagado: number
  /** Lo resuelve quien lee los datos: `Date.now()` en el render es impuro. */
  vencePronto: boolean
}

/**
 * El código y su cuenta atrás, remontados en cada QR nuevo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTÁ APARTE
 *
 * El contador se reiniciaba llamando a `setRestante(...)` en el cuerpo de un
 * efecto de la tarjeta, que es lo que el compilador de React rechaza: fuerza
 * un render de más por cada QR y es la puerta de entrada a las cascadas de
 * renders. Remontar con `key` es el reinicio que React recomienda para esto —
 * el estado NACE con el valor correcto y ya no hay efecto que lo corrija
 * después.
 *
 * De paso deja de contar ticks y pasa a restar contra un instante fijo: un
 * `setInterval` en una pestaña de fondo se retrasa, y la cuenta llegaba a cero
 * más tarde que el código de verdad. Ahora el contador dice lo que el servidor
 * va a hacer, que es el único motivo por el que está en pantalla.
 *
 * `alExpirar` es lo que se pinta cuando el plazo se agota — el mismo botón de
 * «Usar beneficio»—. Llega como nodo en vez de como aviso al padre para que
 * no haya que subir el estado: el plazo lo sabe quien lo cuenta.
 */
function CodigoConCuentaAtras({ nonce, alExpirar }: { nonce: string; alExpirar: ReactNode }) {
  const [restante, setRestante] = useState(MINUTOS_QR * 60)

  useEffect(() => {
    const fin = Date.now() + MINUTOS_QR * 60_000
    const t = setInterval(
      () => setRestante(Math.max(0, Math.round((fin - Date.now()) / 1000))),
      1000
    )
    return () => clearInterval(t)
  }, [])

  if (restante <= 0) return <>{alExpirar}</>

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4 text-center">
      <p className="text-caption text-muted-foreground">Enséñale este código al empleado</p>
      <p className="break-all font-mono text-sm font-semibold">{nonce}</p>
      <p className="text-caption text-muted-foreground">
        Válido {Math.floor(restante / 60)}:{String(restante % 60).padStart(2, '0')}
      </p>
    </div>
  )
}

interface Sucursal {
  id: string
  nombre: string
  direccion: string | null
}

/**
 * MEMBEGO SUPPLY · la tarjeta con la que el cliente usa su beneficio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL QR SE GENERA AL PULSAR, NO ANTES
 *
 * Vive cinco minutos y es de un solo uso. Así una captura de pantalla enviada
 * por WhatsApp no vale nada pasado el rato, y el beneficio sigue siendo de su
 * titular. La cuenta atrás no es decoración: es la información que necesita
 * quien está en la fila del mostrador.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA RESERVA VA ANTES QUE EL QR CUANDO EL CONTRATO LO EXIGE
 *
 * Una excursión con cupo no se puede canjear apareciendo: el proveedor
 * comprometió asientos por día. Para esos beneficios el botón de usar está
 * desactivado hasta que haya reserva, en vez de dejar que la persona llegue al
 * muelle con un código que el escáner va a rechazar.
 */
export function TarjetaBeneficio({
  beneficio,
  clienteId,
  sucursales,
}: {
  beneficio: Beneficio
  clienteId: string
  sucursales: Sucursal[]
}) {
  const [qr, accionQr, generandoQr] = useActionState<EstadoAccion, FormData>(abrirQrAction, {})
  const [reserva, accionReserva, reservando] = useActionState<EstadoAccion, FormData>(
    reservarAction,
    {}
  )
  const [incidencia, accionIncidencia, reportando] = useActionState<EstadoAccion, FormData>(
    reportarIncidenciaAction,
    {}
  )

  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '')
  const [reportar, setReportar] = useState(false)

  const faltaReserva = beneficio.exigeReserva && !beneficio.reservaAt

  // El botón de pedir el código. Se pinta tal cual cuando no hay QR, y también
  // dentro del contador cuando el plazo se agota: que el código deje de servir
  // no puede dejar a nadie sin manera de pedir otro.
  const formularioQr = (
    <form action={accionQr}>
      <input type="hidden" name="voucherId" value={beneficio.voucherId ?? ''} />
      <input type="hidden" name="clienteId" value={clienteId} />
      <input type="hidden" name="sucursalId" value={sucursalId} />
      <Button
        type="submit"
        className="w-full"
        disabled={generandoQr || !beneficio.voucherId || faltaReserva}
      >
        <QrCode className="mr-2 size-4" aria-hidden />
        {generandoQr ? 'Generando…' : faltaReserva ? 'Reserva primero' : 'Usar beneficio'}
      </Button>
      {qr.error && <p className="mt-2 text-caption text-destructive">{qr.error}</p>}
    </form>
  )

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Gift className="size-5 text-primary" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {beneficio.producto}
              {beneficio.variante ? ` · ${beneficio.variante}` : ''}
            </p>
            <p className="text-caption text-muted-foreground">{beneficio.proveedor}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant={beneficio.vencePronto ? 'warning' : 'outline'}>
                Vence el{' '}
                {new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'long' }).format(
                  beneficio.venceAt
                )}
              </Badge>
              {beneficio.precioPagado === 0 && <Badge variant="success">Gratis</Badge>}
              <Badge variant="secondary">
                {SUPPLY_ORIGEN_LABELS[beneficio.origen as SupplyOrigenLabelKey] ?? beneficio.origen}
              </Badge>
            </div>
          </div>
        </div>

        {sucursales.length > 0 && (
          <div className="text-caption text-muted-foreground">
            <p className="flex items-center gap-1 font-medium text-foreground">
              <MapPin className="size-3.5" aria-hidden /> Dónde usarlo
            </p>
            <ul className="mt-1 space-y-0.5">
              {sucursales.slice(0, 4).map((s) => (
                <li key={s.id}>
                  {s.nombre}
                  {s.direccion ? ` — ${s.direccion}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {beneficio.reservaAt && (
          <p className="rounded-lg bg-muted/40 p-3 text-caption">
            Reservado para el{' '}
            {new Intl.DateTimeFormat('es-DO', {
              dateStyle: 'full',
              timeStyle: 'short',
            }).format(beneficio.reservaAt)}
          </p>
        )}

        {faltaReserva && sucursales.length > 0 && (
          <form action={accionReserva} className="space-y-2 rounded-lg border border-border p-3">
            <input type="hidden" name="derechoId" value={beneficio.derechoId} />
            <input type="hidden" name="clienteId" value={clienteId} />
            <p className="text-caption font-medium">Reserva tu cupo antes de ir</p>
            <div className="flex flex-wrap gap-2">
              <select
                name="sucursalId"
                value={sucursalId}
                onChange={(e) => setSucursalId(e.target.value)}
                className="h-9 flex-1 rounded-lg border border-input bg-transparent px-3 text-sm"
                aria-label="Sucursal"
              >
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
              <input
                type="date"
                name="dia"
                required
                className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
                aria-label="Día"
              />
              <input
                type="number"
                name="hora"
                min={0}
                max={23}
                placeholder="Hora"
                className="h-9 w-20 rounded-lg border border-input bg-transparent px-3 text-sm"
                aria-label="Hora"
              />
              <Button type="submit" size="sm" variant="secondary" disabled={reservando}>
                {reservando ? 'Reservando…' : 'Reservar'}
              </Button>
            </div>
            {reserva.error && <p className="text-caption text-destructive">{reserva.error}</p>}
            {reserva.success && <p className="text-caption text-success">{reserva.success}</p>}
          </form>
        )}

        {qr.success ? (
          /* `key` en la sesión: cada QR nuevo remonta el contador con su plazo
             entero, sin que nadie tenga que reiniciarlo a mano. */
          <CodigoConCuentaAtras
            key={qr.id ?? qr.success}
            nonce={qr.success}
            alExpirar={formularioQr}
          />
        ) : (
          formularioQr
        )}

        {reportar ? (
          <form action={accionIncidencia} className="space-y-2 rounded-lg border border-border p-3">
            <input type="hidden" name="derechoId" value={beneficio.derechoId} />
            <input type="hidden" name="clienteId" value={clienteId} />
            <select
              name="tipo"
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
              aria-label="Qué pasó"
            >
              {(
                Object.keys(SUPPLY_INCIDENCIA_TIPO_LABELS) as (keyof typeof SUPPLY_INCIDENCIA_TIPO_LABELS)[]
              ).map((t) => (
                <option key={t} value={t}>
                  {SUPPLY_INCIDENCIA_TIPO_LABELS[t]}
                </option>
              ))}
            </select>
            <textarea
              name="detalle"
              required
              rows={2}
              maxLength={2000}
              placeholder="Cuéntanos qué pasó…"
              className="w-full rounded-lg border border-input bg-transparent p-2 text-sm"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="secondary" disabled={reportando}>
                {reportando ? 'Enviando…' : 'Enviar'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setReportar(false)}>
                Cancelar
              </Button>
            </div>
            {incidencia.error && (
              <p className="text-caption text-destructive">{incidencia.error}</p>
            )}
            {incidencia.success && (
              <p className="text-caption text-success">{incidencia.success}</p>
            )}
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setReportar(true)}
            className="text-caption text-muted-foreground underline underline-offset-4"
          >
            ¿Tuviste un problema con este beneficio?
          </button>
        )}
      </CardContent>
    </Card>
  )
}
