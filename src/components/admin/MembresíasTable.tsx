'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { type ColumnDef } from '@tanstack/react-table'
import { ExternalLink } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { EstadoBadge } from '@/components/EstadoBadge'
import { CambiarPlanDialog, type PlanOption } from '@/components/admin/CambiarPlanDialog'
import type { MembershipEstado } from '@/types'

export interface MembershipRow {
  id: string
  estado: MembershipEstado
  planId: string
  createdAt: Date
  fechaInicio: Date | null
  fechaVencimiento: Date | null
  lavadosRestantes: number
  cliente: { id: string; nombre: string }
  plan: { nombre: string; esIlimitado: boolean }
}

/** La página del servidor trae 50; la tabla no vuelve a paginarlas. */
const POR_PAGINA_TABLA = 50

const baseColumns: ColumnDef<MembershipRow>[] = [
  {
    accessorKey: 'cliente.nombre',
    header: 'Cliente',
    cell: ({ row }) => (
      <Link
        href={`/admin/clientes/${row.original.cliente.id}`}
        className="font-medium text-primary hover:underline"
      >
        {row.original.cliente.nombre}
      </Link>
    ),
  },
  {
    accessorKey: 'plan.nombre',
    header: 'Plan',
  },
  {
    accessorKey: 'estado',
    header: 'Estado',
    cell: ({ row }) => <EstadoBadge estado={row.getValue('estado')} />,
  },
  {
    accessorKey: 'fechaInicio',
    header: 'Inicio',
    cell: ({ row }) => {
      const date = row.getValue('fechaInicio') as Date | null
      if (!date) return '—'
      return new Intl.DateTimeFormat('es-DO', { dateStyle: 'short' }).format(date)
    },
  },
  {
    accessorKey: 'fechaVencimiento',
    header: 'Vencimiento',
    cell: ({ row }) => {
      const date = row.getValue('fechaVencimiento') as Date | null
      if (!date) return '—'
      return new Intl.DateTimeFormat('es-DO', { dateStyle: 'short' }).format(date)
    },
  },
  {
    id: 'usos',
    header: 'Usos rest.',
    cell: ({ row }) =>
      row.original.plan.esIlimitado ? '∞' : row.original.lavadosRestantes,
  },
]

export function MembresíasTable({
  data,
  planes,
}: {
  data: MembershipRow[]
  planes: PlanOption[]
}) {
  const columns = useMemo<ColumnDef<MembershipRow>[]>(
    () => [
      ...baseColumns,
      {
        id: 'actions',
        header: 'Acciones',
        // La ficha del cliente contiene la membresía (QR, notas, visitas): no
        // existe ruta /admin/membresias/[id]. El cambio de plan es exclusivo
        // del negocio: el cliente no puede cambiarlo desde la app.
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <CambiarPlanDialog
              membershipId={row.original.id}
              clienteNombre={row.original.cliente.nombre}
              planActualId={row.original.planId}
              planActualNombre={row.original.plan.nombre}
              planes={planes}
            />
            <Link
              href={`/admin/clientes/${row.original.cliente.id}`}
              title="Ver ficha del cliente"
              aria-label={`Ver ficha de ${row.original.cliente.nombre}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        ),
      },
    ],
    [planes]
  )

  return (
    <DataTable
      columns={columns as unknown as ColumnDef<Record<string, unknown>, unknown>[]}
      data={data as unknown as Record<string, unknown>[]}
      // Sin buscador propio ni exportación propia: los dos viven en el SERVIDOR
      // (auditoría · A-5/B-9). El de la tabla filtraba las filas ya cargadas,
      // así que una membresía de otra página no aparecía nunca; y el CSV se
      // llevaba solo lo visible, callándose el resto.
      pageSize={POR_PAGINA_TABLA}
    />
  )
}
