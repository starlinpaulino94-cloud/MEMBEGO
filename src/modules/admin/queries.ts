import { membresiaVigente } from '@/modules/membresia/vigencia'
import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import type { SessionUser } from '@/types'

/**
 * Métricas de cabecera del panel de empresa.
 *
 * AQUÍ VIVÍA EL MOTOR DE REPORTES VIEJO (`getReportesAdmin`,
 * `getReportesGlobales`), y se retiró entero. No es limpieza cosmética: era el
 * segundo motor de reportes del sistema y el que daba las cifras equivocadas
 * —fechaba los cobros con dos reglas distintas dentro de la misma función,
 * cortaba el mes en la zona horaria del servidor, contaba «por vencer» midiendo
 * el largo de una lista truncada y metía las empresas de práctica en los
 * totales de la plataforma—.
 *
 * Todo eso lo hace ahora `modules/reportes/`, que ya era el motor bueno y solo
 * lo usaba una de las tres pantallas. Dejar el viejo aquí «por si acaso»
 * garantizaba que alguien lo volviera a llamar.
 */

/** companyId filter: superadmin gets undefined (all), admin gets their company. */
export function companyFilter(user: SessionUser): string | undefined {
  if (user.metadata.role === 'SUPERADMIN') return undefined
  return user.metadata.companyId ?? '__none__'
}

/** Query de una empresa, o de todas si `companyId` es undefined (superadmin). */
function scopeEmpresa<T>(
  companyId: string | undefined,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  if (companyId) return conEmpresa(companyId, fn)
  return sinEmpresa('reportes del superadmin: cruza todas las empresas', fn)
}

export async function adminMetrics(user: SessionUser) {
  const companyId = companyFilter(user)
  return scopeEmpresa(companyId, async (tx) => {
    const clienteWhere = companyId ? { companyId } : {}
    // Filtro directo por memberships.companyId (indexado); antes se filtraba
    // vía cliente.companyId, forzando un JOIN innecesario.
    const membershipWhere = companyId ? { companyId } : {}
    const visitWhere = companyId ? { cliente: { companyId } } : {}

    const safeCount = (p: Promise<number>) => p.catch(() => 0)

    const [totalClientes, activas, pendientes, visitasHoy] = await Promise.all([
      safeCount(tx.cliente.count({ where: clienteWhere })),
      safeCount(tx.membership.count({
        where: { ...membershipWhere, ...membresiaVigente() },
      })),
      safeCount(tx.membership.count({
        where: { ...membershipWhere, estado: 'PENDIENTE' },
      })),
      safeCount(tx.visit.count({
        where: {
          ...visitWhere,
          fechaVisita: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      })),
    ])

    return { totalClientes, activas, pendientes, visitasHoy }
  })
}
