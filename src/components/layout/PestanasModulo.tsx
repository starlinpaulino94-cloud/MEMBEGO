'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NavSeccion } from '@/components/ui/nav-seccion'
import { pestanasDeModulo, type ContextoNav } from '@/components/layout/nav-config'

/**
 * LA BARRA DE PESTAÑAS DEL MÓDULO (auditoría admin · fase 6, tarea 6.1; 03 · C.2).
 *
 * Pagos, Registros, Comprobantes y Conciliación eran cuatro entradas de menú; ahora son un módulo con cuatro pestañas, y cada
 * una sigue siendo su ruta de siempre. Esta barra se pinta encima de la pantalla en TODAS las rutas de un módulo con pestañas, sin
 * que ninguna pantalla sepa de ella: qué pestañas hay, cuáles ve esta persona y cuál está activa lo decide `nav-config`.
 *
 * Vive en la carcasa y no en un layout por módulo porque las pestañas de un módulo están en carpetas distintas
 * (`/admin/pagos`, `/admin/registros`, `/admin/conciliacion`…): ningún layout las envolvería a todas.
 *
 * Es solo oferta. Lo que no se puede abrir no aparece, pero quien llegue por la URL se encuentra con la guardia de la ruta.
 */
export function PestanasModulo({ ctx }: { ctx: ContextoNav }) {
  const pathname = usePathname()
  // `usePathname` es null fuera del enrutador (pruebas, vistas previas): sin ruta no hay barra que pintar.
  const barra = useMemo(() => (pathname ? pestanasDeModulo(pathname, ctx) : null), [pathname, ctx])
  if (!barra) return null

  return (
    <div className="mb-6">
      <NavSeccion
        aria-label={`Secciones de ${barra.modulo}`}
        items={barra.pestanas.map((p) => ({ etiqueta: p.label, href: p.href, activa: p.activa }))}
        // Sin prefetch, como el menú: cada prefetch de una ruta `force-dynamic` dispara middleware y consultas de sesión.
        enlace={({ href, ...resto }) => <Link href={href} prefetch={false} {...resto} />}
      />
    </div>
  )
}
