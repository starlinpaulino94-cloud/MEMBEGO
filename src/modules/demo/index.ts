import { prisma } from '@/lib/prisma'

/**
 * EMPRESAS DE DEMOSTRACIÓN — la política, en un solo archivo.
 *
 * PARA QUÉ SIRVEN: entrenar al personal haciendo el procedimiento COMPLETO,
 * con clientes que se registran por el enlace de la empresa, compras, cobros y
 * canjes. Todo el recorrido real, ninguna consecuencia real.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE ORDENA TODO: una empresa demo se comporta igual que una real
 * HACIA ADENTRO y no existe HACIA AFUERA.
 *
 * Hacia adentro (lo que ve quien entrena) todo funciona: promociones,
 * membresías, QR, pista, caja, reportes. Si algo se comportara distinto, el
 * entrenamiento enseñaría un sistema que no es el que van a usar.
 *
 * Hacia afuera se corta en CUATRO puntos, y cada uno responde a un daño
 * concreto:
 *
 *   1. PASARELA DE PAGO REAL → apagada. Es el único punto donde el dinero de
 *      alguien puede moverse de verdad. Una tarjeta cobrada en un
 *      entrenamiento es un cobro real que hay que devolver.
 *   2. CORREOS SALIENTES → no salen. Un correo de "tu membresía venció"
 *      llegando a una persona real desde una empresa inventada es confuso en
 *      el mejor caso y dañino en el peor.
 *   3. VITRINA PÚBLICA → no aparece. Un cliente real no puede tropezarse con
 *      la empresa de práctica y creer que le va a lavar el carro.
 *   4. MÉTRICAS DE PLATAFORMA → aparte. Si los 40 clientes inventados de un
 *      entrenamiento suman a "clientes totales", el número deja de servir para
 *      tomar decisiones — y nadie se entera de que dejó de servir.
 *
 * Las notificaciones INTERNAS (campanita) sí funcionan: son parte de lo que el
 * personal tiene que aprender a ver, y no salen de la aplicación.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Filtro para excluir lo de demo de cualquier consulta de plataforma. */
export const SIN_DEMO = { esDemo: false } as const

/**
 * ¿Esta empresa es de demostración?
 *
 * Fail-CLOSED a propósito, al revés que casi todo lo demás del sistema: si no
 * se puede leer la empresa, se asume que NO es demo. Equivocarse hacia "no es
 * demo" deja el sistema como estaba; equivocarse hacia "sí es demo" apagaría
 * la pasarela de una empresa real que sí necesita cobrar.
 */
export async function esEmpresaDemo(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false
  try {
    const c = await prisma.company.findUnique({
      where: { id: companyId },
      select: { esDemo: true },
    })
    return c?.esDemo === true
  } catch {
    // Columna sin migrar: nadie es demo todavía.
    return false
  }
}

/**
 * Nombre de la empresa si es de demostración, `null` si no lo es.
 *
 * Una sola consulta para las dos preguntas que hace el layout: ¿pongo el aviso?
 * y ¿qué nombre pongo en él? Preguntarlas por separado costaría dos viajes a la
 * base en CADA clic de la aplicación.
 */
export async function nombreSiEsDemo(
  companyId: string | null | undefined
): Promise<string | null> {
  if (!companyId) return null
  try {
    const c = await prisma.company.findUnique({
      where: { id: companyId },
      select: { esDemo: true, name: true },
    })
    return c?.esDemo === true ? c.name : null
  } catch {
    return null
  }
}

/** Ids de las empresas demo. Para separar métricas sin N+1. */
export async function idsEmpresasDemo(): Promise<string[]> {
  try {
    const filas = await prisma.company.findMany({
      where: { esDemo: true },
      select: { id: true },
    })
    return filas.map((f) => f.id)
  } catch {
    return []
  }
}

export interface ResumenDemo {
  id: string
  name: string
  slug: string
  clientes: number
  createdAt: Date
  /** Enlace de registro que se le pasa a quien entrena. */
  enlaceRegistro: string
}

/** Empresas de demostración con su enlace de registro. */
export async function getEmpresasDemo(baseUrl: string): Promise<ResumenDemo[]> {
  try {
    const empresas = await prisma.company.findMany({
      where: { esDemo: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        _count: { select: { clientes: true } },
      },
    })
    return empresas.map((e) => ({
      id: e.id,
      name: e.name,
      slug: e.slug,
      clientes: e._count.clientes,
      createdAt: e.createdAt,
      enlaceRegistro: `${baseUrl.replace(/\/$/, '')}/registro/${e.slug}`,
    }))
  } catch {
    return []
  }
}

/**
 * Qué se borraría al reiniciar una empresa de demostración.
 *
 * Se cuenta ANTES de borrar y se le enseña a quien va a apretar el botón. Un
 * borrado que no dice cuánto se lleva por delante es un borrado que un día se
 * ejecuta sobre la empresa equivocada.
 */
export interface InventarioDemo {
  clientes: number
  membresias: number
  compras: number
  transacciones: number
  colaVehiculos: number
  incidencias: number
  turnos: number
}

export async function contarDatosDemo(companyId: string): Promise<InventarioDemo> {
  const cero = async () => 0
  const [
    clientes,
    membresias,
    compras,
    transacciones,
    colaVehiculos,
    incidencias,
    turnos,
  ] = await Promise.all([
    prisma.cliente.count({ where: { companyId } }).catch(cero),
    prisma.membership.count({ where: { companyId } }).catch(cero),
    prisma.productoCompra.count({ where: { companyId } }).catch(cero),
    prisma.transaction.count({ where: { companyId } }).catch(cero),
    prisma.colaVehiculo.count({ where: { companyId } }).catch(cero),
    prisma.incidencia.count({ where: { companyId } }).catch(cero),
    prisma.turno.count({ where: { companyId } }).catch(cero),
  ])
  return { clientes, membresias, compras, transacciones, colaVehiculos, incidencias, turnos }
}
