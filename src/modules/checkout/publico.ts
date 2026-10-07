import { sinEmpresa } from '@/lib/tenant'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { getCuentasTransferencia } from '@/modules/pagos/metodosDisponibles'
import { empresaRecibePedidos } from '@/modules/orders/publico'

/**
 * MARKETPLACE CHECKOUT · lo que la página de pago necesita saber de un negocio público (Fase 8).
 *
 * «Transferencia» solo se ofrece si el negocio tiene el método encendido Y al menos una cuenta activa donde
 * transferir: ofrecer una transferencia sin decir adónde es una trampa. La acción de pagar lo comprueba otra
 * vez, por su cuenta (`hacerCheckout`).
 */

export interface OpcionesDeCheckout {
  companyId: string
  nombre: string
  slug: string
  sucursales: { id: string; nombre: string }[]
  transferencia: boolean
}

/** ¿Este negocio (por id) admite pagar por transferencia ahora mismo? Fail-closed. */
export async function transferenciaDisponible(companyId: string): Promise<boolean> {
  const encendida = await tieneCapacidad(companyId, 'PAGO_TRANSFERENCIA').catch(() => false)
  if (!encendida) return false
  return (await getCuentasTransferencia(companyId)).length > 0
}

/** Las opciones de pago de un negocio publicado que recibe pedidos, o `null` si no (o no existe: se ven igual). */
export async function opcionesDeCheckout(companySlug: string): Promise<OpcionesDeCheckout | null> {
  if (!companySlug) return null
  try {
    const e = await sinEmpresa('checkout: empresa pública de la página de pago (por slug)', (tx) =>
      tx.company.findFirst({
        where: { slug: companySlug, isPublished: true, isActive: true, esDemo: false },
        select: { id: true, slug: true, name: true, sucursales: { where: { activa: true }, select: { id: true, nombre: true }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }] } },
      })
    )
    if (!e || e.sucursales.length === 0 || !(await empresaRecibePedidos(e.id))) return null
    return { companyId: e.id, nombre: e.name, slug: e.slug, sucursales: e.sucursales, transferencia: await transferenciaDisponible(e.id) }
  } catch (err) {
    console.error('[opcionesDeCheckout]', err)
    return null
  }
}
