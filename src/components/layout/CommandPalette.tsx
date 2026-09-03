'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { visibleWorkspaces, type ContextoNav } from '@/components/layout/nav-config'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

/**
 * Paleta de comandos (Cmd+K / Ctrl+K): navegación rápida a cualquier módulo,
 * agrupada como el menú. Complementa al buscador de la cabecera.
 *
 * AQUÍ SE JUNTAN TODOS LOS ESPACIOS, y en ningún otro sitio: el menú enseña
 * uno cada vez. Por eso «Planes» de la plataforma y «Planes» de una empresa
 * coincidirían en la lista — y por eso el encabezado dice de qué ESPACIO es
 * cada resultado en vez de alargar el nombre del módulo con un «globales» que
 * dentro de su propio panel no distingue nada.
 *
 * El valor de búsqueda incluye espacio, grupo, etiqueta y palabras clave, así
 * que escribir «plataforma planes» encuentra uno solo, y «cobrar» encuentra
 * Caja aunque el menú no use esa palabra.
 */
export function CommandPalette({ ctx }: { ctx: ContextoNav }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const espacios = useMemo(() => visibleWorkspaces(ctx), [ctx])
  const variosEspacios = espacios.length > 1

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function ir(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Ir a…"
      description="Navega a cualquier módulo de tu panel"
    >
      <CommandInput placeholder="¿A dónde quieres ir?" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        {espacios.flatMap((espacio) =>
          espacio.groups.map((group) => {
            // El espacio primero: es lo que separa dos módulos homónimos que
            // van a sitios distintos.
            const heading = variosEspacios ? `${espacio.label} · ${group.label}` : group.label
            return (
              <CommandGroup key={`${espacio.id}:${group.id}`} heading={heading}>
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <CommandItem
                      key={item.href}
                      value={[
                        heading,
                        item.label,
                        item.description ?? '',
                        ...(item.keywords ?? []),
                      ].join(' ')}
                      onSelect={() => ir(item.href)}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      {item.label}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )
          })
        )}
      </CommandList>
    </CommandDialog>
  )
}
