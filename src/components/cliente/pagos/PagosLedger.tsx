'use client'

import { useState } from 'react'
import { CalendarClock, ExternalLink, FileText, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMoney, type RegionalPrefs } from '@/lib/format'
import type { PagoHistorialItem } from '@/modules/cliente/queries'
import { EmptyState } from '@/components/system/EmptyState'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

const TZ = 'America/Santo_Domingo'
const fmtFechaHora = (d: Date) =>
  new Intl.DateTimeFormat('es-DO', {
    timeZone: TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(d))

/**
 * Historial de pagos como extracto bancario digital (Revolut/Linear):
 * lista semántica ultra-limpia con micro-puntos de estado, método de pago,
 * montos en monoespaciada tabular y visor de comprobantes integrado en un
 * Sheet lateral (sin pestañas en blanco que rompan el flujo).
 */
export function PagosLedger({
  items,
  prefs,
}: {
  items: PagoHistorialItem[]
  prefs?: RegionalPrefs | null
}) {
  const [abierto, setAbierto] = useState<PagoHistorialItem | null>(null)

  if (items.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Sin historial"
        description="Aquí aparecerán tus pagos aprobados y rechazados."
      />
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
        <ul className="divide-y divide-border/40">
          {items.map((h) => (
            <LedgerRow key={h.id} item={h} prefs={prefs} onVer={() => setAbierto(h)} />
          ))}
        </ul>
      </div>

      <ReceiptDrawer
        item={abierto}
        prefs={prefs}
        onClose={() => setAbierto(null)}
      />
    </>
  )
}

/** Fila de transacción estilo extracto: punto semántico, datos y monto mono. */
function LedgerRow({
  item,
  prefs,
  onVer,
}: {
  item: PagoHistorialItem
  prefs?: RegionalPrefs | null
  onVer: () => void
}) {
  const aprobado = item.tipo === 'APROBADO'

  return (
    <li className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/30 sm:px-5">
      {/* Micro-punto de estado semántico */}
      <span
        aria-hidden
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          aprobado ? 'bg-success' : 'bg-destructive'
        )}
      />

      {/* Izquierda: qué pasó + cuándo */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">
          {aprobado ? 'Pago aprobado' : 'Pago rechazado'}
          {item.planNombre && (
            <span className="text-muted-foreground"> · {item.planNombre}</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {fmtFechaHora(item.fecha)}
          {item.motivo && <span className="italic"> · {item.motivo}</span>}
        </p>
      </div>

      {/* Centro: método de pago (abreviado) */}
      {item.metodoPagoNombre && (
        <span className="hidden max-w-[9rem] shrink-0 items-center gap-1.5 truncate text-xs text-muted-foreground sm:inline-flex">
          <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {item.metodoPagoNombre}
        </span>
      )}

      {/* Derecha: monto en mono tabular (alineación perfecta de dígitos) */}
      {item.monto != null && (
        <span
          className={cn(
            'shrink-0 font-mono text-sm font-semibold tabular-nums tracking-tight',
            aprobado ? 'text-foreground' : 'text-muted-foreground line-through'
          )}
        >
          {formatMoney(item.monto, prefs)}
        </span>
      )}

      {/* Ver detalles: siempre visible en móvil, se revela al hover en desktop */}
      <button
        type="button"
        onClick={onVer}
        className="shrink-0 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-all hover:bg-muted hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      >
        Ver
      </button>
    </li>
  )
}

/**
 * Visor integrado del recibo: Sheet lateral con el comprobante subido y los
 * detalles de la validación, sin abrir pestañas del navegador.
 */
function ReceiptDrawer({
  item,
  prefs,
  onClose,
}: {
  item: PagoHistorialItem | null
  prefs?: RegionalPrefs | null
  onClose: () => void
}) {
  const aprobado = item?.tipo === 'APROBADO'

  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'h-2 w-2 rounded-full',
                    aprobado ? 'bg-success' : 'bg-destructive'
                  )}
                />
                {aprobado ? 'Pago aprobado' : 'Pago rechazado'}
              </SheetTitle>
              <SheetDescription>
                {fmtFechaHora(item.fecha)}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-6 pb-6">
              {item.monto != null && (
                <p className="font-mono text-3xl font-bold tabular-nums tracking-tight text-foreground">
                  {formatMoney(item.monto, prefs)}
                </p>
              )}

              <dl className="space-y-2.5 border-y border-border/50 py-4 text-sm">
                {item.planNombre && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Plan</dt>
                    <dd className="font-medium text-foreground">{item.planNombre}</dd>
                  </div>
                )}
                {item.metodoPagoNombre && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Método de pago</dt>
                    <dd className="font-medium text-foreground">{item.metodoPagoNombre}</dd>
                  </div>
                )}
                {item.validadoPor && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Validado por</dt>
                    <dd className="font-medium text-foreground">{item.validadoPor}</dd>
                  </div>
                )}
                {item.motivo && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Motivo</dt>
                    <dd className="text-right font-medium text-destructive">{item.motivo}</dd>
                  </div>
                )}
              </dl>

              {item.comprobanteUrl ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Comprobante
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.comprobanteUrl}
                    alt="Comprobante de pago subido"
                    className="max-h-[50vh] w-full rounded-xl border border-border/60 object-contain"
                  />
                  <a
                    href={item.comprobanteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    Abrir original
                  </a>
                </div>
              ) : (
                <p className="flex items-center gap-2 rounded-xl bg-muted/40 px-3.5 py-3 text-xs text-muted-foreground">
                  <FileText className="h-4 w-4 shrink-0" aria-hidden />
                  Esta transacción no tiene comprobante adjunto.
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
