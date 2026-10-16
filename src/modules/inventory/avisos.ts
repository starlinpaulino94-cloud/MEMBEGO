import 'server-only'

import { conEmpresa } from '@/lib/tenant'
import { zonaSegura } from '@/lib/zona-horaria'
import { diaLocal } from '@/modules/reportes/rango'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { AUTOMATION_EVENTS } from '@/lib/automation/domain/events'
import { disponible, estadoDeStock } from './domain'
import { nombreCompleto } from './formato'
import { avisoPorVencer, avisoVencidos, semanaIso } from './vencimientos'
import { resumenVencimientosEnTx } from './vencimientos-queries'

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
 *  · Un aviso por nivel, estado y día (`dedupeKey`): el tercer pedido del día no
 *    vuelve a sonar la campana por el mismo producto. El estado va en la clave a
 *    propósito: si por la mañana avisó «Stock bajo» y por la tarde el producto se
 *    AGOTA, esa escalada tiene que avisar otra vez; con una sola clave por día
 *    quedaba callada justo cuando más importa.
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
        notificarAdmins(companyId, { tipo: 'SISTEMA', titulo, mensaje, href: `/admin/inventario/${n.variant.id}`, dedupeKey: `stock-bajo:${n.id}:${dia}:${estado}` }),
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

/**
 * COMMERCE CORE · inventario — INV-5b1: AVISO DE LOTES POR VENCER Y VENCIDOS. Lo llama el barrido diario, empresa por empresa.
 *
 * Dos avisos, los dos a los administradores de la empresa y los dos sin repetirse:
 *  · POR VENCER: hay lotes con existencias vendibles que vencen dentro de la ventana (30 días). A lo sumo uno por semana ISO y por
 *    nivel de urgencia (`dedupeKey`): el nivel va en la clave a propósito, igual que el estado en el de stock bajo, porque si el lunes
 *    avisó «por vencer» y el jueves un lote pasa a vencer en menos de una semana, esa escalada tiene que avisar otra vez.
 *  · VENCIDOS: el barrido acaba de sacar de lo vendible unidades de lotes vencidos (`vencidos`). Uno por día: una segunda pasada del
 *    mismo día no encuentra nada que sacar y no avisa.
 *
 * Solo cuenta lotes con fecha de vencimiento y existencias. Una empresa que no lleva lotes no recibe nada. Best-effort y FUERA de
 * cualquier transacción de inventario: nunca lanza.
 */
export async function avisarVencimientos(companyId: string, opciones: { ahora?: Date; vencidos?: { lotes: number; unidades: number } } = {}): Promise<number> {
  try {
    const ahora = opciones.ahora ?? new Date()
    const { zona, resumen } = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      return { zona, resumen: await resumenVencimientosEnTx(tx, companyId, { zonaHoraria: zona, ahora }) }
    })
    const dia = diaLocal(ahora, zona)
    let avisados = 0
    if (resumen.llevaLotes && resumen.porVencer.lotes > 0) {
      const a = avisoPorVencer({ lotes: resumen.porVencer.lotes, urgentes: resumen.porVencer.urgentes, unidades: resumen.porVencer.unidades, dias: resumen.dias })
      const nivel = resumen.porVencer.urgentes > 0 ? 'urgente' : 'normal'
      const n = await notificarAdmins(companyId, {
        tipo: 'SISTEMA',
        titulo: a.titulo,
        mensaje: a.mensaje,
        href: '/admin/inventario/reportes/vencimientos',
        dedupeKey: `lotes-por-vencer:${companyId}:${semanaIso(dia)}:${nivel}`,
      })
      if (n > 0) avisados++
    }
    const v = opciones.vencidos
    if (v && v.unidades > 0) {
      const a = avisoVencidos(v)
      const n = await notificarAdmins(companyId, {
        tipo: 'SISTEMA',
        titulo: a.titulo,
        mensaje: a.mensaje,
        href: '/admin/inventario/reportes/mermas?motivo=EXPIRED',
        dedupeKey: `lotes-vencidos:${companyId}:${dia}`,
      })
      if (n > 0) avisados++
    }
    return avisados
  } catch (e) {
    console.error('[inventario:vencimientos]', e instanceof Error ? e.message : e)
    return 0
  }
}
