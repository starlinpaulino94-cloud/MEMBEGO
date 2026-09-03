'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Search, X, Filter } from 'lucide-react'
import {
  ESTADO_LIQUIDACION_LABEL,
  TONO_LIQUIDACION,
  type EstadoLiquidacion,
} from '@/modules/excursiones/liquidaciones/nucleo'
import { StatusChip } from '@/components/ui/status-chip'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatDate, formatMoney } from '@/lib/format'

export interface LiquidacionItem {
  id: string
  numero: string
  vendedorId: string
  vendedor: string
  vendedorCodigo: string | null
  periodoDesde: Date | string
  periodoHasta: Date | string
  total: number
  moneda: string
  estado: string
  pagadaAt: Date | string | null
  comisiones: number
}

export interface VendedorOpcion {
  id: string
  nombre: string
  codigo: string
}

const ESTADOS_FILTRO: { valor: string; label: string }[] = [
  { valor: 'TODOS', label: 'Todos los estados' },
  { valor: 'BORRADOR', label: 'Borradores' },
  { valor: 'APROBADA', label: 'Aprobadas' },
  { valor: 'PAGADA', label: 'Pagadas' },
  { valor: 'ANULADA', label: 'Anuladas' },
]

export function LiquidacionesLista({
  liquidaciones,
  vendedores,
  monedaDefecto,
}: {
  liquidaciones: LiquidacionItem[]
  vendedores: VendedorOpcion[]
  monedaDefecto: string
}) {
  const [busqueda, setBusqueda] = useState('')
  const [vendedorFiltro, setVendedorFiltro] = useState<string>('TODOS')
  const [estadoFiltro, setEstadoFiltro] = useState<string>('TODOS')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')

  const hayFiltrosActivos =
    busqueda.trim() !== '' ||
    vendedorFiltro !== 'TODOS' ||
    estadoFiltro !== 'TODOS' ||
    fechaDesde !== '' ||
    fechaHasta !== ''

  const limpiarFiltros = () => {
    setBusqueda('')
    setVendedorFiltro('TODOS')
    setEstadoFiltro('TODOS')
    setFechaDesde('')
    setFechaHasta('')
  }

  const filtradas = useMemo(() => {
    const q = busqueda.toLowerCase().trim()
    return liquidaciones.filter((l) => {
      // Filtro de vendedor
      if (vendedorFiltro !== 'TODOS' && l.vendedorId !== vendedorFiltro) {
        return false
      }
      // Filtro de estado
      if (estadoFiltro !== 'TODOS' && l.estado !== estadoFiltro) {
        return false
      }
      // Filtro por fecha desde (período desde)
      if (fechaDesde) {
        const d = new Date(`${fechaDesde}T00:00:00`)
        if (new Date(l.periodoDesde) < d) return false
      }
      // Filtro por fecha hasta (período hasta)
      if (fechaHasta) {
        const h = new Date(`${fechaHasta}T23:59:59.999`)
        if (new Date(l.periodoHasta) > h) return false
      }
      // Búsqueda de texto
      if (q) {
        const enNumero = l.numero.toLowerCase().includes(q)
        const enVendedor =
          l.vendedor.toLowerCase().includes(q) ||
          (l.vendedorCodigo ?? '').toLowerCase().includes(q)
        if (!enNumero && !enVendedor) {
          return false
        }
      }
      return true
    })
  }, [liquidaciones, busqueda, vendedorFiltro, estadoFiltro, fechaDesde, fechaHasta])

  return (
    <section className="space-y-4">
      {/* ── BARRA DE FILTROS & BÚSQUEDA ── */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Buscador libre */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar liquidaciones"
              placeholder="Buscar por número (#PAY-...) o vendedor…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Filtro por Vendedor */}
          <div className="w-full sm:w-auto min-w-[170px]">
            <select
              aria-label="Filtrar por vendedor"
              value={vendedorFiltro}
              onChange={(e) => setVendedorFiltro(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="TODOS">Todos los vendedores</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre} ({v.codigo})
                </option>
              ))}
            </select>
          </div>

          {/* Filtro por Estado */}
          <div className="w-full sm:w-auto min-w-[160px]">
            <select
              aria-label="Filtrar por estado"
              value={estadoFiltro}
              onChange={(e) => setEstadoFiltro(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {ESTADOS_FILTRO.map((ef) => (
                <option key={ef.valor} value={ef.valor}>
                  {ef.label}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Fecha Desde */}
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Desde:</span>
            <Input
              type="date"
              aria-label="Fecha desde del período"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="h-9 w-36 rounded-lg text-xs"
            />
          </div>

          {/* Filtro Fecha Hasta */}
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Hasta:</span>
            <Input
              type="date"
              aria-label="Fecha hasta del período"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="h-9 w-36 rounded-lg text-xs"
            />
          </div>

          {/* Botón para limpiar filtros */}
          {hayFiltrosActivos && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={limpiarFiltros}
              className="gap-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" /> Limpiar filtros
            </Button>
          )}
        </div>

        {/* Resumen de resultados filtrados */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
          <span>
            Mostrando <strong className="text-foreground">{filtradas.length}</strong> de{' '}
            {liquidaciones.length} liquidaciones
          </span>
          {hayFiltrosActivos && (
            <span className="flex items-center gap-1 font-medium text-primary">
              <Filter className="h-3 w-3" /> Filtros aplicados
            </span>
          )}
        </div>
      </div>

      {/* ── TABLA DE LIQUIDACIONES ── */}
      {filtradas.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-3">
          <p className="text-sm font-medium text-foreground">
            {hayFiltrosActivos
              ? 'Ninguna liquidación coincide con los filtros seleccionados.'
              : 'No hay liquidaciones registradas.'}
          </p>
          {hayFiltrosActivos && (
            <Button variant="outline" size="sm" onClick={limpiarFiltros}>
              Ver todas las liquidaciones
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-h3 text-foreground font-semibold">Historial de Liquidaciones</h2>
            <span className="text-xs text-muted-foreground">
              Consolidado en {monedaDefecto} · {filtradas.length} registro{filtradas.length === 1 ? '' : 's'}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Número</th>
                <th className="py-2 pr-3">Vendedor</th>
                <th className="py-2 pr-3">Período</th>
                <th className="py-2 pr-3">Comisiones</th>
                <th className="py-2 pr-3">Total ({monedaDefecto})</th>
                <th className="py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="py-2.5 pr-3">
                    <Link
                      href={`/admin/excursiones/liquidaciones/${l.id}`}
                      className="font-mono font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {l.numero}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-3">
                    <p className="text-foreground font-medium">{l.vendedor}</p>
                    {l.vendedorCodigo && (
                      <p className="font-mono text-caption text-muted-foreground">{l.vendedorCodigo}</p>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground">
                    {formatDate(l.periodoDesde)} → {formatDate(l.periodoHasta)}
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground">
                    {l.comisiones} comisi{l.comisiones === 1 ? 'ón' : 'ones'}
                  </td>
                  <td className="py-2.5 pr-3 text-foreground font-mono font-semibold">
                    {formatMoney(l.total, { moneda: monedaDefecto }, 2)}
                  </td>
                  <td className="py-2.5">
                    <StatusChip tone={TONO_LIQUIDACION[l.estado as EstadoLiquidacion] ?? 'neutral'}>
                      {ESTADO_LIQUIDACION_LABEL[l.estado as EstadoLiquidacion] ?? l.estado}
                    </StatusChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
