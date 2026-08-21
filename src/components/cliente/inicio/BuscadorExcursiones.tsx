'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, Compass } from 'lucide-react'
import { Input } from '@/components/ui/input'

/**
 * Buscador de excursiones en el Home del cliente.
 *
 * Funciona igual que el buscador de promociones pero para excursiones:
 * redirige a /excursiones con los filtros aplicados.
 */
export function BuscadorExcursiones() {
  const router = useRouter()
  const [q, setQ] = useState('')

  function buscar(e: React.FormEvent) {
    e.preventDefault()
    const limpio = q.trim()
    router.push(limpio ? `/excursiones?q=${encodeURIComponent(limpio)}` : '/excursiones')
  }

  return (
    <section className="space-y-3" aria-label="Buscar excursiones">
      <form onSubmit={buscar} role="search">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar excursiones por nombre, destino, categoría…"
            aria-label="Buscar excursiones"
            className="h-12 rounded-xl pl-11 text-base"
          />
        </div>
      </form>

      <div className="flex items-center gap-2">
        <Link
          href="/excursiones"
          className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-small font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted"
        >
          <Compass className="mr-2 h-4 w-4" />
          Ver todas las excursiones
        </Link>
      </div>
    </section>
  )
}