'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Search, X, Filter, Calendar } from 'lucide-react'
import {
  ESTADO_COMISION_LABEL,
  TONO_COMISION,
  type EstadoComision,
} from '@/modules/excursiones/comisiones/nucleo'
import { ComisionAcciones } from '@/components/excursiones/ComisionAcciones'
import {
  ComisionDetalleSheet,
  type ComisionDetalleItem,
} from '@/components/excursiones/ComisionDetalleSheet'
import { StatusChip } from '@/components/ui/status-chip'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatDate, formatMoney } from '@/lib/format'

export type ComisionRow = ComisionDetalleItem

export type VendedorOpcion = {
  id: string
  nombre: string
  codigo: string
}

const ESTADOS_FILTRO: { valor: string; label: string }[] = [
  { valor: 'TODOS', label: 'Todos los estados' },
  { valor: 'GENERADA', label: 'Generadas' },
  { valor: 'APROBADA', label: 'Aprobadas' },
  { valor: 'PENDIENTE_PAGO', label: 'Pendientes de pago' },
  { valor: 'PAGADA', label: 'Pagadas' },
  { valor: 'ANULADA', label: 'Anuladas' },
]

const TASAS_FILTRO: { valor: string; label: string }[] = [
  { valor: 'TODOS', label: 'Todas las comisiones' },
  { valor: 'CON_CONVERSION', label: 'Con conversión de tasa predeterminada' },
  { valor: 'REGLA_GENERAL', label: 'Regla general predeterminada' },
]

