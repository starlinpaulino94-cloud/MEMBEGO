'use client'

import { useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Filter, X, ChevronDown, ChevronUp } from 'lucide-react'

export interface FiltersSidebarProps {
  categorias: string[]
  empresas: { id: string; slug: string; name: string; logoUrl?: string | null }[]
}

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

  return (
    <div className="w-full">
      {/* Mobile Toggle Button */}
      <div className="lg:hidden mb-4">
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-border bg-card text-foreground font-semibold shadow-sm active:bg-muted transition-colors"
        >
          <span className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-primary" />
            Filtros avanzados
            {hayFiltros && (
              <span className="ml-1 rounded-full bg-primary text-primary-foreground text-xs px-2 py-0.5 font-bold">
                {activeFiltersCount}
              </span>
            )}
          </span>
          {mobileOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Sidebar Content (Always visible on lg, toggled on mobile) */}
      <div
        className={`${
          mobileOpen ? 'block' : 'hidden'
        } lg:block sticky top-20 space-y-6 p-4 sm:p-5 rounded-2xl border border-border bg-card shadow-sm`}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-foreground text-sm sm:text-base flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            Filtros
          </h3>
          {hayFiltros && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="text-xs font-semibold text-destructive hover:underline flex items-center gap-1"
            >
              <X className="h-3.5 w-3.5" /> Limpiar todo
            </button>
          )}
        </div>

        {categorias.length > 0 && (
          <fieldset className="border-t border-border/60 pt-4">
            <legend className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Categoría
            </legend>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
              <label className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="sidebar-cat"
                  value=""
                  checked={!activeCategoria}
                  onChange={() => handleFilterChange('cat', '')}
                  className="h-4 w-4 rounded-full border-input text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium">Todas</span>
              </label>
              {categorias.map((cat) => (
                <label
                  key={cat}
                  className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <input
                    type="radio"
                    name="sidebar-cat"
                    value={cat}
                    checked={activeCategoria === cat}
                    onChange={() => handleFilterChange('cat', cat)}
                    className="h-4 w-4 rounded-full border-input text-primary focus:ring-primary"
                  />
                  <span className="text-sm font-medium">{cat}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {empresas.length > 0 && (
          <fieldset className="border-t border-border/60 pt-4">
            <legend className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Empresa
            </legend>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
              <label className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="sidebar-emp"
                  value=""
                  checked={!activeEmpresa}
                  onChange={() => handleFilterChange('emp', '')}
                  className="h-4 w-4 rounded-full border-input text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium">Todas</span>
              </label>
              {empresas.map((emp) => (
                <label
                  key={emp.id}
                  className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <input
                    type="radio"
                    name="sidebar-emp"
                    value={emp.id}
                    checked={activeEmpresa === emp.id}
                    onChange={() => handleFilterChange('emp', emp.id)}
                    className="h-4 w-4 rounded-full border-input text-primary focus:ring-primary"
                  />
                  <span className="text-sm font-medium truncate">{emp.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="border-t border-border/60 pt-4">
          <legend className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Fechas
          </legend>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Desde</label>
              <input
                type="date"
                value={activeFechaDesde}
                onChange={(e) => handleFilterChange('fd', e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full h-11 rounded-xl border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Hasta</label>
              <input
                type="date"
                value={activeFechaHasta}
                onChange={(e) => handleFilterChange('fh', e.target.value)}
                min={activeFechaDesde || new Date().toISOString().split('T')[0]}
                className="w-full h-11 rounded-xl border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="border-t border-border/60 pt-4">
          <legend className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Disponibilidad
          </legend>
          <label className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={activeSoloConStock}
              onChange={(e) => handleFilterChange('stock', e.target.checked ? '1' : '')}
              className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
            />
            <span className="text-sm font-medium">Solo con cupos disponibles</span>
          </label>
        </fieldset>
      </div>
    </div>
  )
}
