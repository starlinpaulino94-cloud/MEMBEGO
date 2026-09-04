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

/**
 * LA EMPRESA QUE ESTÁ ABIERTA EN EL PANEL. No es lo mismo que `companyFilter`.
 *
 * `companyFilter` responde «¿sobre qué empresas consulto?» y para un superadmin
 * dice `undefined`, que significa TODAS. Eso es correcto para un agregado de
 * plataforma y es un desastre para una pantalla de una sola empresa: el
 * superadmin elegía CARTOWN en el conmutador de arriba y la pantalla le
 * respondía «elige una empresa en el conmutador de arriba». Un callejón sin
 * salida — hiciera lo que hiciera, la respuesta no cambiaba.
 *
 * Esta función responde otra pregunta: «¿qué empresa tiene abierta?». El
 * conmutador escribe esa elección en `User.companyId` para todo el mundo,
 * superadmin incluido, así que el dato siempre estuvo ahí.
 *
 * Seis pantallas ya lo resolvían escribiendo a mano
 * `companyFilter(user) ?? user.metadata.companyId ?? null`, y cuatro se
 * quedaron sin ello. Un idioma que hay que recordar se olvida; uno con nombre,
 * no. `'__none__'` —el centinela que `companyFilter` usa para no filtrar por
 * nada— se traduce a `null`, que es lo que significa.
 */
export function empresaDelPanel(user: SessionUser): string | null {
  const id = user.metadata.companyId
  return id && id !== '__none__' ? id : null
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
