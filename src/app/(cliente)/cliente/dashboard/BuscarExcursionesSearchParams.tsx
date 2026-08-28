'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from '@/components/ui/select'
import { ExcursionSearchCard, type ExcursionBuscada } from './ExcursionSearchCard'
import { EmptyState } from '@/components/system/EmptyState'
import { } from '@/lib/format'

interface FiltrosBusqueda {
  query: string
  categoria: string
  empresa: string
  fechaDesde: string
  fechaHasta: string
  soloConStock: boolean
  pagina: number
}

export function SearchParams() {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  // Estado inicial desde URL
  const initialFiltros: FiltrosBusqueda = {
    query: searchParams.get('q') ?? '',
    categoria: searchParams.get('cat') ?? '',
    empresa: searchParams.get('emp') ?? '',
    fechaDesde: searchParams.get('fd') ?? '',
    fechaHasta: searchParams.get('fh') ?? '',
    soloConStock: searchParams.get('stock') === '1',
    pagina: parseInt(searchParams.get('p') ?? '1', 10) }

  const [filtros, setFiltros] = useState<FiltrosBusqueda>(initialFiltros)
  const [resultados, setResultados] = useState<{
    excursiones: ExcursionBuscada[]
    total: number
    pagina: number
    totalPaginas: number
    categorias: string[]
    empresas: { id: string; slug: string; name: string; logoUrl: string | null }[]
  } | null>(null)
  const [cargando, setCargando] = useState(false)
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)

  // Función para buscar
  const buscar = useCallback(async () => {
    setCargando(true)
    try {
      const params = new URLSearchParams()
      if (filtros.query) params.set('q', filtros.query)
      if (filtros.categoria) params.set('cat', filtros.categoria)
      if (filtros.empresa) params.set('emp', filtros.empresa)
      if (filtros.fechaDesde) params.set('fd', filtros.fechaDesde)
      if (filtros.fechaHasta) params.set('fh', filtros.fechaHasta)
      if (filtros.soloConStock) params.set('stock', '1')
      params.set('p', String(filtros.pagina))

      const res = await fetch(`/api/cliente/excursiones/buscar?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setResultados(data)
      }
    } catch (e) {
      console.error('Error buscando excursiones:', e)
    } finally {
      setCargando(false)
    }
  }, [filtros])

  // Ejecutar búsqueda al montar o cambiar filtros.
  //
  // La excepción a la regla es deliberada: `buscar` es una petición al
  // servidor, y su primer paso es encender el indicador de carga. Eso es un
  // setState síncrono dentro del efecto por definición — no hay forma de
  // pedir datos al montar sin él, y derivarlo no aplica porque el dato no
  // existe hasta que la red conteste.
   
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    buscar()
  }, [buscar])

  // Actualizar URL sin recargar
  const actualizarURL = () => {
    const params = new URLSearchParams()
    if (filtros.query) params.set('q', filtros.query)
    if (filtros.categoria) params.set('cat', filtros.categoria)
    if (filtros.empresa) params.set('emp', filtros.empresa)
    if (filtros.fechaDesde) params.set('fd', filtros.fechaDesde)
    if (filtros.fechaHasta) params.set('fh', filtros.fechaHasta)
    if (filtros.soloConStock) params.set('stock', '1')
    if (filtros.pagina > 1) params.set('p', String(filtros.pagina))
    router.replace(`/cliente/dashboard?tab=buscar&${params.toString()}`)
  }

  // Handlers
  const handleChange = (campo: keyof FiltrosBusqueda, valor: string | number | boolean) => {
    const nuevosFiltros = { ...filtros, [campo]: valor, pagina: 1 }
    setFiltros(nuevosFiltros)
    actualizarURL()
  }

  const limpiarFiltros = () => {
    const limpios: FiltrosBusqueda = {
      query: '',
      categoria: '',
      empresa: '',
      fechaDesde: '',
      fechaHasta: '',
      soloConStock: false,
      pagina: 1 }
    setFiltros(limpios)
    actualizarURL()
  }

  const hayFiltrosActivos = filtros.query || filtros.categoria || filtros.empresa || 
    filtros.fechaDesde || filtros.fechaHasta || filtros.soloConStock

  return (
    <div className="space-y-6">
      {/* Header con stats */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-h3 font-bold">Buscar excursiones</h2>
          <p className="text-sm text-muted-foreground">
            Encuentra tu proxima aventura filtrando por destino, fecha, categoria y mas
          </p>
        </div>
        {hayFiltrosActivos && (
          <Button variant="ghost" size="sm" onClick={limpiarFiltros}>
            <X className="mr-1 h-4 w-4" /> Limpiar filtros
          </Button>
        )}
      </div>

      {/* Barra de búsqueda principal */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Buscar excursiones"
            placeholder="Buscar por nombre, destino, categoria..."
            value={filtros.query}
            onChange={(e) => handleChange('query', e.target.value)}
            className="pl-10"
          />
        </div>
        <Button 
          variant="outline" 
          onClick={() => setFiltrosAbiertos(!filtrosAbiertos)}
          className="whitespace-nowrap"
        >
          <Filter className="mr-2 h-4 w-4" />
          Filtros {hayFiltrosActivos && <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-xs text-primary">3</span>}
        </Button>
      </div>

      {/* Filtros avanzados */}
      {filtrosAbiertos && (
        <div className="rounded-xl border bg-card p-4 space-y-4" style={{ animation: 'slideDown 0.2s ease-out' }}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-sm font-medium mb-1">Categoria</label>
              <Select value={filtros.categoria} onValueChange={(v) => handleChange('categoria', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todas las categorias</SelectItem>
                  {resultados?.categorias.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Empresa</label>
              <Select value={filtros.empresa} onValueChange={(v) => handleChange('empresa', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todas las empresas</SelectItem>
                  {resultados?.empresas.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Fecha desde</label>
              <Input
                aria-label="Fecha desde"
                type="date"
                value={filtros.fechaDesde}
                onChange={(e) => handleChange('fechaDesde', e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Fecha hasta</label>
              <Input
                aria-label="Fecha hasta"
                type="date"
                value={filtros.fechaHasta}
                onChange={(e) => handleChange('fechaHasta', e.target.value)}
                min={filtros.fechaDesde || new Date().toISOString().split('T')[0]}
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filtros.soloConStock}
                onChange={(e) => handleChange('soloConStock', e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-sm">Solo con cupos disponibles</span>
            </label>
          </div>
        </div>
      )}

      {/* Resultados */}
      <div className="space-y-4">
        {cargando ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="animate-pulse rounded-xl border bg-card p-4">
                <div className="h-40 w-full rounded-lg bg-muted" />
                <div className="mt-3 h-4 w-3/4 rounded bg-muted" />
                <div className="mt-2 h-4 w-1/2 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : !resultados ? (
          <EmptyState
            icon={Search}
            title="Error al cargar"
            description="No se pudieron cargar los resultados. Intenta de nuevo."
            action={
              <Button variant="outline" onClick={buscar}>Reintentar</Button>
            }
          />
        ) : resultados.excursiones.length === 0 ? (
          <EmptyState
            icon={Search}
            title={filtros.query ? 'Sin resultados' : 'No hay excursiones disponibles'}
            description={filtros.query 
              ? `No encontramos excursiones para "${filtros.query}". Intenta con otros terminos.`
              : 'Actualmente no hay excursiones publicadas con tus filtros.'
            }
            action={hayFiltrosActivos ? (
              <Button variant="outline" onClick={limpiarFiltros}>Limpiar filtros</Button>
            ) : undefined}
          />
        ) : (
          <>
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {resultados.excursiones.map((exc) => (
                <ExcursionSearchCard key={exc.id} excursion={exc} />
              ))}
            </div>

            {/* Paginación */}
            {resultados.totalPaginas > 1 && (
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resultados.pagina <= 1}
                  onClick={() => handleChange('pagina', resultados.pagina - 1)}
                >
                  Anterior
                </Button>
                <span className="text-sm text-muted-foreground">
                  Pagina {resultados.pagina} de {resultados.totalPaginas} ({resultados.total} resultados)
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resultados.pagina >= resultados.totalPaginas}
                  onClick={() => handleChange('pagina', resultados.pagina + 1)}
                >
                  Siguiente
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}