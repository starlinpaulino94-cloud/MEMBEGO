'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TabsNav } from '@/components/ui/tabs-nav'

/**
 * Navegación del hub de desarrolladores.
 *
 * Es cliente por una sola razón: necesita `usePathname` para saber qué
 * pestaña está activa. Todo lo demás del hub es servidor.
 *
 * El orden no es alfabético, es el del recorrido real de quien integra:
 * primero entiende la API, luego se hace una clave, luego pide avisos, y solo
 * cuando algo falla mira los registros.
 */

const BASE = '/admin/integraciones/desarrolladores'

const SECCIONES = [
  { href: BASE, label: 'Resumen' },
  { href: `${BASE}/claves`, label: 'Claves de API' },
  { href: `${BASE}/webhooks`, label: 'Webhooks' },
  { href: `${BASE}/registros`, label: 'Registros' },
] as const

export function NavDesarrolladores() {
  const ruta = usePathname()

  return (
    <TabsNav
      aria-label="Herramientas para desarrolladores"
      items={SECCIONES.map((s) => ({
        label: s.label,
        // Igualdad exacta y no `startsWith`: con prefijo, «Resumen» quedaría
        // activo en las cuatro pantallas, porque su ruta es prefijo de todas.
        active: ruta === s.href,
        render: ({ className, children }) => (
          <Link href={s.href} className={className}>
            {children}
          </Link>
        ),
      }))}
    />
  )
}
