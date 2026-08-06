/**
 * Analytics del Transaction Engine (Fase E4). Métricas agregadas por empresa
 * sobre la tabla oficial de transacciones: volumen, top servicios/promos/
 * beneficios/empleados, promedios, cancelaciones, reversiones, reimpresiones
 * y tiempo promedio de atención.
 */

import { conEmpresa } from '@/lib/tenant'
import type { Tx } from '@/lib/tenant'

export interface TransactionAnalytics {
  total: number
  aplicadas: number
  canceladas: number
  revertidas: number
  errores: number
  reimpresiones: number
  promedioDiario: number
  promedioMensual: number
  tiempoPromedioMs: number | null
  topServicios: { nombre: string; usos: number }[]
  topPromociones: { nombre: string; usos: number }[]
  topBeneficios: { nombre: string; usos: number }[]
  topEmpleados: { nombre: string; usos: number }[]
}

/** Top-N por clave del snapshot JSON (servicio/promoción/beneficio/empleado). */
async function topSnapshot(
  tx: Tx,
  companyId: string,
  desde: Date,
  campo: 'servicio' | 'promocion' | 'beneficio' | 'empleado',
  limit = 5
): Promise<{ nombre: string; usos: number }[]> {
  const rows = await tx.$queryRaw<{ nombre: string; usos: bigint }[]>`
    SELECT "snapshot"->>${campo} AS nombre, COUNT(*) AS usos
      FROM "transactions"
     WHERE "companyId" = ${companyId}
       AND "createdAt" >= ${desde}
       AND "estado" = 'APPLIED'
       AND "snapshot"->>${campo} IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}
  `
  return rows.map((r) => ({ nombre: r.nombre, usos: Number(r.usos) }))
}

export async function getTransactionAnalytics(
  companyId: string,
  { dias = 30 }: { dias?: number } = {}
): Promise<TransactionAnalytics> {
  return conEmpresa(companyId, async (tx) => {
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
    const where = { companyId, createdAt: { gte: desde } }

    const [total, aplicadas, canceladas, revertidas, errores, reimpresiones, tiempo] =
      await Promise.all([
        tx.transaction.count({ where }),
        tx.transaction.count({ where: { ...where, estado: 'APPLIED' } }),
        tx.transaction.count({ where: { ...where, estado: 'CANCELLED' } }),
        tx.transaction.count({ where: { ...where, estado: 'REVERTED' } }),
        tx.transaction.count({ where: { ...where, estado: 'ERROR' } }),
        tx.receiptImpresion.count({
          where: { esCopia: true, transaction: { companyId, createdAt: { gte: desde } } },
        }),
        tx.transaction.aggregate({
          where: { ...where, executionMs: { not: null } },
          _avg: { executionMs: true },
        }),
      ])

    const [topServicios, topPromociones, topBeneficios, topEmpleados] = await Promise.all([
      topSnapshot(tx, companyId, desde, 'servicio'),
      topSnapshot(tx, companyId, desde, 'promocion'),
      topSnapshot(tx, companyId, desde, 'beneficio'),
      topSnapshot(tx, companyId, desde, 'empleado'),
    ])

    return {
      total,
      aplicadas,
      canceladas,
      revertidas,
      errores,
      reimpresiones,
      promedioDiario: dias > 0 ? Math.round((total / dias) * 10) / 10 : total,
      promedioMensual: dias > 0 ? Math.round((total / dias) * 30) : total,
      tiempoPromedioMs: tiempo._avg.executionMs ? Math.round(tiempo._avg.executionMs) : null,
      topServicios,
      topPromociones,
      topBeneficios,
      topEmpleados,
    }
  })
}
