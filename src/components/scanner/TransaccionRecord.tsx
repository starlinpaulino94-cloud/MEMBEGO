'use client'

/**
 * Pantalla "Historial de la operación" (Fase E4). Se muestra cuando el
 * escáner lee un QR ya utilizado o el QR de un ticket (código TX-…): en vez
 * de un simple "ya fue usado", presenta el registro completo y profesional
 * de la transacción, con reimpresión auditada del comprobante (COPIA #N).
 */

import { useRef, useState, useTransition } from 'react'
import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
  AlertTriangle,
  Loader2,
  Printer,
  ScanLine,
  RefreshCw,
  History,
  User,
  Car,
  Building2,
  MapPin,
  Gift,
  Megaphone,
  CreditCard,
  BadgeCheck,
  Monitor,
  Hash,
  FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  obtenerTicket,
  registrarImpresionTx,
  type TicketPayload,
  type TransaccionScanInfo,
} from '@/modules/transacciones/actions'
import { ReceiptTicket } from '@/components/scanner/ReceiptTicket'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// Presentación de cada estado del ciclo de vida (dark-safe, tokens semánticos).
const ESTADO_UI: Record<string, { label: string; desc: string; icon: typeof CheckCircle2; box: string; icono: string; badge: 'success' | 'warning' | 'destructive' | 'secondary' | 'info' }> = {
  APPLIED: {
    label: 'Transacción aplicada',
    desc: 'La operación se completó y sus efectos fueron aplicados.',
    icon: CheckCircle2,
    box: 'border-success/25 bg-success/10',
    icono: 'text-success',
    badge: 'success',
  },
  APPROVED: {
    label: 'Transacción aprobada',
    desc: 'Validada y aprobada; pendiente de aplicar sus efectos.',
    icon: BadgeCheck,
    box: 'border-info/25 bg-info/10',
    icono: 'text-info',
    badge: 'info',
  },
  PENDING: {
    label: 'Transacción pendiente',
    desc: 'La operación fue creada y espera validación.',
    icon: Clock,
    box: 'border-border bg-muted/50',
    icono: 'text-muted-foreground',
    badge: 'secondary',
  },
  VALIDATING: {
    label: 'En validación',
    desc: 'El motor de reglas está validando la operación.',
    icon: Clock,
    box: 'border-border bg-muted/50',
    icono: 'text-muted-foreground',
    badge: 'secondary',
  },
  CANCELLED: {
    label: 'Transacción cancelada',
    desc: 'La operación fue cancelada antes de aplicarse.',
    icon: XCircle,
    box: 'border-warning/30 bg-warning/10',
    icono: 'text-warning-foreground',
    badge: 'warning',
  },
  REVERTED: {
    label: 'Transacción revertida',
    desc: 'La operación se aplicó y luego fue revertida.',
    icon: RotateCcw,
    box: 'border-destructive/25 bg-destructive/10',
    icono: 'text-destructive',
    badge: 'destructive',
  },
  EXPIRED: {
    label: 'Transacción expirada',
    desc: 'La operación expiró sin completarse.',
    icon: Clock,
    box: 'border-warning/30 bg-warning/10',
    icono: 'text-warning-foreground',
    badge: 'warning',
  },
  ERROR: {
    label: 'Transacción con error',
    desc: 'La operación falló durante su ejecución.',
    icon: AlertTriangle,
    box: 'border-destructive/25 bg-destructive/10',
    icono: 'text-destructive',
    badge: 'destructive',
  },
}

function fmtFechaHora(iso: string) {
  const d = new Date(iso)
  return {
    fecha: new Intl.DateTimeFormat('es-DO', { dateStyle: 'long' }).format(d),
    hora: new Intl.DateTimeFormat('es-DO', { timeStyle: 'short' }).format(d),
  }
}

function Row({ label, value, icon: Icon, mono = false }: { label: string; value: string; icon: typeof User; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-caption text-muted-foreground">{label}</p>
        <p className={cn('text-sm font-medium text-foreground break-words', mono && 'font-mono')}>{value}</p>
      </div>
    </div>
  )
}

