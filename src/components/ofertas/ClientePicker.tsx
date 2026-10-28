'use client'

import { useMemo, useState } from 'react'
import { Check, Search, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ClienteOption {
  id: string
  nombre: string
  email: string
  telefono: string | null
}

/**
 * Selector de la lista cerrada de invitados: búsqueda + selección múltiple.
 * Cada seleccionado es un <input hidden name="clienteIds"> real, así la lista
 * viaja en el FormData del server action sin lógica extra.
 */
export function ClientePicker({ clientes }: { clientes: ClienteOption[] }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())

  const filtrados = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return clientes
    return clientes.filter(
      (c) =>
        c.nombre.toLowerCase().includes(term) ||
        c.email.toLowerCase().includes(term) ||
        (c.telefono ?? '').includes(term)
    )
  }, [clientes, q])

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function seleccionarFiltrados() {
    setSel((prev) => new Set([...prev, ...filtrados.map((c) => c.id)]))
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 p-3">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar cliente por nombre, correo o teléfono"
            placeholder="Buscar por nombre, correo o teléfono…"
            className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <button
          type="button"
          onClick={seleccionarFiltrados}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted"
        >
          Seleccionar visibles
        </button>
        <button
          type="button"
          onClick={() => setSel(new Set())}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted"
        >
          Limpiar
        </button>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          <Users className="h-3.5 w-3.5" /> {sel.size} seleccionados
        </span>
      </div>

      <div className="max-h-72 divide-y divide-border/40 overflow-y-auto">
        {filtrados.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Sin resultados.</p>
        ) : (
          filtrados.map((c) => {
            const activo = sel.has(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                aria-pressed={activo}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition',
                  activo ? 'bg-primary/5' : 'hover:bg-muted/40'
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{c.nombre}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.email}
                    {c.telefono ? ` · ${c.telefono}` : ''}
                  </span>
                </span>
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition',
                    activo
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border'
                  )}
                >
                  {activo && <Check className="h-3 w-3" />}
                </span>
              </button>
            )
          })
        )}
      </div>

      {/* Los seleccionados viajan en el form padre */}
      {[...sel].map((id) => (
        <input key={id} type="hidden" name="clienteIds" value={id} />
      ))}
    </div>
  )
}
