'use client'

import * as React from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table'
import { Search, ChevronLeft, ChevronRight, Download, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '../cn'
import { Button } from './button'
import { Input } from './input'

export interface DataTableProps<TData extends Record<string, any>, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchPlaceholder?: string
  searchKey?: keyof TData
  pageSize?: number
  onRowClick?: (row: TData) => void
  exportable?: boolean
  exportFilename?: string
  striped?: boolean
}

export function DataTable<TData extends Record<string, unknown>, TValue>({
  columns,
  data,
  searchPlaceholder = 'Buscar...',
  searchKey,
  pageSize = 10,
  onRowClick,
  exportable = false,
  exportFilename = 'datos.csv',
  striped = true,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = React.useState('')

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    globalFilterFn: (row, _columnId, filterValue) => {
      if (!searchKey) return true
      const value = row.getValue(searchKey as string)
      return String(value ?? '').toLowerCase().includes(filterValue.toLowerCase())
    },
  })

  function csvEscape(value: unknown): string {
    const s = String(value ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  function exportCSV() {
    const headers = columns
      .filter((col) => col.header)
      .map((col) => csvEscape(typeof col.header === 'string' ? col.header : (col.id ?? '')))

    // Exporta el VALOR crudo de cada celda (cell.getValue()), no el ReactElement
    // renderizado — String(ReactElement) produce "[object Object]".
    const rows = table.getFilteredRowModel().rows.map((row) =>
      row
        .getVisibleCells()
        .map((cell) => csvEscape(cell.getValue()))
        .join(',')
    )

    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportFilename
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      {/*
        El buscador solo existe si hay algo por lo que buscar. Sin `searchKey`,
        `globalFilterFn` devuelve true para todas las filas: el campo se pintaba
        igual y no filtraba NADA. Donde la búsqueda se había movido al servidor
        —Clientes— quedaban dos campos idénticos, uno vivo y otro muerto, sin
        forma de distinguirlos. Un control que no hace nada es peor que no tener
        control: enseña a desconfiar de los que sí funcionan.
      */}
      <div
        className={`flex flex-col gap-3 md:flex-row md:items-center ${
          searchKey ? 'md:justify-between' : 'md:justify-end'
        } ${!searchKey && !exportable ? 'hidden' : ''}`}
      >
        {searchKey && (
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="pl-9"
            />
          </div>
        )}
        {exportable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportCSV}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Exportar
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border/70 bg-card shadow-sm">
        <table className="w-full">
          <thead className="border-b border-border/70 bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  Sin resultados.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, idx) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row.original)}
                  className={cn(
                    'border-b border-border/40 transition',
                    striped && idx % 2 === 1 ? 'bg-muted/30' : '',
                    onRowClick ? 'cursor-pointer hover:bg-muted/50' : ''
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-sm text-foreground">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-2 px-2 py-4">
        <div className="text-xs text-muted-foreground">
          Mostrando <strong>{table.getRowModel().rows.length}</strong> de{' '}
          <strong>{table.getFilteredRowModel().rows.length}</strong> resultados
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            title="Primera página"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs font-medium text-muted-foreground px-2">
            Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
            title="Última página"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
