import { conEmpresa } from '@/lib/tenant'
import { getCapacidadesEmpresa } from '@/modules/capacidades/resolver'
import { estadoDeStock } from '@/modules/inventory/domain'

/**
 * COMERCIO · lo que el DASHBOARD de la empresa enseña de su actividad comercial
 * en Membego. Una sola lectura, barata, con lo que mueve a actuar hoy: pedidos
 * que esperan, pedidos en curso, ventas del mes, productos con stock bajo,
 * ofertas activas y canjes. Nada estimado; todo sale de las tablas de
 * Commerce Core. Si la empresa tiene los módulos apagados, devuelve null y el
 * dashboard no pinta la fila.
 */
export interface ResumenComercio {
  moneda: string
  /** Pedidos que esperan la respuesta de la empresa (AWAITING_MERCHANT). */
  pedidosNuevos: number
  /** Pedidos aceptados o listos que aún no se recogieron. */
  pedidosEnCurso: number
  /** Suma de pedidos COMPLETADOS en lo que va del mes (zona horaria de la empresa). */
  ventasMes: string
  pedidosCompletadosMes: number
  /** Productos publicados en el catálogo (ACTIVE). */
  productosPublicados: number
  productosTotal: number
  /** Variantes con stock bajo o agotado en alguna sucursal activa (solo con umbral configurado). */
  stockBajo: number
  ofertasActivas: number
  /** Ofertas canjeadas (QR) en lo que va del mes. */
  canjesMes: number
  /** Qué módulos tiene encendidos, para pintar solo los enlaces que existen. */
  modulos: { catalogo: boolean; pedidos: boolean; ofertas: boolean }
}

function inicioDeMes(ahora: Date, timeZone: string): Date {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(ahora)
  const y = partes.find((p) => p.type === 'year')?.value
  const m = partes.find((p) => p.type === 'month')?.value
  // El primer día del mes local, a medianoche; la diferencia con UTC es de horas y aquí no decide nada.
  return new Date(`${y}-${m}-01T00:00:00.000Z`)
}

export async function resumenComercioEmpresa(companyId: string, timeZone = 'America/Santo_Domingo', ahora = new Date()): Promise<ResumenComercio | null> {
  const caps = await getCapacidadesEmpresa(companyId).catch(() => null)
  // Sin lectura (fallo) no se filtra: el dashboard enseña la fila y la puerta la pone cada página.
  const tiene = (c: string) => caps == null || (caps.activas as readonly string[]).includes(c)
  const modulos = { catalogo: tiene('CATALOGO_UNIFICADO'), pedidos: tiene('PEDIDOS_MEMBEGO'), ofertas: tiene('DEALS_MARKETPLACE') }
  if (!modulos.catalogo && !modulos.pedidos && !modulos.ofertas) return null

  const desde = inicioDeMes(ahora, timeZone)
  const r = await conEmpresa(companyId, async (tx) => {
    const [empresa, nuevos, enCurso, completados, productosTotal, productosPublicados, niveles, ofertasActivas, canjesMes] = await Promise.all([
      tx.company.findUnique({ where: { id: companyId }, select: { moneda: true } }),
      modulos.pedidos ? tx.membegoOrder.count({ where: { companyId, status: 'AWAITING_MERCHANT' } }) : 0,
      modulos.pedidos ? tx.membegoOrder.count({ where: { companyId, status: { in: ['IN_PROGRESS', 'READY'] } } }) : 0,
      modulos.pedidos
        ? tx.membegoOrder.aggregate({ where: { companyId, status: 'COMPLETED', completedAt: { gte: desde } }, _sum: { total: true }, _count: { _all: true } })
        : null,
      modulos.catalogo ? tx.catalogItem.count({ where: { companyId, status: { not: 'ARCHIVED' } } }) : 0,
      modulos.catalogo ? tx.catalogItem.count({ where: { companyId, status: 'ACTIVE' } }) : 0,
      modulos.catalogo
        ? tx.inventoryLevel.findMany({
            where: { companyId, lowStockThreshold: { gt: 0 }, location: { activa: true }, variant: { status: { not: 'DISCONTINUED' }, item: { status: { not: 'ARCHIVED' } } } },
            select: { onHand: true, reserved: true, lowStockThreshold: true },
          })
        : [],
      modulos.ofertas ? tx.deal.count({ where: { companyId, status: 'ACTIVE' } }) : 0,
      modulos.ofertas ? tx.dealClaim.count({ where: { companyId, status: 'REDEEMED', redeemedAt: { gte: desde } } }) : 0,
    ])
    return { empresa, nuevos, enCurso, completados, productosTotal, productosPublicados, niveles, ofertasActivas, canjesMes }
  })

  return {
    moneda: r.empresa?.moneda ?? 'DOP',
    pedidosNuevos: r.nuevos,
    pedidosEnCurso: r.enCurso,
    ventasMes: (r.completados?._sum.total?.toNumber() ?? 0).toFixed(2),
    pedidosCompletadosMes: r.completados?._count._all ?? 0,
    productosPublicados: r.productosPublicados,
    productosTotal: r.productosTotal,
    stockBajo: r.niveles.filter((n) => estadoDeStock(n) !== 'OK').length,
    ofertasActivas: r.ofertasActivas,
    canjesMes: r.canjesMes,
    modulos,
  }
}
