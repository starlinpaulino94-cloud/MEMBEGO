import { membresiaVigente } from '@/modules/membresia/vigencia'
import { conEmpresa, type Tx } from '@/lib/tenant'

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

/**
 * Métricas de UNA empresa. El `companyId` lo entrega `requireCompanyContext`:
 * el rol nunca decide el alcance y la ausencia de empresa redirige en vez de
 * abrir una vista global dentro de /admin.
 */
export async function adminMetrics(companyId: string) {
  return conEmpresa(companyId, async (tx: Tx) => {
    // Filtro directo por memberships.companyId (indexado); antes se filtraba
    // vía cliente.companyId, forzando un JOIN innecesario.
    const membershipWhere = { companyId }
    const visitWhere = { cliente: { companyId } }

    const safeCount = (p: Promise<number>) => p.catch(() => 0)

    const [totalClientes, activas, pendientes, visitasHoy] = await Promise.all([
      safeCount(tx.cliente.count({ where: { companyId } })),
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
