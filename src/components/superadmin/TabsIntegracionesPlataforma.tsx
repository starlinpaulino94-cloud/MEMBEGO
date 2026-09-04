import Link from 'next/link'
import { TabsNav } from '@/components/ui/tabs-nav'

/**
 * LAS PESTAÑAS DEL HUB DE INTEGRACIONES DE LA PLATAFORMA.
 *
 * El diseño de referencia presenta Resumen · Catálogo · Empresas · Salud como
 * un solo hub. En el código son DOS rutas —`/superadmin/connect` (catálogo,
 * adopción y concesiones) e `/superadmin/integraciones` (sistemas satélite y
 * cola de eventos)— y no se fusionan a propósito: mover rutas es otro trabajo
 * con otro riesgo. Lo que se comparte es esta barra, que hace que las dos
 * pantallas se lean como partes de lo mismo.
 *
 * Es un componente de SERVIDOR: quién está activa lo sabe la página que la
 * pinta (conoce su ruta y su `?seccion=`), así que no hace falta `usePathname`
 * ni `useSearchParams` —que obligaría a un límite de suspensión— en el
 * navegador.
 */

export type SeccionIntegraciones = 'resumen' | 'catalogo' | 'empresas' | 'salud'

const PESTANAS: { id: SeccionIntegraciones; label: string; href: string }[] = [
  { id: 'resumen', label: 'Resumen', href: '/superadmin/connect' },
  { id: 'catalogo', label: 'Catálogo', href: '/superadmin/connect?seccion=catalogo' },
  { id: 'empresas', label: 'Empresas', href: '/superadmin/connect?seccion=empresas' },
  { id: 'salud', label: 'Salud', href: '/superadmin/integraciones' },
]

export function TabsIntegracionesPlataforma({
  activa,
  badges,
}: {
  activa: SeccionIntegraciones
  /** Contadores REALES por pestaña. Sin dato, no se pinta nada. */
  badges?: Partial<Record<SeccionIntegraciones, number>>
}) {
  return (
    <TabsNav
      aria-label="Integraciones de la plataforma"
      items={PESTANAS.map((p) => ({
        label: p.label,
        badge: badges?.[p.id],
        active: p.id === activa,
        render: ({ className, children }) => (
          <Link href={p.href} className={className}>
            {children}
          </Link>
        ),
      }))}
    />
  )
}
