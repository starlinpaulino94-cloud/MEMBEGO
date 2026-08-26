'use client'

import { useState, type ReactNode } from 'react'
import { Search, Archive, ArchiveRestore } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function ListaToolbar({
  placeholder,
  mostrarArchivados,
  onToggleArchivados,
  children,
}: {
  placeholder: string
  mostrarArchivados: boolean
  onToggleArchivados: () => void
  children: (busqueda: string) => ReactNode
}) {
  const [busqueda, setBusqueda] = useState('')

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={placeholder}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          variant={mostrarArchivados ? 'default' : 'outline'}
          size="sm"
          onClick={onToggleArchivados}
          className="gap-1.5"
        >
          {mostrarArchivados ? (
            <ArchiveRestore className="h-4 w-4" />
          ) : (
            <Archive className="h-4 w-4" />
          )}
          {mostrarArchivados ? 'Ocultar archivados' : 'Archivados'}
        </Button>
      </div>
      {children(busqueda)}
    </div>
  )
}
