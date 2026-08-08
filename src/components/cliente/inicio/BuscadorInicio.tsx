'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

export interface CategoriaChip {
  slug: string
  nombre: string
}

/**
 * Buscador y categorías del Home del cliente.
 *
 * SOLO SE MONTA EN MODO MULTI-MARCA. En marca única no hay nada que buscar
 * —hay un negocio, y sus planes y ofertas ya están listados— y además
 * `/cliente/explorar` redirige a `/cliente/planes`, así que el buscador
 * llevaría a una pantalla que no responde a lo que se escribió. Un buscador
 * sin destino es peor que no tenerlo: promete algo que no cumple.
 *
 * Es cliente por el input controlado; las categorías van como enlaces para
 * que funcionen sin JavaScript y se puedan abrir en otra pestaña.
 */
export function BuscadorInicio({ categorias }: { categorias: CategoriaChip[] }) {
  const router = useRouter()
  const [q, setQ] = useState('')

  function buscar(e: React.FormEvent) {
    e.preventDefault()
    const limpio = q.trim()
    router.push(limpio ? `/cliente/explorar?q=${encodeURIComponent(limpio)}` : '/cliente/explorar')
  }

  return (
    <section className="space-y-3" aria-label="Buscar negocios y beneficios">
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
            placeholder="Buscar restaurantes, car wash, salones…"
            aria-label="Buscar negocios y beneficios"
            className="h-12 rounded-xl pl-11 text-base"
          />
        </div>
      </form>

      {categorias.length > 0 && (
        <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {categorias.map((c) => (
            <li key={c.slug} className="shrink-0">
              <Link
                href={`/cliente/explorar?category=${encodeURIComponent(c.slug)}`}
                className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-small font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted"
              >
                {c.nombre}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
