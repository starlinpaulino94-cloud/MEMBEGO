'use client'

import type { ReactNode } from 'react'
import { DollarSign } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { MONEDAS } from '@/modules/excursiones/catalogo/nucleo'
import type { SeccionProps } from './tipos'

const SELECT =
  'block h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:ring-2 focus:ring-primary aria-[invalid=true]:border-destructive'

function Moneda({ v, poner, className }: Pick<SeccionProps, 'v' | 'poner'> & { className?: string }) {
  return (
    <Campo id="exc-moneda" etiqueta="Moneda" className={className}>
      {(control) => (
        <select name="moneda" value={v.moneda} onChange={(e) => poner({ moneda: e.target.value })} className={SELECT} {...control}>
          {MONEDAS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
    </Campo>
  )
}

function Tarifa({
  titulo,
  detalle,
  etiqueta,
  insignia,
  tono,
  children,
}: {
  titulo: string
  detalle: string
  etiqueta: string
  insignia: string
  tono: 'principal' | 'opcional'
  children: ReactNode
}) {
  const principal = tono === 'principal'
  return (
    <div className={`space-y-3 rounded-xl border p-4 shadow-2xs ${principal ? 'border-border/80 bg-background/90' : 'border-success/20 bg-success/5'}`}>
      <div className={`flex items-center justify-between border-b pb-2 ${principal ? 'border-border/50' : 'border-success/20'}`}>
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden>
            {etiqueta}
          </span>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-foreground">{titulo}</h4>
            <p className="text-xs text-muted-foreground">{detalle}</p>
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${principal ? 'bg-primary/10 text-primary' : 'bg-success/15 text-success'}`}>{insignia}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}

/**
 * PRECIOS Y MONEDA. Al CREAR se pide el precio base, que nace como la variante «Estándar» (el combo ofrece la suma de sus
 * actividades y el ahorro); al EDITAR, los precios viven en el editor de variantes y aquí solo van la moneda y el impuesto.
 */
export function SeccionPrecios({
  v,
  poner,
  errores,
  editando,
  resumenCombo,
}: SeccionProps & {
  editando: boolean
  /** Solo en un combo al crear: lo que costarían las actividades por separado y cuánto ahorra el cliente. */
  resumenCombo?: { adulto: number; nino: number; ahorro: { ahorro: number; pct: number } | null } | null
}) {
  if (editando) {
    return (
      <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h3 className="text-base font-bold text-foreground">Moneda e impuestos</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Moneda v={v} poner={poner} />
          <Campo id="exc-impuesto" etiqueta="Impuesto (%)" opcional error={errores.impuestoPct}>
            {(control) => (
              <Input
                name="impuestoPct"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={v.impuestoPct}
                onChange={(e) => poner({ impuestoPct: e.target.value })}
                className="h-10 text-sm"
                {...control}
              />
            )}
          </Campo>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-2xl border border-primary/25 bg-primary/5 p-5 shadow-sm sm:p-6">
      {/* Al crear no hay impuesto que pedir: la excursión nace sin él. */}
      <input type="hidden" name="impuestoPct" value="" />
      <div>
        <h3 className="flex items-center gap-2 text-base font-bold text-foreground sm:text-lg">
          <DollarSign className="h-5 w-5 text-primary" aria-hidden />
          Precio base de la excursión (variante estándar)
        </h3>
        <p className="text-xs text-muted-foreground sm:text-sm">
          Podrás agregar más variantes de precio (VIP, niños, residentes) en cualquier momento desde el catálogo.
        </p>
      </div>

      {resumenCombo && resumenCombo.adulto > 0 ? (
        <div className="space-y-3 rounded-xl border border-primary/20 bg-background/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Suma individual de actividades</p>
              <p className="text-sm font-bold text-foreground">
                ${resumenCombo.adulto.toFixed(2)} por adulto{resumenCombo.nino > 0 ? ` • $${resumenCombo.nino.toFixed(2)} por niño` : ''}
              </p>
            </div>
            {resumenCombo.ahorro && resumenCombo.ahorro.ahorro > 0 ? (
              <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-bold text-success">
                Ahorro para el cliente: ${resumenCombo.ahorro.ahorro.toFixed(2)} ({resumenCombo.ahorro.pct}% de descuento)
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption font-medium text-muted-foreground">Sugerencias:</span>
            <button
              type="button"
              onClick={() =>
                poner({
                  precioAdulto: resumenCombo.adulto.toFixed(2),
                  ...(resumenCombo.nino > 0 ? { precioNino: resumenCombo.nino.toFixed(2) } : {}),
                })
              }
              className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground transition hover:bg-muted"
            >
              Copiar suma total (${resumenCombo.adulto.toFixed(2)})
            </button>
            <button
              type="button"
              onClick={() =>
                poner({
                  precioAdulto: (resumenCombo.adulto * 0.85).toFixed(2),
                  ...(resumenCombo.nino > 0 ? { precioNino: (resumenCombo.nino * 0.85).toFixed(2) } : {}),
                })
              }
              className="rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary transition hover:bg-primary/20"
            >
              Aplicar 15 % de descuento (${(resumenCombo.adulto * 0.85).toFixed(2)})
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Configuración de tarifas y moneda</span>
          <Moneda v={v} poner={poner} className="w-32" />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Tarifa titulo="Tarifa turistas / general" detalle="Boleto estándar internacional" etiqueta="🌍" insignia="Principal" tono="principal">
            <Campo id="exc-precio-adulto" etiqueta="Adulto" error={errores.precioAdulto}>
              {(control) => (
                <Input
                  name="precioAdulto"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="80.00"
                  value={v.precioAdulto}
                  onChange={(e) => poner({ precioAdulto: e.target.value })}
                  className="h-10 text-sm font-bold"
                  required
                  {...control}
                />
              )}
            </Campo>
            <Campo id="exc-precio-nino" etiqueta="Niño" opcional error={errores.precioNino}>
              {(control) => (
                <Input
                  name="precioNino"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="40.00"
                  value={v.precioNino}
                  onChange={(e) => poner({ precioNino: e.target.value })}
                  className="h-10 text-sm font-medium"
                  {...control}
                />
              )}
            </Campo>
          </Tarifa>

          <Tarifa titulo="Tarifa residentes / locales" detalle="Precio especial para locales" etiqueta="🇩🇴" insignia="Opcional" tono="opcional">
            <Campo id="exc-precio-residente" etiqueta="Adulto residente" opcional error={errores.precioResidente}>
              {(control) => (
                <Input
                  name="precioResidente"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="50.00"
                  value={v.precioResidente}
                  onChange={(e) => poner({ precioResidente: e.target.value })}
                  className="h-10 text-sm font-bold"
                  {...control}
                />
              )}
            </Campo>
            <Campo id="exc-precio-nino-residente" etiqueta="Niño residente" opcional error={errores.precioNinoResidente}>
              {(control) => (
                <Input
                  name="precioNinoResidente"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="25.00"
                  value={v.precioNinoResidente}
                  onChange={(e) => poner({ precioNinoResidente: e.target.value })}
                  className="h-10 text-sm font-medium"
                  {...control}
                />
              )}
            </Campo>
          </Tarifa>
        </div>
      </div>
    </div>
  )
}
