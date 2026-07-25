'use client'

import Link from 'next/link'
import { type ColumnDef } from '@tanstack/react-table'
import { ExternalLink } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { EstadoBadge } from '@/components/EstadoBadge'
import type { MembershipEstado } from '@/types'

export interface ClienteRow {
  id: string
  nombre: string
  email: string
  createdAt: Date
  memberships: Array<{
    id: string
    estado: MembershipEstado
    plan: { nombre: string }
  }>
}

const columns: ColumnDef<ClienteRow>[] = [
  {
    accessorKey: 'nombre',
    header: 'Nombre',
    cell: ({ row }) => <span className="font-medium">{row.getValue('nombre')}</span>,
  },
  {
    accessorKey: 'email',
    header: 'Correo',
  },
  {
    accessorKey: 'createdAt',
    header: 'Registrado',
    cell: ({ row }) => {
      const date = new Date(row.getValue('createdAt') as Date)
      // Fecha Y hora: el registro es una acción, y la trazabilidad exige saber
      // el momento exacto, no solo el día.
      return new Intl.DateTimeFormat('es-DO', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
    },
  },
  {
    id: 'membership',
    header: 'Membresía',
    cell: ({ row }) => {
      const membership = row.original.memberships?.[0]
      if (!membership) return <span className="text-muted-foreground">—</span>
      return (
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{membership.plan.nombre}</p>
          <EstadoBadge estado={membership.estado} />
        </div>
      )
    },
  },
  {
    id: 'actions',
    header: 'Acciones',
    cell: ({ row }) => (
      <Link href={`/admin/clientes/${row.original.id}`} title="Ver detalles">
        <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-muted-foreground" />
      </Link>
    ),
  },
]

export function ClientesTable({ data }: { data: ClienteRow[] }) {
  return (
    <DataTable
      columns={columns as unknown as ColumnDef<Record<string, unknown>, unknown>[]}
      data={data as unknown as Record<string, unknown>[]}
      searchPlaceholder="Buscar por nombre o correo..."
      searchKey="nombre"
      pageSize={10}
      exportable
      exportFilename="clientes.csv"
    />
  )
}
