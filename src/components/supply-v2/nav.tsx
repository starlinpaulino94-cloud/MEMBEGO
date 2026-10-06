import Link from 'next/link'
import { cn } from '@/lib/utils'
import { BASE_SUPPLY_V2 } from '@/modules/supply-v2/core/catalogo'

/**
 * MEMBEGO SUPPLY 2.0 · navegación (§25, §42, §63; Slice 4 §33, §68): once pestañas.
 *
 * Rediseño Stitch (dirección blanca): las pestañas van agrupadas por etapa del
 * ciclo (Operación, Comercial, Entrega, Clientes, Finanzas), con la etiqueta
 * del grupo encima y un separador fino entre grupos. La activa va en azul
 * claro con subrayado azul. Todo en una fila que se desliza si no cabe.
 */
export const SECCIONES_SUPPLY_V2 = [
  { slug: '', label: 'Resumen', grupo: 'Operación' },
  { slug: 'compras', label: 'Compras', grupo: 'Operación' },
  { slug: 'proveedores', label: 'Proveedores', grupo: 'Operación' },
  { slug: 'supply', label: 'Supply', grupo: 'Operación' },
  { slug: 'ofertas', label: 'Ofertas', grupo: 'Comercial' },
  // Slice 6
  { slug: 'beneficios', label: 'Beneficios', grupo: 'Comercial' },
  // Slice 7
  { slug: 'campanas', label: 'Campañas', grupo: 'Comercial' },
  { slug: 'redenciones', label: 'Redenciones', grupo: 'Entrega' },
  // Slice 8 · «Fidelización», no «Membresías»: V1 ya usa ese nombre en su
  // propio menú y dos entradas iguales confunden a quien opera.
  { slug: 'fidelizacion', label: 'Fidelización', grupo: 'Clientes' },
  // Slice 4
  { slug: 'finanzas', label: 'Finanzas', grupo: 'Finanzas' },
  { slug: 'economia', label: 'Economía', grupo: 'Finanzas' },
] as const

export type SeccionSupplyV2 = (typeof SECCIONES_SUPPLY_V2)[number]['slug']

const GRUPOS = ['Operación', 'Comercial', 'Entrega', 'Clientes', 'Finanzas'] as const

export function hrefSupplyV2(slug: string): string {
  return slug ? `${BASE_SUPPLY_V2}/${slug}` : BASE_SUPPLY_V2
}

/**
 * Contadores opcionales por pestaña (p. ej. compras abiertas, campañas
 * activas). Un cero no se pinta: una píldora con «0» es ruido.
 */
export type ContadoresSupplyV2 = Partial<Record<SeccionSupplyV2, { valor: number; tono?: 'neutral' | 'exito' }>>

export function NavSupplyV2({ activa, contadores }: { activa: SeccionSupplyV2; contadores?: ContadoresSupplyV2 }) {
  return (
    <nav aria-label="Secciones de Supply 2.0" className="no-scrollbar -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="flex min-w-max items-stretch">
        {GRUPOS.map((grupo, i) => (
          <div key={grupo} className={cn('flex flex-col gap-1.5', i > 0 && 'ml-3 border-l border-sv2-border pl-3')}>
            <span className="px-2 text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">{grupo}</span>
            <ul className="flex items-center gap-0.5">
              {SECCIONES_SUPPLY_V2.filter((s) => s.grupo === grupo).map((s) => {
                const activo = s.slug === activa
                const contador = contadores?.[s.slug]
                return (
                  <li key={s.slug}>
                    <Link
                      href={hrefSupplyV2(s.slug)}
                      aria-current={activo ? 'page' : undefined}
                      className={cn(
                        'relative flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2 py-1.5 text-[14px] leading-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sv2-accent focus-visible:ring-offset-1',
                        activo
                          ? 'bg-sv2-primary-fixed font-semibold text-sv2-primary after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-sv2-accent'
                          : 'font-medium text-foreground/80 hover:bg-sv2-soft hover:text-foreground'
                      )}
                    >
                      <span>{s.label}</span>
                      {contador && contador.valor > 0 && (
                        <span
                          className={cn(
                            'rounded-full px-1.5 text-[12px] font-semibold tabular-nums leading-4',
                            contador.tono === 'exito' ? 'bg-sv2-secondary-container text-sv2-on-secondary-container' : activo ? 'bg-card text-sv2-primary' : 'bg-sv2-soft text-foreground'
                          )}
                        >
                          {contador.valor.toLocaleString('es-DO')}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )
}
