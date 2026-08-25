'use client'

import { useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search, Filter, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/format'
import { ETAPA_ATRIBUCION_LABEL, type EtapaAtribucion } from '@/modules/excursiones/atribucion/nucleo'

export interface ClienteCaptadoItem {
  id: string
  nombre: string
  telefono: string | null
  email?: string | null
  etapa: string
  canal: string | null
  createdAt: Date | string
}

export function ClientesCaptadosTabla({
  items,
  total,
  totalPages,
  currentPage,
}: {
  items: ClienteCaptadoItem[]
  total: number
  totalPages: number
  currentPage: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [q, setQ] = useState(searchParams.get('q') ?? '')
  const [etapa, setEtapa] = useState(searchParams.get('etapa') ?? 'TODAS')
  const [canal, setCanal] = useState(searchParams.get('canal') ?? 'TODOS')
  const [desde, setDesde] = useState(searchParams.get('desde') ?? '')
  const [hasta, setHasta] = useState(searchParams.get('hasta') ?? '')

  const aplicarFiltros = (newPage = 1) => {
    const params = new URLSearchParams(searchParams.toString())
    if (q.trim()) params.set('q', q.trim())
    else params.delete('q')

    if (etapa && etapa !== 'TODAS') params.set('etapa', etapa)
    else params.delete('etapa')

    if (canal && canal !== 'TODOS') params.set('canal', canal)
    else params.delete('canal')

    if (desde) params.set('desde', desde)
    else params.delete('desde')

    if (hasta) params.set('hasta', hasta)
    else params.delete('hasta')

    if (newPage > 1) params.set('page', String(newPage))
    else params.delete('page')

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  const limpiarFiltros = () => {
    setQ('')
    setEtapa('TODAS')
    setCanal('TODOS')
    setDesde('')
    setHasta('')
    startTransition(() => {
      router.push(pathname)
    })
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h3 text-foreground">Clientes captados</h2>
          <p className="text-caption text-muted-foreground">
            {total} {total === 1 ? 'registro encontrado' : 'registros encontrados'} en el embudo
          </p>
        </div>
        {(q || etapa !== 'TODAS' || canal !== 'TODOS' || desde || hasta) && (
          <Button variant="ghost" size="sm" onClick={limpiarFiltros} className="text-xs text-muted-foreground hover:text-foreground">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Limpiar filtros
          </Button>
        )}
      </div>

      {/* Barra de Filtros */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente, teléfono o correo..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && aplicarFiltros(1)}
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div>
          <select
            value={etapa}
            onChange={(e) => {
              setEtapa(e.target.value)
            }}
            className="w-full h-9 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          >
            <option value="TODAS">Todas las etapas</option>
            <option value="VISITA">Visita</option>
            <option value="REGISTRO">Registro</option>
            <option value="RESERVA">Reserva</option>
            <option value="COMPRA">Compra</option>
          </select>
        </div>

        <div>
          <select
            value={canal}
            onChange={(e) => {
              setCanal(e.target.value)
            }}
            className="w-full h-9 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          >
            <option value="TODOS">Todos los canales</option>
            <option value="QR">Código QR</option>
            <option value="ENLACE">Enlace Web / Directo</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={() => aplicarFiltros(1)}
            disabled={isPending}
            className="w-full h-9 text-xs"
          >
            <Filter className="mr-1.5 h-3.5 w-3.5" /> Filtrar
          </Button>
        </div>
      </div>

      {/* Rango de Fechas Opcional */}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <span className="text-xs text-muted-foreground">Desde:</span>
        <Input
          type="date"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          className="h-8 w-36 text-xs"
        />
        <span className="text-xs text-muted-foreground">Hasta:</span>
        <Input
          type="date"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
          className="h-8 w-36 text-xs"
        />
      </div>

      {/* Tabla de Resultados */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No se encontraron clientes captados con los filtros seleccionados.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                <th className="py-2.5 pr-3 font-semibold">Cliente</th>
                <th className="py-2.5 pr-3 font-semibold">Teléfono / Email</th>
                <th className="py-2.5 pr-3 font-semibold">Etapa del Embudo</th>
                <th className="py-2.5 pr-3 font-semibold">Canal</th>
                <th className="py-2.5 font-semibold text-right">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30 transition">
                  <td className="py-2.5 pr-3 font-medium text-foreground">{c.nombre}</td>
                  <td className="py-2.5 pr-3 text-muted-foreground text-xs font-mono">
                    {c.telefono ?? c.email ?? '—'}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                      {ETAPA_ATRIBUCION_LABEL[c.etapa as EtapaAtribucion] ?? c.etapa}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                    {c.canal === 'QR' ? '📱 QR' : '🔗 Enlace Directo'}
                  </td>
                  <td className="py-2.5 text-right text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateTime(new Date(c.createdAt))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-caption text-muted-foreground">
            Página {currentPage} de {totalPages} ({total} clientes)
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => aplicarFiltros(currentPage - 1)}
              disabled={currentPage <= 1 || isPending}
              className="h-8 px-2.5 text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => aplicarFiltros(currentPage + 1)}
              disabled={currentPage >= totalPages || isPending}
              className="h-8 px-2.5 text-xs"
            >
              Siguiente <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
