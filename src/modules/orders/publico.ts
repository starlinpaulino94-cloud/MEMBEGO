import { sinEmpresa } from '@/lib/tenant'
import { tieneCapacidad } from '@/modules/capacidades/resolver'

/**
 * COMMERCE CORE · pedidos — lo que la vitrina pública necesita saber (Fase 3).
 *
 * Una empresa recibe pedidos si tiene las DOS capacidades (el catálogo, de donde
 * salen las variantes, y los pedidos) y está publicada y activa. Esto SOLO
 * decide si se enseña el formulario «Pedir» y qué sucursales ofrece; la acción
 * que crea el pedido lo comprueba otra vez, por su cuenta.
 */

export interface OpcionesDePedido {
  habilitado: boolean
  sucursales: { id: string; nombre: string }[]
}

const SIN_PEDIDOS: OpcionesDePedido = { habilitado: false, sucursales: [] }

/** ¿Esta empresa (por id) recibe pedidos Membego? Fail-closed. */
export async function empresaRecibePedidos(companyId: string): Promise<boolean> {
  const [catalogo, pedidos] = await Promise.all([tieneCapacidad(companyId, 'CATALOGO_UNIFICADO'), tieneCapacidad(companyId, 'PEDIDOS_MEMBEGO')])
  return catalogo && pedidos
}

/** Las opciones de pedido de una empresa pública (por slug). */
export async function opcionesDePedidoPublico(companySlug: string): Promise<OpcionesDePedido> {
  if (!companySlug) return SIN_PEDIDOS
  try {
    const empresa = await sinEmpresa('marketplace: ¿recibe pedidos esta empresa pública?', (tx) =>
      tx.company.findFirst({
        where: { slug: companySlug, isPublished: true, isActive: true, esDemo: false },
        select: { id: true, sucursales: { where: { activa: true }, select: { id: true, nombre: true }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }] } },
      })
    )
    if (!empresa || empresa.sucursales.length === 0) return SIN_PEDIDOS
    if (!(await empresaRecibePedidos(empresa.id))) return SIN_PEDIDOS
    return { habilitado: true, sucursales: empresa.sucursales }
  } catch (e) {
    console.error('[opcionesDePedidoPublico]', e)
    return SIN_PEDIDOS
  }
}
