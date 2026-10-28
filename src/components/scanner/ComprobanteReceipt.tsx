'use client'

/**
 * Comprobante en pantalla tras confirmar un uso (Fase E4). Muestra los
 * identificadores oficiales (TX-… y ticket) y delega la impresión al Receipt
 * Engine (ReceiptTicket: plantilla por empresa, 58/80 mm, QR de la
 * transacción). Cada impresión queda auditada: la primera es el original y de
 * la 2ª en adelante el papel lleva «COPIA #N» con el número que registró el
 * servidor (antes el banner salía de un contador local que aún no se había
 * pintado al abrir el diálogo, y la copia salía como original).
 */

import { useEffect, useRef, useState } from 'react'
import {
  Printer,
  CheckCircle2,
  Share2,
  ScanLine,
  User,
  Building2,
  CreditCard,
  Calendar,
  Clock,
  Sparkles,
  Gift,
  Shield,
  Hash,
  Ticket,
} from 'lucide-react'
import { registrarImpresion } from '@/modules/visitas/actions'
import { registrarImpresionTx, type TicketPayload } from '@/modules/transacciones/actions'
import { ReceiptTicket } from '@/components/scanner/ReceiptTicket'
import { AreaDeImpresion } from '@/components/impresion/AreaDeImpresion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ClienteLookup } from '@/modules/visitas/actions'

interface Props {
  cliente: ClienteLookup
  visitId: string
  servicio: string
  restantes: number
  /** Fase E4: registro oficial + payload del ticket (Receipt Engine). */
  transaccionId?: string
  codigo?: string
  ticketNumero?: string
  ticket?: TicketPayload
  onDone: () => void
  /** Vuelve directo a la cámara para el siguiente cliente. */
  onScanNext?: () => void
}

function fmtDate(d: Date) {
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'long' }).format(d)
}

function fmtTime(d: Date) {
  return new Intl.DateTimeFormat('es-DO', { timeStyle: 'short' }).format(d)
}

function fmtDateTime(d: Date) {
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: string; icon: typeof User }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success-soft">
        <Icon className="h-3.5 w-3.5 text-success" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-caption text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  )
}

