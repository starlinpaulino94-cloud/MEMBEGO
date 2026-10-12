import 'server-only'

import { conEmpresa } from '@/lib/tenant'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { AUTOMATION_EVENTS } from '@/lib/automation/domain/events'
import { disponible, estadoDeStock } from './domain'
import { nombreCompleto } from './formato'

/**
 * COMMERCE CORE · inventario — AVISO DE STOCK BAJO.
 *
 * El umbral (`lowStockThreshold`) ya existía y la lista de Inventario ya lo
 * pintaba, pero nadie se enteraba sin entrar a mirar. Esto avisa a los
 * administradores de la empresa cuando, tras apartar o vender, una variante
 * queda en o por debajo de su umbral en una sucursal, y emite el evento
 * `inventario.stock_bajo` para automatizaciones y webhooks.
 *
 * Reglas:
 *  · Solo niveles con umbral > 0 (sin umbral, la empresa no pidió aviso).
 *  · Un aviso por nivel y día (`dedupeKey`): el tercer pedido del día no
 *    vuelve a sonar la campana por el mismo producto.
 *  · Best-effort y FUERA de la transacción del pedido: nunca lanza.
 */
export async function avisarStockBajo(companyId: string, varianteIds: readonly string[], ahora = new Date()): Promise<number> {
  if (varianteIds.length === 0) return 0
  try {
    const niveles = await conEmpresa(companyId, (tx) =>
      tx.inventoryLevel.findMany({
        where: { companyId, catalogVariantId: { in: [...varianteIds] }, lowStockThreshold: { gt: 0 }, location: { activa: true } },
        select: {
          id: true,
          onHand: true,
          reserved: true,
          lowStockThreshold: true,
          location: { select: { nombre: true } },
          variant: { select: { id: true, name: true, isDefault: true, item: { select: { name: true } } } },
        },
      })
    )
    const dia = ahora.toISOString().slice(0, 10)
    let avisados = 0
    for (const n of niveles) {
      const estado = estadoDeStock(n)
      if (estado === 'OK') continue
      const quedan = disponible(n)
      const nombre = nombreCompleto(n.variant.item.name, n.variant.name, n.variant.isDefault)
      const titulo = estado === 'AGOTADO' ? 'Producto agotado' : 'Stock bajo'
      const mensaje =
        estado === 'AGOTADO'
          ? `«${nombre}» se agotó en ${n.location.nombre}. Los clientes lo ven como «Agotado» hasta que entres existencias.`
          : `«${nombre}» tiene ${quedan} ${quedan === 1 ? 'unidad' : 'unidades'} en ${n.location.nombre} (avisas en ${n.lowStockThreshold}).`
      const [r] = await Promise.allSettled([
        notificarAdmins(companyId, { tipo: 'SISTEMA', titulo, mensaje, href: `/admin/inventario/${n.variant.id}`, dedupeKey: `stock-bajo:${n.id}:${dia}` }),
        emitirEventoEstrategia({
          companyId,
          type: AUTOMATION_EVENTS.INVENTORY_LOW_STOCK,
          subjectId: n.variant.id,
          payload: { producto: nombre, sucursal: n.location.nombre, disponible: quedan, umbral: n.lowStockThreshold, estado },
        }),
      ])
      if (r.status === 'fulfilled' && typeof r.value === 'number' && r.value > 0) avisados++
    }
    return avisados
  } catch (e) {
    console.error('[inventario:stock-bajo]', e instanceof Error ? e.message : e)
    return 0
  }
}
