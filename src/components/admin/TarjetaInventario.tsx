import Link from 'next/link'
import { Warehouse } from 'lucide-react'
import { formatMoney } from '@/lib/format'
import { costoADecimal, type Costo } from '@/modules/inventory/costos'
import type { ResumenInventario } from '@/modules/inventory/dashboard'
import { formatearPorcentaje } from '@/modules/inventory/margen'

const CERO: Costo = BigInt(0)
const fmt = (n: number) => new Intl.NumberFormat('es-DO').format(n)

/** Un costo (en diezmilésimas, quizá negativo) a número, para darle formato de moneda. */
function aNumero(c: Costo): number {
  return (c < CERO ? -1 : 1) * Number(costoADecimal(c < CERO ? -c : c))
}

const TILE = 'rounded-lg border border-border p-3 transition hover:bg-muted/40'

/**
 * La tarjeta de INVENTARIO del dashboard (INV-4c): cuánto hay y cuánto vale, cuánto se ganó este mes y cuánto se perdió. Es la misma
 * cuenta de los informes (Valor, Margen real y Mermas), no una estimación aparte, y cada cifra lleva a su informe.
 *
 * EL DINERO SOLO CON LA FUNCIÓN `costos`: sin ella (`resumen.conCostos` en falso) la tarjeta enseña unidades y nada más, ni el valor,
 * ni el margen, ni lo que costó lo perdido.
 */
export function TarjetaInventario({ resumen, company }: { resumen: ResumenInventario; company: { moneda?: string | null; idioma?: string | null } | null }) {
  const dinero = (c: Costo) => formatMoney(aNumero(c), company)
  const m = resumen.margen
  return (
    <section aria-labelledby="inventario-resumen" className="rounded-xl border border-border bg-card p-4 elevation-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="inventario-resumen" className="flex items-center gap-2 text-label-lg text-foreground">
          <Warehouse className="size-4 text-primary" aria-hidden /> Inventario
        </h2>
        <Link href="/admin/inventario/reportes" className="text-caption underline-offset-2 hover:underline">
          Ver reportes
        </Link>
      </div>
      <dl className={`mt-3 grid gap-3 ${resumen.conCostos ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {resumen.conCostos && resumen.valor !== null ? (
          <Link href="/admin/inventario/valor" className={TILE}>
            <dt className="text-caption">Valor del inventario</dt>
            <dd className="text-h3 tabular-nums text-foreground">{dinero(resumen.valor)}</dd>
            <p className="text-label-sm text-muted-foreground">
              {fmt(resumen.unidadesEnExistencia)} unidad{resumen.unidadesEnExistencia === 1 ? '' : 'es'}
              {(resumen.unidadesSinCosto ?? 0) > 0 ? ` · ${fmt(resumen.unidadesSinCosto ?? 0)} sin costo` : ''}
            </p>
          </Link>
        ) : (
          <Link href="/admin/inventario" className={TILE}>
            <dt className="text-caption">Unidades en existencia</dt>
            <dd className="text-h3 tabular-nums text-foreground">{fmt(resumen.unidadesEnExistencia)}</dd>
            <p className="text-label-sm text-muted-foreground">En todas tus sucursales</p>
          </Link>
        )}
        {resumen.conCostos && m !== null ? (
          <Link href="/admin/inventario/reportes/margen" className={TILE}>
            <dt className="text-caption">Margen del mes</dt>
            <dd className={`text-h3 tabular-nums ${m.margen < CERO ? 'text-destructive' : 'text-foreground'}`}>{m.productos === 0 ? '—' : dinero(m.margen)}</dd>
            <p className="text-label-sm text-muted-foreground">
              {m.productos === 0
                ? 'Sin ventas este mes'
                : `${m.margenPct === null ? 'Sin base para el porcentaje' : formatearPorcentaje(m.margenPct)} · ${fmt(m.unidades)} unidad${m.unidades === 1 ? '' : 'es'} vendida${m.unidades === 1 ? '' : 's'}`}
              {m.unidadesSinCosto > 0 ? ` · ${fmt(m.unidadesSinCosto)} sin costo no entran` : ''}
            </p>
          </Link>
        ) : null}
        <Link href="/admin/inventario/reportes/mermas" className={`${TILE} ${resumen.perdido.unidades > 0 ? 'border-warning/50 bg-warning/5' : ''}`}>
          <dt className="text-caption">Perdido este mes</dt>
          <dd className="text-h3 tabular-nums text-foreground">
            {fmt(resumen.perdido.unidades)} <span className="text-small text-muted-foreground">unidad{resumen.perdido.unidades === 1 ? '' : 'es'}</span>
          </dd>
          <p className="text-label-sm text-muted-foreground">
            {resumen.perdido.unidades === 0
              ? 'Sin faltantes ni bajas'
              : `${fmt(resumen.perdido.movimientos)} movimiento${resumen.perdido.movimientos === 1 ? '' : 's'}${resumen.conCostos && resumen.perdido.valor !== null ? ` · ${dinero(resumen.perdido.valor)}` : ''}`}
          </p>
        </Link>
      </dl>
    </section>
  )
}
