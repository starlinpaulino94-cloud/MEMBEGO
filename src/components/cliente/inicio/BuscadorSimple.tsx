'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

/**
 * Buscador simple del Home del cliente.
 * Redirige a /cliente/buscar con la query.
 */
export function BuscadorSimple() {
  const router = useRouter()
  const [q, setQ] = useState('')

  function buscar(e: React.FormEvent) {
    e.preventDefault()
    const limpio = q.trim()
    router.push(limpio ? `/cliente/buscar?q=${encodeURIComponent(limpio)}` : '/cliente/buscar')
  }

  function limpiar() {
    setQ('')
  }

  return (
    <section className="space-y-3" aria-label="Buscar ofertas y excursiones">
      <form onSubmit={buscar} role="search" className="relative">
        <div className="relative">
          {q && (
            <button
              type="button"
              onClick={() => { limpiar(); }}
              className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Limpiar búsqueda"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
          <svg
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar ofertas, excursiones, destinos…"
            aria-label="Buscar ofertas y excursiones"
            className="w-full h-12 rounded-xl border border-border bg-card pl-11 pr-12 text-base text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
            autoComplete="off"
          />
        </div>
      </form>
    </section>
  )
}