export function ComprobanteReceipt({
  cliente,
  visitId,
  servicio,
  restantes,
  transaccionId,
  codigo,
  ticketNumero,
  ticket,
  onDone,
  onScanNext,
}: Props) {
  const hasLogged = useRef(false)
  const [impresiones, setImpresiones] = useState(0)
  const [copiaNumero, setCopiaNumero] = useState<number | undefined>()
  const [solicitud, setSolicitud] = useState(0)
  const [imprimiendo, setImprimiendo] = useState(false)
  // Compatibilidad: si el servidor aún no devolvió transacción (bundle viejo),
  // se conserva el código derivado de la visita.
  const codigoOperacion = codigo ?? `MBGO-${visitId.slice(-8).toUpperCase()}`
  const now = ticket ? new Date(ticket.transaccion.fecha) : new Date()

  useEffect(() => {
    if (!hasLogged.current) {
      hasLogged.current = true
      // Registro legado por visita (métricas existentes) — se mantiene.
      registrarImpresion(visitId).catch(() => {})
    }
  }, [visitId])

  async function handlePrint() {
    if (imprimiendo) return
    setImprimiendo(true)
    try {
      if (transaccionId) {
        // Cada impresión queda auditada; el servidor dice qué número es (1 = original, 2+ = COPIA #N).
        const r = await registrarImpresionTx(transaccionId, impresiones > 0 ? 'Reimpresión desde el comprobante' : undefined).catch(() => ({}) as { numero?: number })
        if (r.numero != null) setCopiaNumero(r.numero > 1 ? r.numero : undefined)
      }
      setImpresiones((n) => n + 1)
      // Se imprime cuando el ticket ya está pintado con estos datos (ver AreaDeImpresion).
      setSolicitud((s) => s + 1)
    } finally {
      setImprimiendo(false)
    }
  }

  async function handleShare() {
    const text = [
      `Visita confirmada — ${cliente.empresa}`,
      `Cliente: ${cliente.nombre}`,
      `Servicio: ${servicio}`,
      `Transacción: ${codigoOperacion}`,
      ...(ticketNumero ? [`Ticket: ${ticketNumero}`] : []),
      `Fecha: ${fmtDateTime(now)}`,
    ].join('\n')

    if (navigator.share) {
      try {
        await navigator.share({ title: 'Comprobante de visita', text })
        return
      } catch { /* user cancelled */ }
    }
    await navigator.clipboard.writeText(text).catch(() => {})
  }

  const esCopia = copiaNumero != null && copiaNumero > 1
  return (
    <>
      {/* Screen view */}
      <div className="space-y-5">
        {/* Success header */}
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
            <CheckCircle2 className="h-9 w-9 text-success" />
          </div>
          <h3 className="text-xl font-bold text-foreground">Uso registrado correctamente</h3>
          <p className="mt-1 text-sm text-muted-foreground">{fmtDateTime(now)}</p>
        </div>

        {/* Receipt card */}
        <div className="rounded-xl border-2 border-success/25 bg-card p-4 space-y-0.5">
          <InfoRow label="Cliente" value={cliente.nombre} icon={User} />
          <InfoRow label="Empresa" value={cliente.empresa} icon={Building2} />
          <InfoRow label="Plan" value={cliente.planNombre ?? 'Sin plan'} icon={CreditCard} />
          <InfoRow label="Servicio utilizado" value={servicio} icon={Gift} />
          <InfoRow label="Fecha" value={fmtDate(now)} icon={Calendar} />
          <InfoRow label="Hora" value={fmtTime(now)} icon={Clock} />
          <InfoRow label="Transacción" value={codigoOperacion} icon={Hash} />
          {ticketNumero && <InfoRow label="Ticket" value={ticketNumero} icon={Ticket} />}
          <InfoRow
            label="Usos restantes"
            value={cliente.esIlimitado ? 'Ilimitado' : String(restantes)}
            icon={cliente.esIlimitado ? Sparkles : Shield}
          />
        </div>

        {/* Status badge */}
        <div className="flex justify-center">
          <Badge variant="success" className="text-caption px-3 py-1">
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            QR validado y registrado
          </Badge>
        </div>

        {/* Action buttons: la acción primaria es atender al siguiente cliente
            sin volver a la pantalla fría. */}
        {onScanNext && (
          <Button onClick={onScanNext} size="xl" className="w-full gap-2 font-semibold">
            <ScanLine className="h-5 w-5" />
            Escanear siguiente
          </Button>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Button
            onClick={handlePrint}
            disabled={imprimiendo}
            variant="outline"
            className="flex-col gap-1 h-auto py-3"
          >
            <Printer className="h-5 w-5" />
            <span className="text-caption">{impresiones > 0 ? 'Reimprimir' : 'Imprimir'}</span>
          </Button>
          <Button
            onClick={handleShare}
            variant="outline"
            className="flex-col gap-1 h-auto py-3"
          >
            <Share2 className="h-5 w-5" />
            <span className="text-caption">Compartir</span>
          </Button>
          <Button
            onClick={onDone}
            variant="outline"
            className="flex-col gap-1 h-auto py-3"
          >
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-caption">Finalizar</span>
          </Button>
        </div>
      </div>

      {/* Ticket imprimible: Receipt Engine (plantilla de la empresa, QR TX-…) */}
      {ticket ? (
        <ReceiptTicket
          ticket={ticket}
          esCopia={esCopia}
          copiaNumero={esCopia ? copiaNumero : undefined}
          logoUrl={ticket.empresa.logoUrl}
          solicitud={solicitud}
        />
      ) : (
        /* Fallback legado si el servidor no devolvió el payload del ticket: mismo canal de impresión. */
        <AreaDeImpresion papel={80} solicitud={solicitud}>
          <div className="font-mono text-black" style={{ fontSize: '12px', lineHeight: '1.5', padding: '2mm 0' }}>
            <div className="text-center border-b border-black pb-2 mb-3">
              <p className="font-bold text-base">{cliente.empresa}</p>
              <p className="text-caption">COMPROBANTE DE VISITA{esCopia ? ` · COPIA #${copiaNumero}` : ''}</p>
            </div>
            <div className="space-y-1 mb-3">
              <div className="flex justify-between">
                <span>No.:</span>
                <span className="font-bold">{codigoOperacion}</span>
              </div>
              <div className="flex justify-between">
                <span>Fecha:</span>
                <span>{fmtDateTime(now)}</span>
              </div>
            </div>
            <div className="border-t border-dashed border-black pt-2 mt-2 space-y-1 mb-3">
              <div className="flex justify-between">
                <span>Cliente:</span>
                <span className="font-bold">{cliente.nombre}</span>
              </div>
              <div className="flex justify-between">
                <span>Plan:</span>
                <span>{cliente.planNombre ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Servicio:</span>
                <span>{servicio}</span>
              </div>
            </div>
            <div className="border-t border-dashed border-black pt-2 mt-2 mb-3">
              {cliente.esIlimitado ? (
                <div className="flex justify-between font-bold">
                  <span>Usos:</span>
                  <span>ILIMITADO</span>
                </div>
              ) : (
                <div className="flex justify-between font-bold">
                  <span>Usos restantes:</span>
                  <span>{restantes}</span>
                </div>
              )}
            </div>
            <div className="border-t border-black pt-2 text-center text-caption">
              <p>Gracias por tu preferencia.</p>
              <p className="mt-1 text-caption">Ref: {visitId.slice(-12).toUpperCase()}</p>
            </div>
          </div>
        </AreaDeImpresion>
      )}
    </>
  )
}
