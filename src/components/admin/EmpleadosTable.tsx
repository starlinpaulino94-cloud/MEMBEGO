'use client'

import Link from 'next/link'
import { type ColumnDef } from '@tanstack/react-table'
import { ExternalLink } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'

export interface EmpleadoRow {
  id: string
  name: string
  email: string
  rol: string
  esEmpleado: boolean
  createdAt: Date
}

const columns: ColumnDef<EmpleadoRow>[] = [
  {
    accessorKey: 'name',
    header: 'Nombre',
    cell: ({ row }) =>
      // Solo los EMPLEADO tienen página de detalle editable; el resto del
      // equipo se muestra sin enlace (evita un notFound).
      row.original.esEmpleado ? (
        <Link
          href={`/admin/empleados/${row.original.id}`}
          className="font-medium text-primary hover:underline"
        >
          {row.getValue('name')}
        </Link>
      ) : (
        <span className="font-medium text-foreground">{row.getValue('name')}</span>
      ),
  },
  {
    accessorKey: 'email',
    header: 'Correo',
  },
  {
    accessorKey: 'rol',
    header: 'Rol',
  },
  {
    accessorKey: 'createdAt',
    header: 'Registrado',
    cell: ({ row }) => {
      const date = new Date(row.getValue('createdAt') as Date)
      return new Intl.DateTimeFormat('es-DO', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
    },
  },
  {
    id: 'actions',
    header: 'Acciones',
    cell: ({ row }) =>
      row.original.esEmpleado ? (
        <Link href={`/admin/empleados/${row.original.id}`} title="Ver detalles">
          <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-muted-foreground" />
        </Link>
      ) : null,
  },
]

export function EmpleadosTable({ data }: { data: EmpleadoRow[] }) {
  return (
    <DataTable
      columns={columns as unknown as ColumnDef<Record<string, unknown>, unknown>[]}
      data={data as unknown as Record<string, unknown>[]}
      searchPlaceholder="Buscar por nombre o correo..."
      searchKey="name"
      pageSize={10}
      exportable
      exportFilename="empleados.csv"
    />
  )
}
