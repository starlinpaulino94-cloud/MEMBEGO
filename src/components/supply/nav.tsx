import Link from 'next/link'
import { TabsNav } from '@/components/ui/tabs-nav'

/**
 * MEMBEGO SUPPLY · navegación de la sección (Fase 47; reorganizada en la
 * auditoría 2026-09).
 *
 * El orden sigue el ciclo del §0 de la arquitectura: contrato → compra →
 * lote → asignación → cliente → entrega → dinero → análisis. Quien lo recorre
 * de izquierda a derecha está recorriendo la vida de una pizza.
 *
 * «Finanzas» sustituye a la antigua pestaña «Cobros», que mezclaba en un solo
 * nombre cinco cosas distintas. Ahora cada una tiene su pantalla y su
 * sub-pestaña: pagos, depósitos, facturas, cuentas por pagar, cuentas por
 * cobrar, liquidaciones y cobros a clientes. Leer un número creyendo que es
 * otro era la forma más rápida de equivocarse con dinero real.
 */

export const SECCIONES_SUPPLY = [
  { slug: '', label: 'Resumen' },
  { slug: 'proveedores', label: 'Proveedores' },
  { slug: 'acuerdos', label: 'Acuerdos' },
  { slug: 'ordenes', label: 'Órdenes' },
  { slug: 'lotes', label: 'Lotes' },
  { slug: 'derechos', label: 'Derechos' },
  { slug: 'redenciones', label: 'Redenciones' },
  { slug: 'ventas', label: 'Ventas' },
  { slug: 'finanzas', label: 'Finanzas' },
  { slug: 'incidencias', label: 'Incidencias' },
  { slug: 'vencimientos', label: 'Vencimientos' },
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

/**
 * Sub-navegación de Finanzas. Cada entrada es un dominio distinto del dinero
 * (§16-19 del encargo): se agrupan en la interfaz, no en el modelo.
 */
export const SECCIONES_FINANZAS = [
  { slug: '', label: 'Resumen' },
  { slug: 'pagos', label: 'Pagos' },
  { slug: 'depositos', label: 'Depósitos' },
  { slug: 'facturas', label: 'Facturas de proveedor' },
  { slug: 'cuentas-por-pagar', label: 'Cuentas por pagar' },
  { slug: 'cuentas-por-cobrar', label: 'Cuentas por cobrar' },
  { slug: 'liquidaciones', label: 'Liquidaciones' },
  { slug: 'cobros-clientes', label: 'Cobros a clientes' },
] as const

export type SeccionFinanzas = (typeof SECCIONES_FINANZAS)[number]['slug']

export const BASE_FINANZAS = `${BASE_SUPPLY}/finanzas`

export function NavFinanzas({ activa }: { activa: SeccionFinanzas }) {
  return (
    <div className="space-y-3">
      <NavSupply activa="finanzas" />
      <div className="flex flex-wrap gap-2">
        {SECCIONES_FINANZAS.map((s) => (
          <Link
            key={s.slug}
            href={s.slug ? `${BASE_FINANZAS}/${s.slug}` : BASE_FINANZAS}
            aria-current={s.slug === activa ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              s.slug === activa ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
