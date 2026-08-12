'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { navContextsForRole, filtrarNavOculto } from '@/components/layout/nav-config'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import type { AppRole } from '@/types'

/**
 * Paleta de comandos (Cmd+K / Ctrl+K): navegación rápida a cualquier sección
 * del panel, agrupada como el sidebar. Complementa el buscador del header.
 *
 * AQUÍ SE JUNTAN LOS DOS PANELES DEL SUPERADMIN, y en ningún otro sitio: el
 * menú lateral enseña un contexto cada vez. Por eso «Planes» de la plataforma y
 * «Planes» de una empresa coincidían en la lista, y por eso las etiquetas
 * llevaban colgando un «globales» que en el menú no distinguía nada.
 *
 * La solución es decir de qué PANEL es cada resultado —que es la diferencia
 * real— en vez de alargar el nombre del módulo. Con un solo contexto (todos los
 * demás roles) el encabezado no cambia.
 */
export function CommandPalette({ role, hiddenNav }: { role: AppRole; hiddenNav?: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const contextos = navContextsForRole(role)
  const variosPaneles = contextos.length > 1
  const groups = contextos.flatMap((c) =>
    filtrarNavOculto(c.groups, hiddenNav ?? []).map((g) => ({
      ...g,
      // El panel primero: es lo que separa dos «Planes» que van a sitios
      // distintos, y lo que el buscador necesita para que escribir
      // «plataforma planes» encuentre solo uno.
      heading: variosPaneles ? `${c.label} · ${g.label}` : g.label,
    }))
  )

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

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Ir a…"
      description="Navega a cualquier sección del panel"
    >
      <CommandInput placeholder="¿A dónde quieres ir?" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <CommandItem
                  key={item.href}
                  value={`${group.heading} ${item.label}`}
                  onSelect={() => go(item.href)}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
