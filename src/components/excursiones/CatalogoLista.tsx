'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ListaToolbar } from './ListaToolbar'
import { StatusChip } from '@/components/ui/status-chip'
import {
  ESTADO_EXCURSION_LABEL,
  TONO_EXCURSION,
  type EstadoExcursion,
} from '@/modules/excursiones/catalogo/nucleo'
import { formatMoney } from '@/lib/format'

type ExcursionRow = {
  id: string
  nombre: string
  tipoItem: string | null
  categoria: string | null
  moneda: string
  estado: string
  variantes: { precioAdulto: any }[]
  _count: { variantes: number; horarios: number; comboItems: number }
}

const INACTIVOS = ['ARCHIVADA']

export function CatalogoLista({ excursiones }: { excursiones: ExcursionRow[] }) {
  const [mostrarArchivados, setMostrarArchivados] = useState(false)

  const filtradas = useMemo(() => {
    return excursiones.filter((e) => {
      if (!mostrarArchivados && INACTIVOS.includes(e.estado)) return false
      return true
    })
  }, [excursiones, mostrarArchivados])

  return (
    <ListaToolbar
      placeholder="Buscar excursión…"
      mostrarArchivados={mostrarArchivados}
      onToggleArchivados={() => setMostrarArchivados((a) => !a)}
    >
      {(busqueda) => {
        const visibles = filtradas.filter(
          (e) =>
            !busqueda ||
            e.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
            (e.categoria ?? '').toLowerCase().includes(busqueda.toLowerCase())
        )
        return (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-caption uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Excursión</th>
                  <th className="px-4 py-3">Categoría</th>
                  <th className="px-4 py-3">Desde</th>
                  <th className="px-4 py-3">Variantes</th>
                  <th className="px-4 py-3">Horarios</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      {busqueda ? 'Ninguna excursión coincide con la búsqueda.' : 'Sin resultados.'}
                    </td>
                  </tr>
                ) : (
                  visibles.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/admin/excursiones/catalogo/${e.id}`}
                            className="font-semibold text-foreground hover:text-primary hover:underline"
                          >
                            {e.nombre}
                          </Link>
                          {e.tipoItem === 'COMBO' ? (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                              Combo ({e._count.comboItems})
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{e.categoria ?? '—'}</td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {e.variantes[0]
                          ? formatMoney(Number(e.variantes[0].precioAdulto), { moneda: e.moneda }, 2)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{e._count.variantes}</td>
                      <td className="px-4 py-3 text-muted-foreground">{e._count.horarios}</td>
                      <td className="px-4 py-3">
                        <StatusChip tone={TONO_EXCURSION[e.estado as EstadoExcursion] ?? 'neutral'}>
                          {ESTADO_EXCURSION_LABEL[e.estado as EstadoExcursion] ?? e.estado}
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
