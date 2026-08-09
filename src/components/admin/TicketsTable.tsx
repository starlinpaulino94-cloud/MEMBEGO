'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, Ticket as TicketIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { TabsNav } from '@/components/ui/tabs-nav'
import {
  COLAS_TICKET,
  COLA_LABEL,
  colaDeEstado,
  estadoLabel,
  estadoBadgeClass,
  categoriaLabel,
  type ColaTicket,
} from '@/lib/soporte'

export interface TicketRow {
  id: string
  asunto: string
  estado: string
  categoria: string
  clienteNombre: string
  empresaNombre: string
  mensajes: number
  actualizado: string
  showEmpresa: boolean
}

const COLAS = Object.keys(COLAS_TICKET) as ColaTicket[]

/** Qué decir cuando una cola está vacía: no todas significan lo mismo. */
const VACIO: Record<ColaTicket, { titulo: string; descripcion: string }> = {
  pendientes: {
    titulo: 'Nada pendiente',
    descripcion: 'No hay tickets esperando tu respuesta. Buena señal.',
  },
  esperando: {
    titulo: 'Nadie esperando',
    descripcion: 'Ningún ticket está a la espera de que el cliente conteste.',
  },
  cerrados: {
    titulo: 'Sin tickets cerrados',
    descripcion: 'Todavía no has cerrado ninguno.',
  },
}

export function TicketsTable({ tickets }: { tickets: TicketRow[] }) {
  const [q, setQ] = useState('')
  // Arranca en el trabajo pendiente, no en "todos": lo primero que se ve al
  // abrir la bandeja es lo que hay que hacer.
  const [cola, setCola] = useState<ColaTicket>('pendientes')

  /** Contadores por cola, sobre el total y NO sobre lo ya filtrado: una
   *  pestaña tiene que decir cuántos hay dentro, no cuántos quedan tras la
   *  búsqueda que se está escribiendo en otra. */
  const conteos = useMemo(() => {
    const acc: Record<ColaTicket, number> = { pendientes: 0, esperando: 0, cerrados: 0 }
    for (const t of tickets) {
      const c = colaDeEstado(t.estado)
      if (c) acc[c] += 1
    }
    return acc
  }, [tickets])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return tickets.filter((t) => {
      if (colaDeEstado(t.estado) !== cola) return false
      if (!term) return true
      return (
        t.asunto.toLowerCase().includes(term) ||
        t.clienteNombre.toLowerCase().includes(term)
      )
    })
  }, [tickets, q, cola])

  return (
    <div className="space-y-4">
      {/* Colas en vez del desplegable "Todos los estados". El desplegable
          obligaba a saberse los cinco estados y a elegir uno para poder
          trabajar; las colas contestan directamente "¿qué me toca?". */}
      <TabsNav
        aria-label="Colas de soporte"
        items={COLAS.map((c) => ({
          label: COLA_LABEL[c],
          badge: conteos[c],
          active: c === cola,
          render: ({ className, children }) => (
            <button type="button" onClick={() => setCola(c)} className={className}>
              {children}
            </button>
          ),
        }))}
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por asunto o cliente…"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<TicketIcon className="h-6 w-6" />}
          title={q.trim() ? 'Sin resultados' : VACIO[cola].titulo}
          description={
            q.trim()
              ? `Ningún ticket de esta cola coincide con «${q.trim()}».`
              : VACIO[cola].descripcion
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <Link key={t.id} href={`/admin/tickets/${t.id}`} className="block">
              <Card className="transition hover:shadow-card-hover">
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-foreground">{t.asunto}</p>
                      <Badge variant="secondary" className="text-caption">
                        {categoriaLabel(t.categoria)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-small text-muted-foreground">
                      {t.clienteNombre}
                      {t.showEmpresa && <span> · {t.empresaNombre}</span>}
                      <span> · {t.mensajes} mensaje{t.mensajes !== 1 ? 's' : ''}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge className={estadoBadgeClass(t.estado)}>{estadoLabel(t.estado)}</Badge>
                    <span className="text-caption text-muted-foreground">{t.actualizado}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
