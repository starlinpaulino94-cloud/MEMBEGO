'use client'

/**
 * Cuadre del día del empleado (Control de comprobantes · Fase 2 · G5),
 * imprimible y reimprimible. A diferencia del cierre de caja (atado a la
 * sesión), este suma TODOS los cobros que aplicó el empleado ese día —incluidas
 * las transferencias/pagos confirmados desde el panel, que no pasan por caja—.
 * Vista previa idéntica a la impresión: `.reporte-dia-print` se aísla al
 * imprimir. Pensado para térmica 80 mm.
 */

import { useState } from 'react'
import { Loader2, Printer, CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { obtenerReporteDia } from '@/modules/caja/actions'
import type { ReporteEmpleadoDia } from '@/modules/caja/queries'

const fmtRD = (n: number) =>
  `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

function fmtFecha(fecha: string, tz: string) {
  // `fecha` es YYYY-MM-DD; se ancla a mediodía para evitar corrimiento de día.
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: tz,
    dateStyle: 'full',
  }).format(new Date(`${fecha}T12:00:00Z`))
}

function fmtHora(iso: string, tz: string) {
  return new Intl.DateTimeFormat('es-DO', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}>
      <span className="shrink-0">{label}</span>
      <span className="text-right break-all tabular-nums">{value}</span>
    </div>
  )
}

function Sep({ char = '-' }: { char?: string }) {
  return (
    <div className="overflow-hidden whitespace-nowrap text-black/60" aria-hidden>
      {char.repeat(42)}
    </div>
  )
}

function ReportePreview({ r }: { r: ReporteEmpleadoDia }) {
  return (
    <div
      className="mx-auto bg-white font-mono text-black shadow"
      style={{ width: '80mm', fontSize: '12px', lineHeight: 1.5, padding: '3mm 4mm' }}
    >
      {r.empresa.logoUrl && (
        <div className="mb-1 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.empresa.logoUrl} alt="" className="mx-auto max-h-14 object-contain grayscale" />
        </div>
      )}
      <div className="text-center text-base font-bold">{r.empresa.nombre}</div>
      {r.empresa.direccion && <div className="text-center">{r.empresa.direccion}</div>}
      {r.empresa.telefono && <div className="text-center">Tel: {r.empresa.telefono}</div>}
      <Sep char="=" />
      <div className="text-center font-bold">CUADRE DEL DÍA</div>
      <div className="text-center">Por empleado</div>
      <Sep />
      <Row label="Empleado" value={r.empleado} />
      <Row label="Fecha" value={fmtFecha(r.fecha, r.timeZone)} />
      <Sep />

      {r.estado === 'VACIO' ? (
        <div className="py-2 text-center">Sin cobros de este empleado este día.</div>
      ) : (
        <>
          <div className="font-bold">COBROS POR MÉTODO</div>
          <Row label="Efectivo" value={fmtRD(r.porMetodo.efectivo)} />
          <Row label="Transferencia" value={fmtRD(r.porMetodo.transferencia)} />
          <Row label="Otro" value={fmtRD(r.porMetodo.otro)} />
          <Row label={`TOTAL (${r.cobros} cobros)`} value={fmtRD(r.total)} bold />
          <Sep />

          <div className="font-bold">POR ORIGEN</div>
          <Row label={`En caja (${r.porOrigen.caja})`} value={fmtRD(r.porOrigen.cajaTotal)} />
          <Row label={`Panel/transf. (${r.porOrigen.panel})`} value={fmtRD(r.porOrigen.panelTotal)} />
          <Sep />

          {r.porTipo.length > 0 && (
            <>
              <div className="font-bold">POR TIPO DE OPERACIÓN</div>
              {r.porTipo.map((t) => (
                <Row key={t.tipo} label={`${t.label} (${t.cantidad})`} value={fmtRD(t.total)} />
              ))}
              <Sep />
            </>
          )}
        </>
      )}

      {r.enLinea.cantidad > 0 && (
        <>
          <div className="font-bold">COBROS EN LÍNEA (TARJETA)</div>
          <div className="text-[0.85em]">Pagados en la app o la web. NO pasan por la gaveta: no suman al efectivo.</div>
          {r.enLinea.items.map((i) => (
            <div key={i.ticketNumero} className="mt-1">
              <Row label={`${i.ticketNumero} · ${fmtHora(i.hora, r.timeZone)}`} value={fmtRD(i.monto)} />
              <div className="text-[0.85em]">{i.cliente} · {i.detalle} · {i.canal}</div>
            </div>
          ))}
          <Row label={`TOTAL EN LÍNEA (${r.enLinea.cantidad})`} value={fmtRD(r.enLinea.total)} bold />
          <Sep />
        </>
      )}

      <div className="text-center">Firma: _______________________</div>
      <div className="mt-2 text-center text-[0.85em]">Generado por MembeGo</div>
      <div style={{ height: '1.5em' }} />
    </div>
  )
}

export function ReporteDiaDialog({
  triggerLabel = 'Mi cuadre del día',
}: {
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [reporte, setReporte] = useState<ReporteEmpleadoDia | null>(null)
  const [cargando, setCargando] = useState(false)

  function abrir(siguiente: boolean) {
    setOpen(siguiente)
    if (!siguiente || reporte || cargando) return
    setCargando(true)
    obtenerReporteDia()
      .then((res) => {
        if (res.reporte) setReporte(res.reporte)
        else toast.error(res.error ?? 'No se pudo cargar el cuadre.')
      })
      .finally(() => setCargando(false))
  }

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mi cuadre del día</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto rounded-xl border border-border bg-muted/40 p-4">
          {cargando || !reporte ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando cuadre…
            </div>
          ) : (
            <ReportePreview r={reporte} />
          )}
        </div>

        <Button
          onClick={() => window.print()}
          disabled={!reporte}
          className="w-full gap-2 py-5 font-semibold"
        >
          <Printer className="h-4 w-4" /> Imprimir
        </Button>

        {reporte && (
          <div className="reporte-dia-print hidden" aria-hidden>
            <style>{`
              @media print {
                @page { margin: 0; }
                body * { visibility: hidden !important; }
                .reporte-dia-print, .reporte-dia-print * { visibility: visible !important; }
                .reporte-dia-print { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
              }
            `}</style>
            <ReportePreview r={reporte} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
