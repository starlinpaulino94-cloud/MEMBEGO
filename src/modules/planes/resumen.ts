import { plural } from '@/lib/plural'

/**
 * PLANES · una línea que dice qué es el plan. Núcleo puro, sin Prisma ni React.
 *
 * Nace para el feed de Novedades, donde una membresía tiene UNA línea para
 * explicarse y compite con promociones que enseñan su descuento. «Plan Premium»
 * a secas no ayuda a decidir; «4 lavados · 30 días» sí.
 *
 * Existe aparte porque el mismo texto se compone hoy a mano en cinco sitios
 * (`PlanesGrid`, `CatalogoPlanesGlobal`, `CompanyProfile`, los dos del
 * escáner), cada uno con su propia redacción. No se tocan aquí —cambiar cinco
 * pantallas no es parte de esta tarea— pero el sitio donde unificarlas ya
 * existe y esto es lo que hay que reutilizar en el siguiente que se toque.
 */

/**
 * «Ilimitado · 30 días» · «4 lavados · 30 días» · «30 días».
 *
 * `null` nunca: una membresía sin usos declarados sigue teniendo vigencia, y
 * enseñar la línea vacía dejaría la fila coja al lado de las promociones.
 */
export function resumenDePlan(
  esIlimitado: boolean,
  usosIncluidos: number,
  vigenciaDias: number
): string {
  const vigencia = plural(vigenciaDias, 'día', 'días')
  if (esIlimitado) return `Ilimitado · ${vigencia}`
  // Cero usos y no ilimitado es un plan de solo vigencia (acceso, descuentos).
  // Decir «0 lavados» sería describirlo como algo que no da nada.
  if (usosIncluidos <= 0) return vigencia
  return `${plural(usosIncluidos, 'uso', 'usos')} · ${vigencia}`
}
