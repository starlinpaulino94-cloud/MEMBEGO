'use client'

/**
 * Comprobante en pantalla tras confirmar un uso (Fase E4). Muestra los
 * identificadores oficiales (TX-… y ticket) y delega la impresión al Receipt
 * Engine (ReceiptTicket: plantilla por empresa, 58/80 mm, QR de la
 * transacción). La primera impresión se registra automáticamente; las
 * siguientes desde esta pantalla quedan auditadas como COPIA.
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
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10">
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
  const [printCount, setPrintCount] = useState(0)
  const [copiaNumero, setCopiaNumero] = useState<number | undefined>()
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

  function handlePrint() {
    if (transaccionId) {
      // Cada impresión queda auditada; de la 2ª en adelante es COPIA #N.
      registrarImpresionTx(transaccionId, printCount > 0 ? 'Reimpresión desde el comprobante' : undefined)
        .then((r) => {
          if (r.numero != null) setCopiaNumero(r.numero)
        })
        .catch(() => {})
    }
    setPrintCount((c) => c + 1)
    // Deja montar el ticket (y renderizar su QR) antes de abrir el diálogo.
    setTimeout(() => window.print(), printCount === 0 ? 350 : 0)
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

  const esCopia = printCount > 1
  return (
    <>
      {/* Screen view */}
      <div className="print:hidden space-y-5">
        {/* Success header */}
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
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
            variant="outline"
            className="flex-col gap-1 h-auto py-3"
          >
            <Printer className="h-5 w-5" />
            <span className="text-caption">{printCount > 0 ? 'Reimprimir' : 'Imprimir'}</span>
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
        />
      ) : (
        /* Fallback legado si el servidor no devolvió el payload del ticket */
        <div className="hidden print:block">
          <style>{`
            @media print {
              body * { visibility: hidden !important; }
              .receipt-print, .receipt-print * { visibility: visible !important; }
              /* absolute (no fixed): fixed recorta a una página los tickets largos. */
              .receipt-print { position: absolute; top: 0; left: 0; width: 80mm; }
              html, body { height: auto !important; overflow: visible !important; }
            }
          `}</style>
          <div
            className="receipt-print mx-auto font-mono text-black"
            style={{ width: '80mm', fontSize: '12px', lineHeight: '1.5' }}
          >
            <div className="text-center border-b border-black pb-2 mb-3">
              <p className="font-bold text-base">{cliente.empresa}</p>
              <p className="text-caption">COMPROBANTE DE VISITA</p>
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
              <p className="mt-1 text-caption text-muted-foreground">
                Ref: {visitId.slice(-12).toUpperCase()}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
