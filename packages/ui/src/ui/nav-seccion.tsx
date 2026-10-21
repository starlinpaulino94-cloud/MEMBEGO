import type { ReactNode } from 'react'
import { TabsNav } from './tabs-nav'

export interface PestanaSeccion {
  etiqueta: string
  /** La ruta REAL de la pestaña: cada una conserva su URL (docs/auditoria-admin/03 · D, paso 1). */
  href: string
  activa?: boolean
  /** Contador a la derecha (pendientes, alertas). `null` o ausente = sin contador. */
  cuenta?: number | string | null
  /**
   * La sección de permisos que da acceso a esta pestaña (`ADMIN_SECTIONS`). `NavSeccion` NO decide permisos: la página los
   * resuelve una vez y filtra con `pestanasVisibles` ANTES de pintar. Que la pestaña declare su sección es lo que permite
   * probar que ninguna pestaña quedó sin guarda (V-G2).
   */
  seccion?: string
}

/**
 * Las pestañas visibles para quien las pide: las que no declaran sección y las que `permitida` acepta. Una entrada de módulo
 * se muestra si le queda al menos una pestaña visible y aterriza en la primera (03 · C.3).
 *
 * La visibilidad es cosmética: la barrera sigue siendo la guarda de servidor de cada ruta (`requireSection`).
 */
export function pestanasVisibles<T extends Pick<PestanaSeccion, 'seccion'>>(
  pestanas: readonly T[],
  permitida: (seccion: string) => boolean
): T[] {
  return pestanas.filter((p) => !p.seccion || permitida(p.seccion))
}

/** Cómo pintar el enlace de una pestaña. El design system no depende del router: la página pasa su `<Link>`. */
export type EnlacePestana = (props: {
  href: string
  className: string
  children: ReactNode
  'aria-current'?: 'page'
}) => ReactNode

/**
 * Pestañas de módulo: rutas reales, una activa con `aria-current="page"`, desplazamiento horizontal en móvil (10 §6).
 *
 * Es `TabsNav` con el contrato del panel: cada pestaña lleva su `href` y su sección, y el enlace lo pone quien la usa.
 * Sustituye a `CrmTabs`, `ExcursionesTabs` y `VendedorTabs`, que repiten el mismo código de 25 líneas (07 · FE-06).
 *
 *   <NavSeccion aria-label="Secciones de Pagos" items={pestanasVisibles(PESTANAS, permitida)}
 *               enlace={({ href, ...p }) => <Link href={href} {...p} />} />
 */
export function NavSeccion({
  items,
  enlace,
  className,
  'aria-label': ariaLabel = 'Secciones del módulo',
}: {
  items: readonly PestanaSeccion[]
  enlace: EnlacePestana
  className?: string
  'aria-label'?: string
}) {
  return (
    <TabsNav
      aria-label={ariaLabel}
      className={className}
      items={items.map((p) => ({
        label: p.etiqueta,
        badge: p.cuenta ?? null,
        active: p.activa,
        render: (props) => enlace({ ...props, href: p.href }),
      }))}
    />
  )
}
