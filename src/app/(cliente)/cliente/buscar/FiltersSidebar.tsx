'use client'

import { useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Filter, X, ChevronDown, ChevronUp } from 'lucide-react'

export interface FiltersSidebarProps {
  categorias: string[]
  empresas: { id: string; slug: string; name: string; logoUrl?: string | null }[]
}

/**
 * Filtros avanzados del buscador (empresa, fechas, cupos). La categoría y
 * los cupos también viven como chips rápidos en la página; aquí están
 * completos para quien quiere afinar. Lenguaje retail: tarjeta a 8px,
 * rótulos en sobretítulo y estados de foco del sistema.
 */
export function FiltersSidebar({
  categorias = [],
  empresas = [],
}: FiltersSidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [mobileOpen, setMobileOpen] = useState(false)

  const activeCategoria = searchParams.get('cat') || ''
  const activeEmpresa = searchParams.get('emp') || ''
  const activeFechaDesde = searchParams.get('fd') || ''
  const activeFechaHasta = searchParams.get('fh') || ''
  const activeSoloConStock = searchParams.get('stock') === '1'

  const activeFiltersCount = [
    activeCategoria,
    activeEmpresa,
    activeFechaDesde,
    activeFechaHasta,
    activeSoloConStock ? 'stock' : '',
  ].filter(Boolean).length

  const hayFiltros = activeFiltersCount > 0

  const handleFilterChange = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    params.delete('p')
    router.push(`${pathname}?${params.toString()}`)
  }

  const handleClearFilters = () => {
    const q = searchParams.get('q')
    if (q) {
      router.push(`${pathname}?q=${encodeURIComponent(q)}`)
    } else {
      router.push(pathname)
    }
  }

  const filaOpcion =
    'flex cursor-pointer items-center gap-2.5 rounded-lg p-1.5 transition-colors duration-fast hover:bg-retail-mist'

  return (
    <div className="w-full">
      {/* Interruptor móvil */}
      <div className="mb-3 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3 elevation-1 outline-none transition-colors duration-fast hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="flex items-center gap-2 text-label-lg text-foreground">
            <Filter className="h-4 w-4 text-primary" aria-hidden />
            Filtros avanzados
            {hayFiltros && (
              <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-label-sm font-bold text-primary-foreground tabular-nums">
                {activeFiltersCount}
              </span>
            )}
          </span>
          {mobileOpen ? (
            <ChevronUp className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>

      {/* Panel (siempre visible en lg; plegable en móvil) */}
      <div
        className={`${
          mobileOpen ? 'block' : 'hidden'
        } sticky top-20 space-y-5 rounded-lg border border-border bg-card p-4 elevation-1 lg:block`}
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-h4 text-foreground">
            <Filter className="h-4 w-4 text-primary" aria-hidden />
            Filtros
          </h3>
          {hayFiltros && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="flex items-center gap-1 text-label-md font-semibold text-destructive hover:underline"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Limpiar todo
            </button>
          )}
        </div>

        {categorias.length > 0 && (
          <fieldset className="border-t border-border pt-4">
            <legend className="mb-2.5 text-overline">Categoría</legend>
            <div className="scrollbar-thin max-h-48 space-y-1.5 overflow-y-auto pr-1">
              <label className={filaOpcion}>
                <input
                  type="radio"
                  name="sidebar-cat"
                  value=""
                  checked={!activeCategoria}
                  onChange={() => handleFilterChange('cat', '')}
                  className="h-4 w-4 rounded-full border-input text-primary focus:ring-primary"
                />
                <span className="text-small font-medium">Todas</span>
              </label>
              {categorias.map((cat) => (
                <label key={cat} className={filaOpcion}>
                  <input
                    type="radio"
                    name="sidebar-cat"
                    value={cat}
                    checked={activeCategoria === cat}
                    onChange={() => handleFilterChange('cat', cat)}
                    className="h-4 w-4 rounded-full border-input text-primary focus:ring-primary"
                  />
                  <span className="text-small font-medium">{cat}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {empresas.length > 0 && (
          <fieldset className="border-t border-border pt-4">
            <legend className="mb-2.5 text-overline">Empresa</legend>
            <div className="scrollbar-thin max-h-48 space-y-1.5 overflow-y-auto pr-1">
              <label className={filaOpcion}>
                <input
                  type="radio"
                  name="sidebar-emp"
                  value=""
                  checked={!activeEmpresa}
                  onChange={() => handleFilterChange('emp', '')}
                  className="h-4 w-4 rounded-full border-input text-primary focus:ring-primary"
                />
                <span className="text-small font-medium">Todas</span>
              </label>
              {empresas.map((emp) => (
                <label key={emp.id} className={filaOpcion}>
                  <input
                    type="radio"
                    name="sidebar-emp"
                    value={emp.id}
                    checked={activeEmpresa === emp.id}
                    onChange={() => handleFilterChange('emp', emp.id)}
                    className="h-4 w-4 rounded-full border-input text-primary focus:ring-primary"
                  />
                  <span className="truncate text-small font-medium">{emp.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="border-t border-border pt-4">
          <legend className="mb-2.5 text-overline">Fechas</legend>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-caption">Desde</label>
              <input
                type="date"
                value={activeFechaDesde}
                onChange={(e) => handleFilterChange('fd', e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-small outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-caption">Hasta</label>
              <input
                type="date"
                value={activeFechaHasta}
                onChange={(e) => handleFilterChange('fh', e.target.value)}
                min={activeFechaDesde || new Date().toISOString().split('T')[0]}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-small outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="border-t border-border pt-4">
          <legend className="mb-2.5 text-overline">Disponibilidad</legend>
          <label className={filaOpcion}>
            <input
              type="checkbox"
              checked={activeSoloConStock}
              onChange={(e) => handleFilterChange('stock', e.target.checked ? '1' : '')}
              className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
            />
            <span className="text-small font-medium">Solo con cupos disponibles</span>
          </label>
        </fieldset>
      </div>
    </div>
  )
}