export function TransaccionRecord({
  transaccion: tx,
  esQrUsado = false,
  onScanNext,
  onClose,
}: {
  transaccion: TransaccionScanInfo
  /** true si se llegó aquí escaneando un QR de cliente ya consumido. */
  esQrUsado?: boolean
  onScanNext: () => void
  onClose: () => void
}) {
  const ui = ESTADO_UI[tx.estado] ?? ESTADO_UI.PENDING
  const Icon = ui.icon
  const { fecha, hora } = fmtFechaHora(tx.fecha)

  // Reimpresión auditada: pide motivo, registra COPIA #N y luego imprime.
  const [ticket, setTicket] = useState<TicketPayload | null>(null)
  const [copiaNumero, setCopiaNumero] = useState<number | undefined>()
  const [askMotivo, setAskMotivo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [printing, startPrinting] = useTransition()
  const printArmed = useRef(false)

  function reimprimir() {
    startPrinting(async () => {
      try {
        const [tk, reg] = await Promise.all([
          obtenerTicket(tx.id),
          registrarImpresionTx(tx.id, motivo || 'Reimpresión desde historial del QR'),
        ])
        if (tk.error || !tk.ticket) {
          toast.error(tk.error ?? 'No se pudo generar el ticket.')
          return
        }
        setTicket(tk.ticket)
        setCopiaNumero(reg.numero)
        setAskMotivo(false)
        printArmed.current = true
        // Espera un frame a que el ticket (y su QR) se monte antes de imprimir.
        setTimeout(() => {
          if (printArmed.current) {
            printArmed.current = false
            window.print()
          }
        }, 350)
        toast.success(`Copia #${reg.numero ?? '—'} registrada.`)
      } catch {
        toast.error('No se pudo reimprimir el comprobante.')
      }
    })
  }

  return (
    <div className="space-y-4 animate-scale-in">
      {/* Contexto: cómo se llegó aquí */}
      <div className="flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="h-3.5 w-3.5" />
        {esQrUsado ? 'QR ya utilizado — registro de la operación' : 'Consulta de transacción'}
      </div>

      {/* Banner de estado */}
      <div className={cn('flex items-center gap-3 rounded-xl border px-4 py-3', ui.box)}>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card shadow-premium">
          <Icon className={cn('h-6 w-6', ui.icono)} />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-foreground">{ui.label}</p>
          <p className="text-sm text-muted-foreground">{ui.desc}</p>
        </div>
        <Badge variant={ui.badge} className="ml-auto shrink-0 text-caption">
          {ui.label.replace(/^Transacción /, '')}
        </Badge>
      </div>

      {/* Identificadores oficiales */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-caption text-muted-foreground">Transaction ID</p>
              <p className="font-mono text-base font-bold text-foreground">{tx.codigo}</p>
            </div>
            <div className="text-right">
              <p className="text-caption text-muted-foreground">Ticket</p>
              <p className="font-mono text-sm font-semibold text-foreground">{tx.ticketNumero}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-caption text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {fecha} · {hora}
          </div>
        </CardContent>
      </Card>

      {/* Registro completo */}
      <div className="rounded-xl border border-border/60 bg-card p-4">
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {tx.cliente && <Row label="Cliente" value={tx.cliente} icon={User} />}
          {tx.vehiculo && <Row label="Vehículo" value={tx.vehiculo} icon={Car} />}
          {tx.empresa && <Row label="Empresa" value={tx.empresa} icon={Building2} />}
          {tx.sucursal && <Row label="Sucursal" value={tx.sucursal} icon={MapPin} />}
          {tx.servicio && <Row label="Servicio aplicado" value={tx.servicio} icon={Gift} />}
          {tx.beneficio && <Row label="Beneficio" value={tx.beneficio} icon={Gift} />}
          {tx.promocion && <Row label="Promoción" value={tx.promocion} icon={Megaphone} />}
          {tx.membresia && <Row label="Membresía" value={tx.membresia} icon={CreditCard} />}
          {tx.empleado && <Row label="Empleado que procesó" value={tx.empleado} icon={BadgeCheck} />}
          {tx.caja && <Row label="Caja / dispositivo" value={tx.caja} icon={Monitor} />}
          {tx.impresiones > 0 && (
            <Row label="Impresiones del comprobante" value={String(tx.impresiones)} icon={Printer} />
          )}
          <Row label="Referencia" value={tx.id.slice(-12).toUpperCase()} icon={Hash} mono />
        </div>
        {tx.observaciones && (
          <div className="mt-3 border-t border-border/60 pt-3">
            <Row label="Observaciones" value={tx.observaciones} icon={FileText} />
          </div>
        )}
      </div>

      {/* Cancelación / reversión / error */}
      {tx.cancelacion && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Cancelada el {fmtFechaHora(tx.cancelacion.fecha).fecha} a las {fmtFechaHora(tx.cancelacion.fecha).hora}</p>
            {tx.cancelacion.motivo && <p>Motivo: {tx.cancelacion.motivo}</p>}
          </div>
        </div>
      )}
      {tx.reversion && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Revertida el {fmtFechaHora(tx.reversion.fecha).fecha} a las {fmtFechaHora(tx.reversion.fecha).hora}</p>
            {tx.reversion.motivo && <p>Motivo: {tx.reversion.motivo}</p>}
          </div>
        </div>
      )}
      {tx.errorDetalle && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{tx.errorDetalle}</p>
        </div>
      )}

      {/* Reimpresión auditada */}
      {askMotivo ? (
        <div className="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-3">
          <p className="text-sm font-semibold text-foreground">Reimprimir comprobante (COPIA)</p>
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo de la reimpresión (opcional)…"
            aria-label="Motivo de la reimpresión"
            autoFocus
          />
          <div className="flex gap-2">
            <Button onClick={reimprimir} disabled={printing} className="flex-1 gap-2">
              {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Imprimir copia
            </Button>
            <Button variant="outline" onClick={() => setAskMotivo(false)} disabled={printing}>
              Cancelar
            </Button>
          </div>
          <p className="text-caption text-muted-foreground">
            La copia queda registrada en auditoría con empleado, fecha y motivo, y se
            imprime con la marca &laquo;COPIA&raquo;.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onScanNext} size="lg" className="flex-1 gap-2 font-semibold">
            <ScanLine className="h-4 w-4" />
            Escanear siguiente
          </Button>
          <Button variant="outline" size="lg" className="gap-2" onClick={() => setAskMotivo(true)}>
            <Printer className="h-4 w-4" />
            Reimprimir
          </Button>
          <Button variant="outline" size="lg" className="gap-2" onClick={onClose}>
            <RefreshCw className="h-4 w-4" />
            Inicio
          </Button>
        </div>
      )}

      {/* Ticket imprimible (solo visible al imprimir) */}
      {ticket && (
        <ReceiptTicket
          ticket={ticket}
          esCopia
          copiaNumero={copiaNumero}
          logoUrl={ticket.empresa.logoUrl}
        />
      )}
    </div>
  )
}
