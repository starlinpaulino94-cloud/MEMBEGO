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
  { slug: '', label: 'Resumen', grupo: 'ANALITICA' },
  { slug: 'proveedores', label: 'Proveedores', grupo: 'COMERCIAL' },
  { slug: 'acuerdos', label: 'Acuerdos', grupo: 'COMERCIAL' },
  { slug: 'ordenes', label: 'Compras', grupo: 'COMERCIAL' },
  { slug: 'lotes', label: 'Lotes y asignaciones', grupo: 'INVENTARIO' },
  { slug: 'derechos', label: 'Derechos', grupo: 'INVENTARIO' },
  { slug: 'redenciones', label: 'Redenciones', grupo: 'OPERACION' },
  { slug: 'ventas', label: 'Ventas', grupo: 'OPERACION' },
  { slug: 'incidencias', label: 'Incidencias', grupo: 'OPERACION' },
  { slug: 'vencimientos', label: 'Vencimientos', grupo: 'OPERACION' },
  { slug: 'finanzas', label: 'Finanzas', grupo: 'FINANZAS' },
  { slug: 'conciliacion', label: 'Conciliación', grupo: 'FINANZAS' },
  { slug: 'economia', label: 'Economía', grupo: 'ANALITICA' },
  { slug: 'reportes', label: 'Reportes', grupo: 'ANALITICA' },
] as const

export const GRUPOS_SUPPLY = [
  { id: 'COMERCIAL', label: 'Comercial' },
  { id: 'INVENTARIO', label: 'Inventario' },
  { id: 'OPERACION', label: 'Operación' },
  { id: 'FINANZAS', label: 'Finanzas' },
  { id: 'ANALITICA', label: 'Analítica' },
] as const

export type SeccionSupply = (typeof SECCIONES_SUPPLY)[number]['slug']

export const BASE_SUPPLY = '/superadmin/supply'

/**
 * Dos filas: los cinco grupos (Comercial · Inventario · Operación · Finanzas ·
 * Analítica) y, debajo, las pantallas del grupo activo. Catorce pestañas en
 * una sola fila ya no cabían ni se leían (§40); los grupos siguen el orden en
 * que el dinero recorre el módulo.
 */
export function NavSupply({ activa }: { activa: SeccionSupply }) {
  const grupoActivo = SECCIONES_SUPPLY.find((s) => s.slug === activa)?.grupo ?? 'ANALITICA'
  const delGrupo = SECCIONES_SUPPLY.filter((s) => s.grupo === grupoActivo)
  return (
    <div className="space-y-2">
      <TabsNav
        aria-label="Áreas de Supply"
        items={GRUPOS_SUPPLY.map((g) => {
          const primera = SECCIONES_SUPPLY.find((s) => s.grupo === g.id)!
          return {
            label: g.label,
            active: g.id === grupoActivo,
            render: ({ className, children }) => (
              <Link key={g.id} href={primera.slug ? `${BASE_SUPPLY}/${primera.slug}` : BASE_SUPPLY} className={className}>
                {children}
              </Link>
            ),
          }
        })}
      />
      <div className="flex flex-wrap gap-2">
        {delGrupo.map((s) => (
          <Link
            key={s.slug}
            href={s.slug ? `${BASE_SUPPLY}/${s.slug}` : BASE_SUPPLY}
            aria-current={s.slug === activa ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${s.slug === activa ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}
          >
            {s.label}
          </Link>
        ))}
      </div>
    </div>
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
