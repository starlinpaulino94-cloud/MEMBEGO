'use client'

import Image from 'next/image'
import { Check, Loader2, ShieldCheck, Ticket } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatMoney, formatPrice } from '@/lib/format'
import type { ExcursionOpcion, ResumenReserva as Importes } from '@/modules/excursiones/reservas/formulario'

/** El resumen que acompaña al formulario: qué se reserva, cuándo, para cuántos, cuánto cuesta y el botón de crear. */
export function ResumenReserva({
  excursion,
  variante,
  fecha,
  hora,
  adultos,
  ninos,
  importes,
  error,
  enviando,
}: {
  excursion: ExcursionOpcion
  variante: ExcursionOpcion['variantes'][number] | undefined
  /** La fecha de la reserva: la elegida o, en un combo por días separados, la de la primera actividad. */
  fecha: string
  hora: string
  adultos: number
  ninos: number
  importes: Importes | null
  /** El resumen del error de la acción (el de cada campo sale junto a su campo). */
  error?: string
  enviando: boolean
}) {
  const moneda = excursion.moneda
  return (
    <div className="w-full min-w-0 lg:col-span-1">
      <div className="sticky top-6 w-full min-w-0 space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
        <div className="w-full min-w-0 border-b border-border/60 pb-3">
          <span className="block truncate text-xs font-bold uppercase tracking-wider text-muted-foreground">Resumen de reserva</span>
          <h3 className="truncate text-base font-bold text-foreground sm:text-lg">{excursion.nombre}</h3>
        </div>

        <div className="flex w-full min-w-0 items-center gap-3">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted sm:h-16 sm:w-16">
            {excursion.portadaUrl ? (
              <Image src={excursion.portadaUrl} alt={excursion.nombre} fill className="object-cover" sizes="64px" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">Excursión</div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <span className="block truncate text-xs font-bold text-foreground">{variante?.nombre}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {fecha} {hora ? `· ${hora}` : ''}
            </span>
            <span className="block truncate text-xs font-semibold text-primary">
              {adultos} adulto(s){ninos > 0 ? ` · ${ninos} niño(s)` : ''}
            </span>
          </div>
        </div>

        {importes && (
          <div className="w-full min-w-0 space-y-2 rounded-xl bg-muted/40 p-3.5 text-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="truncate pr-2">
                {adultos} adulto(s) × {formatPrice(importes.precioAdulto, { moneda })}
              </span>
              <span className="shrink-0 font-mono font-medium text-foreground">{formatMoney(adultos * importes.precioAdulto, { moneda })}</span>
            </div>
            {ninos > 0 && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="truncate pr-2">
                  {ninos} niño(s) × {formatPrice(importes.precioNino ?? importes.precioAdulto, { moneda })}
                </span>
                <span className="shrink-0 font-mono font-medium text-foreground">
                  {formatMoney(ninos * (importes.precioNino ?? importes.precioAdulto), { moneda })}
                </span>
              </div>
            )}
            {importes.descuento > 0 && (
              <div className="flex items-center justify-between border-t border-border/50 pt-1.5 font-semibold text-success">
                <span>Descuento aplicado</span>
                <span className="shrink-0 font-mono">−{formatMoney(importes.descuento, { moneda })}</span>
              </div>
            )}
            {importes.impuestos > 0 && (
              <div className="flex items-center justify-between border-t border-border/50 pt-1.5 text-muted-foreground">
                <span>Impuestos ({excursion.impuestoPct}%)</span>
                <span className="shrink-0 font-mono font-medium text-foreground">{formatMoney(importes.impuestos, { moneda })}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-border/80 pt-2 text-sm font-bold text-foreground">
              <span>Total a reservar</span>
              <span className="shrink-0 font-mono text-base text-primary sm:text-lg">{formatMoney(importes.total, { moneda })}</span>
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          type="submit"
          disabled={enviando}
          className="h-12 w-full cursor-pointer gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-md transition-all hover:bg-primary/90 active:scale-[0.99]"
        >
          {enviando ? (
            <>
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              Procesando reserva…
            </>
          ) : (
            <>
              <Check className="h-4 w-4 shrink-0" aria-hidden />
              Crear reserva
            </>
          )}
        </Button>

        <div className="space-y-1.5 border-t border-border/60 pt-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            Garantía de cupo validada en tiempo real.
          </p>
          <p className="flex items-center gap-1.5">
            <Ticket className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            Genera código QR de check-in para embarque.
          </p>
        </div>
      </div>
    </div>
  )
}