export function ComisionesLista({
  comisiones,
  vendedores,
  monedaDefecto,
}: {
  comisiones: ComisionRow[]
  vendedores: VendedorOpcion[]
  monedaDefecto: string
}) {
  const [busqueda, setBusqueda] = useState('')
  const [vendedorFiltro, setVendedorFiltro] = useState<string>('TODOS')
  const [estadoFiltro, setEstadoFiltro] = useState<string>('TODOS')
  const [tasaFiltro, setTasaFiltro] = useState<string>('TODOS')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [comisionSeleccionada, setComisionSeleccionada] = useState<ComisionRow | null>(null)
  const [sheetAbierto, setSheetAbierto] = useState(false)

  const hayFiltrosActivos =
    busqueda.trim() !== '' ||
    vendedorFiltro !== 'TODOS' ||
    estadoFiltro !== 'TODOS' ||
    tasaFiltro !== 'TODOS' ||
    fechaDesde !== '' ||
    fechaHasta !== ''

  const handleVendedorChange = (id: string) => {
    setVendedorFiltro(id)
    if (id === 'TODOS') {
      setFechaDesde('')
      setFechaHasta('')
      return
    }

    // Auto-asignar rango de fechas: desde la comisión aprobada más vieja hasta la más reciente
    const aprobadasVendedor = comisiones.filter(
      (c) => c.vendedorId === id && c.estado === 'APROBADA'
    )
    if (aprobadasVendedor.length > 0) {
      const timestamps = aprobadasVendedor.map((c) => new Date(c.createdAt).getTime())
      const minDate = new Date(Math.min(...timestamps))
      const maxDate = new Date(Math.max(...timestamps))
      setFechaDesde(minDate.toISOString().slice(0, 10))
      setFechaHasta(maxDate.toISOString().slice(0, 10))
    }
  }

  const limpiarFiltros = () => {
    setBusqueda('')
    setVendedorFiltro('TODOS')
    setEstadoFiltro('TODOS')
    setTasaFiltro('TODOS')
    setFechaDesde('')
    setFechaHasta('')
  }

  const filtradas = useMemo(() => {
    const q = busqueda.toLowerCase().trim()
    return comisiones.filter((c) => {
      // Filtro de vendedor
      if (vendedorFiltro !== 'TODOS' && c.vendedorId !== vendedorFiltro) {
        return false
      }
      // Filtro de estado
      if (estadoFiltro !== 'TODOS' && c.estado !== estadoFiltro) {
        return false
      }
      // Filtro por tasa / regla
      if (tasaFiltro === 'CON_CONVERSION' && !c.conversion?.esConversion) {
        return false
      }
      if (tasaFiltro === 'REGLA_GENERAL' && !c.esReglaPredeterminada) {
        return false
      }
      // Filtro por fecha desde
      if (fechaDesde) {
        const d = new Date(`${fechaDesde}T00:00:00`)
        if (new Date(c.createdAt) < d) return false
      }
      // Filtro por fecha hasta
      if (fechaHasta) {
        const h = new Date(`${fechaHasta}T23:59:59.999`)
        if (new Date(c.createdAt) > h) return false
      }
      // Búsqueda de texto
      if (q) {
        const enVendedor =
          c.vendedor.toLowerCase().includes(q) ||
          (c.vendedorCodigo ?? '').toLowerCase().includes(q)
        const enVenta = c.venta?.numero.toLowerCase().includes(q) ?? false
        const enLiquidacion = c.liquidacion?.numero.toLowerCase().includes(q) ?? false
        const enDesglose = c.desglose.toLowerCase().includes(q)
        if (!enVendedor && !enVenta && !enLiquidacion && !enDesglose) {
          return false
        }
      }
      return true
    })
  }, [comisiones, busqueda, vendedorFiltro, estadoFiltro, tasaFiltro, fechaDesde, fechaHasta])

  return (
    <div className="space-y-4">
      {/* ── BARRA DE FILTROS & BÚSQUEDA ── */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Buscador libre */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar comisiones"
              placeholder="Buscar por vendedor, venta (#SAL-...) o liquidación…"
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
              onChange={(e) => handleVendedorChange(e.target.value)}
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

          {/* Filtro por Tasa Predeterminada */}
          <div className="w-full sm:w-auto min-w-[170px]">
            <select
              aria-label="Filtrar por tasa predeterminada"
              value={tasaFiltro}
              onChange={(e) => setTasaFiltro(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {TASAS_FILTRO.map((tf) => (
                <option key={tf.valor} value={tf.valor}>
                  {tf.label}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Fecha Desde */}
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Desde:</span>
            <Input
              type="date"
              aria-label="Fecha desde"
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
              aria-label="Fecha hasta"
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
            {comisiones.length} comisiones
          </span>
          {hayFiltrosActivos && (
            <span className="flex items-center gap-1 font-medium text-primary">
              <Filter className="h-3 w-3" /> Filtros aplicados
            </span>
          )}
        </div>
      </div>

      {/* ── TABLA DE COMISIONES ── */}
      {filtradas.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-3">
          <p className="text-sm font-medium text-foreground">
            {hayFiltrosActivos
              ? 'Ninguna comisión coincide con los filtros seleccionados.'
              : 'No hay comisiones registradas.'}
          </p>
          {hayFiltrosActivos && (
            <Button variant="outline" size="sm" onClick={limpiarFiltros}>
              Ver todas las comisiones
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-caption uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Vendedor</th>
                <th className="px-4 py-3">Venta / Fecha</th>
                <th className="px-4 py-3">Cálculo & Desglose</th>
                <th className="px-4 py-3 text-right">Neto</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtradas.map((c) => (
                <tr key={c.id} className="hover:bg-muted/20 transition-colors align-top">
                  {/* Vendedor */}
                  <td className="px-4 py-3">
                    <p className="font-semibold text-foreground">
                      <Link
                        href={`/admin/excursiones/vendedores/${c.vendedorId}`}
                        className="hover:text-primary hover:underline"
                      >
                        {c.vendedor}
                      </Link>
                    </p>
                    {c.vendedorCodigo ? (
                      <p className="font-mono text-caption text-muted-foreground">
                        {c.vendedorCodigo}
                      </p>
                    ) : null}
                  </td>

                  {/* Venta & Fecha */}
                  <td className="px-4 py-3">
                    {c.venta ? (
                      <Link
                        href={`/admin/excursiones/ventas/${c.venta.id}`}
                        className="font-mono font-semibold text-foreground underline-offset-2 hover:underline hover:text-primary"
                      >
                        {c.venta.numero}
                      </Link>
                    ) : (
                      <span className="font-mono text-muted-foreground">—</span>
                    )}
                    <p className="text-caption text-muted-foreground">{formatDate(c.createdAt)}</p>
                    {c.liquidacion && (
                      <p className="mt-0.5">
                        <Link
                          href={`/admin/excursiones/liquidaciones/${c.liquidacion.id}`}
                          className="font-mono text-caption text-primary hover:underline"
                        >
                          Liq: {c.liquidacion.numero}
                        </Link>
                      </p>
                    )}
                  </td>

                  {/* Cálculo & Desglose */}
                  <td className="px-4 py-3 max-w-md">
                    <p className="text-sm text-foreground">{c.desglose}</p>
                    {c.esReglaPredeterminada && (
                      <span className="mt-1 inline-block text-xs font-medium bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded-lg">
                        Regla general predeterminada
                      </span>
                    )}
                    {c.ajustes.length > 0 ? (
                      <ul className="mt-1.5 space-y-0.5 border-t border-border/60 pt-1">
                        {c.ajustes.map((a, i) => (
                          <li key={i} className="text-caption text-muted-foreground">
                            Ajuste {a.monto > 0 ? '+' : ''}
                            {formatMoney(a.monto, { moneda: c.moneda }, 2)} · {a.motivo}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>

                  {/* Neto / Monto */}
                  <td className="px-4 py-3 text-right">
                    <p className="font-mono font-bold text-foreground">
                      {formatMoney(c.neto, { moneda: c.moneda }, 2)}
                    </p>
                  </td>

                  {/* Estado */}
                  <td className="px-4 py-3 text-center">
                    <StatusChip tone={TONO_COMISION[c.estado as EstadoComision] ?? 'neutral'}>
                      {ESTADO_COMISION_LABEL[c.estado as EstadoComision] ?? c.estado}
                    </StatusChip>
                  </td>

                  {/* Acciones */}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setComisionSeleccionada(c)
                          setSheetAbierto(true)
                        }}
                      >
                        Ver detalle
                      </Button>
                      <ComisionAcciones
                        comisionId={c.id}
                        estado={c.estado as EstadoComision}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer Lateral de Detalle y Gestión de Estados */}
      <ComisionDetalleSheet
        comision={comisionSeleccionada}
        open={sheetAbierto}
        onOpenChange={setSheetAbierto}
      />
    </div>
  )
}
