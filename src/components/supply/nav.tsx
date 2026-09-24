import Link from 'next/link'
import { TabsNav } from '@/components/ui/tabs-nav'

/**
 * MEMBEGO SUPPLY · navegación de la sección (Fase 47).
 *
 * Doce vistas del mismo dominio. Sin estas pestañas, cada una parece una
 * página suelta y la única forma de moverse entre «el lote» y «la campaña que
 * lo consume» es volver al menú lateral — que es exactamente lo que hace que
 * un módulo de doce pantallas se sienta como doce módulos.
 *
 * El orden sigue el ciclo del §0 de la arquitectura: contrato → compra →
 * lote → asignación → cliente → entrega → dinero → análisis. Quien lo recorre
 * de izquierda a derecha está recorriendo la vida de una pizza.
 */

export const SECCIONES_SUPPLY = [
  { slug: '', label: 'Resumen' },
  { slug: 'proveedores', label: 'Proveedores' },
  { slug: 'acuerdos', label: 'Acuerdos' },
  { slug: 'ordenes', label: 'Órdenes' },
  { slug: 'lotes', label: 'Lotes' },
  { slug: 'derechos', label: 'Derechos' },
  { slug: 'redenciones', label: 'Redenciones' },
  { slug: 'incidencias', label: 'Incidencias' },
  { slug: 'vencimientos', label: 'Vencimientos' },
  { slug: 'liquidaciones', label: 'Liquidaciones' },
  { slug: 'conciliacion', label: 'Conciliación' },
  { slug: 'economia', label: 'Economía' },
] as const

export type SeccionSupply = (typeof SECCIONES_SUPPLY)[number]['slug']

export const BASE_SUPPLY = '/superadmin/supply'

export function NavSupply({ activa }: { activa: SeccionSupply }) {
  return (
    <TabsNav
      items={SECCIONES_SUPPLY.map((s) => ({
        label: s.label,
        active: s.slug === activa,
        render: ({ className, children }) => (
          <Link key={s.slug} href={s.slug ? `${BASE_SUPPLY}/${s.slug}` : BASE_SUPPLY} className={className}>
            {children}
          </Link>
        ),
      }))}
    />
  )
}
