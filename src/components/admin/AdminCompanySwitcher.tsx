'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronsUpDown, Loader2, Store } from 'lucide-react'
import { toast } from 'sonner'
import { cambiarEmpresaActiva } from '@/modules/admin/empresaActivaActions'
import { cn } from '@/lib/utils'

interface EmpresaOption {
  id: string
  name: string
}

/**
 * Selector de empresa activa para staff multi-empresa (y superadmin). Cambia
 * el contexto de TODO el panel: al confirmar, el servidor actualiza la
 * empresa activa y se refresca la vista sin recargar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VIVE EN LA BARRA LATERAL, BAJO LA MARCA (contrato Stitch)
 *
 * Antes era una barra suelta encima del contenido. El diseño lo pone como
 * tarjeta fija bajo «MEMBEGO · Admin Hub», y ahí es donde rinde: quien
 * administra dos negocios ve SOBRE CUÁL está trabajando antes de tocar nada,
 * en el mismo sitio en todas las pantallas. Con una sola empresa este
 * componente no se monta y la columna pinta su tarjeta estática.
 */
export function AdminCompanySwitcher({
  empresas,
  activaId,
  sede,
}: {
  empresas: EmpresaOption[]
  activaId: string | null
  /** «Sede Higüey» — segunda línea de la tarjeta; sin dato no se pinta. */
  sede?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  if (empresas.length < 2) return null

  const activa = empresas.find((e) => e.id === activaId)

  function seleccionar(id: string) {
    setOpen(false)
    if (id === activaId) return
    startTransition(async () => {
      const res = await cambiarEmpresaActiva(id)
      if (res.error) {
        toast.error(res.error)
        return
      }
      const nombre = empresas.find((e) => e.id === id)?.name ?? 'la empresa'
      toast.success(`Ahora administras ${nombre}.`)
      router.refresh()
    })
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Cambiar empresa activa"
        className="flex w-full items-center gap-2.5 rounded-lg bg-sidebar-accent px-3 py-2.5 text-left outline-none transition hover:bg-sidebar-active focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-sidebar-foreground" aria-hidden />
        ) : (
          <Store className="size-4 shrink-0 text-sidebar-accent-foreground" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label-lg text-sidebar-accent-foreground">
            {activa?.name ?? 'Elegir empresa'}
          </span>
          {sede ? (
            <span className="block truncate text-label-md text-sidebar-foreground">{sede}</span>
          ) : null}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground" aria-hidden />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label="Empresas disponibles"
            className="absolute left-0 top-full z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-lg"
          >
            {empresas.map((e) => (
              <button
                key={e.id}
                role="option"
                aria-selected={e.id === activaId}
                onClick={() => seleccionar(e.id)}
                className={cn(
                  'flex w-full items-center justify-between px-3.5 py-2 text-left text-sm transition hover:bg-muted',
                  e.id === activaId ? 'font-semibold text-primary' : 'text-foreground'
                )}
              >
                <span className="truncate">{e.name}</span>
                {e.id === activaId && <Check className="size-4 shrink-0" aria-hidden />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
