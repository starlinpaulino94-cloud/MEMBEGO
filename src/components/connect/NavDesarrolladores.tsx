'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TabsNav } from '@/components/ui/tabs-nav'

/**
 * Navegación del hub de desarrolladores.
 *
 * Es cliente por una sola razón: necesita `usePathname` para saber qué
 * pestaña está activa. Todo lo demás del hub es servidor.
 *
 * El orden no es alfabético, es el del recorrido real de quien integra:
 * primero entiende la API, luego se hace una clave, luego pide avisos, y solo
 * cuando algo falla mira los registros. Al final, la documentación —que se
 * abre aparte, porque es la especificación OpenAPI y no una pantalla del
 * panel—, marcada con el icono de «se va fuera».
 */

const BASE = '/admin/integraciones/desarrolladores'

const SECCIONES = [
  { href: BASE, label: 'Resumen' },
  { href: `${BASE}/claves`, label: 'Claves de API' },
  { href: `${BASE}/webhooks`, label: 'Webhooks' },
  { href: `${BASE}/registros`, label: 'Registros' },
] as const

const EXTERNAS = [{ href: '/api/platform/v1/openapi', label: 'Documentación' }] as const

export function NavDesarrolladores() {
  const ruta = usePathname()

  return (
    <TabsNav
      aria-label="Herramientas para desarrolladores"
      items={[
        ...SECCIONES.map((s) => ({
          label: s.label,
          // Igualdad exacta y no un prefijo: con prefijo, «Resumen» quedaría
          // activo en las cuatro pantallas, porque su ruta lo es de todas.
          active: ruta === s.href,
          render: ({ className, children }: { className: string; children: React.ReactNode }) => (
            <Link href={s.href} className={className}>
              {children}
            </Link>
          ),
        })),
        ...EXTERNAS.map((e) => ({
          label: e.label,
          active: false,
          render: ({ className, children }: { className: string; children: React.ReactNode }) => (
            <a
              href={e.href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(className, 'inline-flex items-center gap-1')}
            >
              {children}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ),
        })),
      ]}
    />
  )
}
