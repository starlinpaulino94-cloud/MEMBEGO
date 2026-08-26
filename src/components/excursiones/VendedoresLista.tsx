'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ListaToolbar } from './ListaToolbar'
import { StatusChip } from '@/components/ui/status-chip'
import {
  ESTADO_VENDEDOR_LABEL,
  TONO_VENDEDOR,
  type EstadoVendedor,
} from '@/modules/excursiones/vendedores/nucleo'

type VendedorRow = {
  id: string
  nombre: string
  apellido: string | null
  codigo: string
  tipo: string | null
  telefono: string | null
  estado: string
  _count: { atribuciones: number }
}

const INACTIVOS = ['INACTIVO']

export function VendedoresLista({ vendedores }: { vendedores: VendedorRow[] }) {
  const [mostrarArchivados, setMostrarArchivados] = useState(false)

  const filtrados = useMemo(() => {
    return vendedores.filter((v) => {
      if (!mostrarArchivados && INACTIVOS.includes(v.estado)) return false
      return true
    })
  }, [vendedores, mostrarArchivados])

  return (
    <ListaToolbar
      placeholder="Buscar por nombre, código, tipo o teléfono…"
      mostrarArchivados={mostrarArchivados}
      onToggleArchivados={() => setMostrarArchivados((a) => !a)}
    >
      {(busqueda) => {
        const q = busqueda.toLowerCase()
        const visibles = filtrados.filter(
          (v) =>
            !q ||
            `${v.nombre} ${v.apellido ?? ''}`.toLowerCase().includes(q) ||
            v.codigo.toLowerCase().includes(q) ||
            (v.tipo ?? '').toLowerCase().includes(q) ||
            (v.telefono ?? '').toLowerCase().includes(q)
        )
        return (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-caption uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Vendedor</th>
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Teléfono</th>
                  <th className="px-4 py-3">Captados</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      {busqueda ? 'Ningún vendedor coincide con la búsqueda.' : 'Sin resultados.'}
                    </td>
                  </tr>
                ) : (
                  visibles.map((v) => (
                    <tr key={v.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/excursiones/vendedores/${v.id}`}
                          className="font-semibold text-foreground hover:text-primary hover:underline"
                        >
                          {v.nombre} {v.apellido ?? ''}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono text-foreground">{v.codigo}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v.tipo ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v.telefono ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v._count.atribuciones}</td>
                      <td className="px-4 py-3">
                        <StatusChip tone={TONO_VENDEDOR[v.estado as EstadoVendedor] ?? 'neutral'}>
                          {ESTADO_VENDEDOR_LABEL[v.estado as EstadoVendedor] ?? v.estado}
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
