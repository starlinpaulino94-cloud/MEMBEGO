'use client'

/**
 * Reporte de cierre de caja (arqueo "Z") imprimible y reimprimible (Control de
 * comprobantes · Fase 2). Vista previa idéntica a la impresión: en pantalla el
 * contenido ocupa los 72 mm útiles de un rollo de 80 mm, y por `AreaDeImpresion`
 * sale exactamente así, en una sola página y fuera del diálogo (dentro de un
 * `DialogContent` —`position: fixed`— el reporte se repetía en cada página y el
 * `overflow` del diálogo lo recortaba por abajo).
 */

import { useState } from 'react'
import { Loader2, Printer } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ANCHO_IMPRIMIBLE_MM, AreaDeImpresion } from '@/components/impresion/AreaDeImpresion'
import { obtenerCierre } from '@/modules/caja/actions'
import type { CierreReporte } from '@/modules/caja/queries'

const fmtRD = (n: number) =>
  `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

function fmtFechaHora(d: Date | string | null, tz: string) {
  if (!d) return '—'
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(d))
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

/** `papel`: en pantalla, el rollo de 80 mm con sus márgenes; al imprimir, solo los 72 mm útiles (el área pone el ancho). */
function CierrePreview({ c, papel = true }: { c: CierreReporte; papel?: boolean }) {
  const dif = c.diferencia ?? 0
  const difLabel =
    c.diferencia == null
      ? '—'
      : dif === 0
        ? 'Cuadrada'
        : dif > 0
          ? `Sobrante ${fmtRD(dif)}`
          : `Faltante ${fmtRD(Math.abs(dif))}`
  return (
    <div
      className={papel ? 'mx-auto bg-white font-mono text-black shadow' : 'font-mono text-black'}
      style={papel
        ? { width: '80mm', fontSize: '12px', lineHeight: 1.5, padding: `3mm ${(80 - ANCHO_IMPRIMIBLE_MM[80]) / 2}mm` }
        : { fontSize: '12px', lineHeight: 1.5, padding: '3mm 0' }}
    >
      {c.empresa.logoUrl && (
        <div className="mb-1 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.empresa.logoUrl} alt="" className="mx-auto max-h-14 object-contain grayscale" />
        </div>
      )}
      <div className="text-center text-base font-bold">{c.empresa.nombre}</div>
      {c.empresa.direccion && <div className="text-center">{c.empresa.direccion}</div>}
      {c.empresa.telefono && <div className="text-center">Tel: {c.empresa.telefono}</div>}
      <Sep char="=" />
      <div className="text-center font-bold">CIERRE DE CAJA</div>
      <div className="text-center">Reporte de turno {c.estado === 'ABIERTA' ? '(preliminar)' : ''}</div>
      <Sep />
      <Row label="Sucursal" value={c.sucursal} />
      {c.turno && <Row label="Turno" value={c.turno} />}
      <Row label="Abrió" value={c.abiertaPor} />
      <Row label="Apertura" value={fmtFechaHora(c.abiertaAt, c.timeZone)} />
      {c.cerradaPor && <Row label="Cerró" value={c.cerradaPor} />}
      <Row label="Cierre" value={fmtFechaHora(c.cerradaAt, c.timeZone)} />
      <Sep />

      <div className="font-bold">COBROS POR MÉTODO</div>
      <Row label="Efectivo" value={fmtRD(c.porMetodo.efectivo)} />
      <Row label="Transferencia" value={fmtRD(c.porMetodo.transferencia)} />
      <Row label="Otro" value={fmtRD(c.porMetodo.otro)} />
      <Row label={`TOTAL (${c.cobros} cobros)`} value={fmtRD(c.total)} bold />
      <Sep />

      {c.porTipo.length > 0 && (
        <>
          <div className="font-bold">POR TIPO DE OPERACIÓN</div>
          {c.porTipo.map((t) => (
            <Row key={t.tipo} label={`${t.label} (${t.cantidad})`} value={fmtRD(t.total)} />
          ))}
          <Sep />
        </>
      )}

      {c.porEmpleado.length > 0 && (
        <>
          <div className="font-bold">POR EMPLEADO</div>
          {c.porEmpleado.map((e) => (
            <Row key={e.empleado} label={`${e.empleado} (${e.cantidad})`} value={fmtRD(e.total)} />
          ))}
          <Sep />
        </>
      )}

      {c.movimientos.length > 0 && (
        <>
          <div className="font-bold">MOVIMIENTOS DE EFECTIVO</div>
          {c.movimientos.map((m, i) => (
            <Row
              key={i}
              label={`${m.tipo === 'ENTRADA' ? '(+)' : '(−)'} ${m.concepto}`}
              value={fmtRD(m.monto)}
            />
          ))}
          <Row label="Entradas" value={fmtRD(c.movimientosEntrada)} />
          <Row label="Salidas" value={fmtRD(c.movimientosSalida)} />
          <Sep />
        </>
      )}

      {c.enLinea.cantidad > 0 && (
        <>
          <div className="font-bold">COBROS EN LÍNEA (TARJETA)</div>
          <div className="text-[0.85em]">Pagados en la app o la web durante el turno. NO pasan por la gaveta: no suman al efectivo ni al arqueo.</div>
          {c.enLinea.porCanal.map((x) => (
            <Row key={x.etiqueta} label={`${x.etiqueta} (${x.cantidad})`} value={fmtRD(x.total)} />
          ))}
          <Row label={`TOTAL EN LÍNEA (${c.enLinea.cantidad})`} value={fmtRD(c.enLinea.total)} bold />
          <Sep />
        </>
      )}

      <div className="font-bold">ARQUEO DE EFECTIVO</div>
      <Row label="Fondo inicial" value={fmtRD(c.balanceInicial)} />
      {(c.movimientosEntrada > 0 || c.movimientosSalida > 0) && (
        <Row label="Movim. netos" value={fmtRD(c.movimientosEntrada - c.movimientosSalida)} />
      )}
      <Row label="Efectivo esperado" value={c.balanceEsperado == null ? '—' : fmtRD(c.balanceEsperado)} />
      <Row label="Efectivo contado" value={c.balanceFinal == null ? '—' : fmtRD(c.balanceFinal)} />
      <Row label="Diferencia" value={difLabel} bold />
      {c.observaciones && (
        <>
          <Sep />
          <div className="font-bold">OBSERVACIONES</div>
          <div className="break-words">{c.observaciones}</div>
        </>
      )}
      <Sep char="=" />
      <div className="text-center">Firma: _______________________</div>
      <div className="mt-2 text-center text-[0.85em]">Generado por MembeGo</div>
      <div style={{ height: '1.5em' }} />
    </div>
  )
}

export function CierreCajaDialog({
  cajaSesionId,
  triggerLabel = 'Imprimir cierre',
}: {
  cajaSesionId: string
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [cierre, setCierre] = useState<CierreReporte | null>(null)
  const [cargando, setCargando] = useState(false)
  const [solicitud, setSolicitud] = useState(0)

  function abrir(siguiente: boolean) {
    setOpen(siguiente)
    if (!siguiente || cierre || cargando) return
    setCargando(true)
    obtenerCierre(cajaSesionId)
      .then((res) => {
        if (res.cierre) setCierre(res.cierre)
        else toast.error(res.error ?? 'No se pudo cargar el cierre.')
      })
      .finally(() => setCargando(false))
  }

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Printer className="h-3.5 w-3.5" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reporte de cierre de caja</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto rounded-xl border border-border bg-muted/40 p-4">
          {cargando || !cierre ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando cierre…
            </div>
          ) : (
            <CierrePreview c={cierre} />
          )}
        </div>

        <Button
          onClick={() => setSolicitud((s) => s + 1)}
          disabled={!cierre}
          className="w-full gap-2 py-5 font-semibold"
        >
          <Printer className="h-4 w-4" /> Imprimir
        </Button>

        {/* Lo que sale en el papel: fuera del diálogo y en una sola hoja. */}
        {cierre && (
          <AreaDeImpresion papel={80} solicitud={solicitud}>
            <CierrePreview c={cierre} papel={false} />
          </AreaDeImpresion>
        )}
      </DialogContent>
    </Dialog>
  )
}
