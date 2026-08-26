'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ListaToolbar } from './ListaToolbar'
import { StatusChip } from '@/components/ui/status-chip'
import {
  ESTADO_RESERVA_LABEL,
  TONO_RESERVA,
  type EstadoReserva,
} from '@/modules/excursiones/reservas/nucleo'
import { formatDate, formatMoney } from '@/lib/format'

type ReservaRow = {
  id: string
  numero: string
  cliente: string
  excursion: string
  fecha: Date | string
  hora: string | null
  pasajeros: number
  total: number
  saldo: number
  moneda: string
  vendedor: string | null
  estado: string
}

const CERRADOS = ['COMPLETADA', 'CANCELADA', 'NO_SHOW']

export function ReservasLista({ reservas }: { reservas: ReservaRow[] }) {
  const [mostrarArchivados, setMostrarArchivados] = useState(false)

  const filtradas = useMemo(() => {
    return reservas.filter((r) => {
      if (!mostrarArchivados && CERRADOS.includes(r.estado)) return false
      return true
    })
  }, [reservas, mostrarArchivados])

  return (
    <ListaToolbar
      placeholder="Buscar por número, cliente, excursión o vendedor…"
      mostrarArchivados={mostrarArchivados}
      onToggleArchivados={() => setMostrarArchivados((a) => !a)}
    >
      {(busqueda) => {
        const q = busqueda.toLowerCase()
        const visibles = filtradas.filter(
          (r) =>
            !q ||
            r.numero.toLowerCase().includes(q) ||
            r.cliente.toLowerCase().includes(q) ||
            r.excursion.toLowerCase().includes(q) ||
            (r.vendedor ?? '').toLowerCase().includes(q)
        )
        return (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-caption uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Número</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Excursión</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Pax</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Saldo</th>
                  <th className="px-4 py-3">Vendedor</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      {busqueda ? 'Ninguna reserva coincide con la búsqueda.' : 'Sin resultados.'}
                    </td>
                  </tr>
                ) : (
                  visibles.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/excursiones/reservas/${r.id}`}
                          className="font-mono font-semibold text-foreground hover:text-primary hover:underline"
                        >
                          {r.numero}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-foreground">{r.cliente}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.excursion}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(r.fecha)}
                        {r.hora ? ` · ${r.hora}` : ''}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.pasajeros}</td>
                      <td className="px-4 py-3 text-foreground">
                        {formatMoney(r.total, { moneda: r.moneda }, 2)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.saldo > 0 ? formatMoney(r.saldo, { moneda: r.moneda }, 2) : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.vendedor ?? 'Directa'}</td>
                      <td className="px-4 py-3">
                        <StatusChip tone={TONO_RESERVA[r.estado as EstadoReserva] ?? 'neutral'}>
                          {ESTADO_RESERVA_LABEL[r.estado as EstadoReserva] ?? r.estado}
                        </StatusChip>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      }}
    </ListaToolbar>
  )
}
