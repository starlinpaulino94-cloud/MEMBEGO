import 'server-only'

import type { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { promocionVigente } from '@/modules/promociones/vigencia'
import { POR_PAGINA, type FiltroOperaciones } from './filtros'

/**
 * OPERACIONES POR EMPRESA — qué tiene montado cada negocio.
 *
 * Lo que cambia respecto a lo que hacía la página:
 *
 *  1. «PROMOCIONES ACTIVAS» AHORA SIGNIFICA VIGENTES. Se contaba `activo: true`
 *     y nada más, cuando `Promocion` tiene además `vigenciaDesde`,
 *     `vigenciaHasta` y `archivada`. Contaba como activas las caducadas hace
 *     meses, las programadas para el futuro y —en el total— las archivadas.
 *     Ahora pasa por `promocionVigente()`, la definición única, cuyo propio
 *     comentario avisa de que ya hubo dos definiciones y una era falsa.
 *
 *  2. LAS REGLAS SE CUENTAN ENCENDIDAS. `ReglaRecompensa.activo` existe —hay
 *     hasta un índice `[companyId, activo]`— y no se filtraba: tres reglas
 *     apagadas figuraban igual que tres funcionando.
 *
 *  3. SE PUEDE PREGUNTAR POR LO QUE FALTA. Es la razón de ser de la pantalla y
 *     había que leer las cuarenta tarjetas a ojo. Se resuelve con filtros de
 *     relación (`none`), en la base, no descartando en memoria.
 */

export interface OperacionEmpresa {
  id: string
  name: string
  /** Vertical REAL: `tipoNegocioCodigo` si está, si no el `type` histórico. */
  verticalCodigo: string
  verticalNombre: string
  esDemo: boolean
  isActive: boolean
  isPublished: boolean
  /** Promociones que un cliente puede ver HOY. */
  promosVigentes: number
  /** Promociones sin archivar, vigentes o no. */
  promosTotal: number
  referidosCompletados: number
  /** Completados en los últimos 30 días: lo que dice si esto sigue vivo. */
  referidosMes: number
  reglasActivas: number
  whatsapp: { numero: string; activo: boolean } | null
}

export interface ListadoOperaciones {
  filas: OperacionEmpresa[]
  total: number
  totalAmbito: number
  /** Cuántas empresas del ámbito no tienen cada cosa. Los avisos de arriba. */
  faltan: { whatsapp: number; promociones: number; reglas: number }
}

/** El `where` del ámbito: qué empresas entran. */
function whereAmbito(f: FiltroOperaciones): Prisma.CompanyWhereInput[] {
  if (f.ambito === 'todas') return []
  return [{ esDemo: f.ambito === 'practica' }]
}

/**
 * Los filtros de AUSENCIA, resueltos en la base.
 *
 * `none` es la clave: «ninguna promoción que cumpla la vigencia» no es lo mismo
 * que «ninguna promoción». Una empresa con diez promociones caducadas está
 * exactamente igual de vacía de cara al cliente que una sin ninguna, y ésa es
 * la pregunta que se está haciendo.
 */
function whereFalta(f: FiltroOperaciones, ahora: Date): Prisma.CompanyWhereInput[] {
  switch (f.falta) {
    case 'whatsapp':
      // «Sin configurar» y «configurado pero apagado» son el mismo problema
      // para el cliente: no hay botón de WhatsApp.
      return [{ OR: [{ whatsappConfig: { is: null } }, { whatsappConfig: { activo: false } }] }]
    case 'promociones':
      return [{ promociones: { none: promocionVigente(ahora) } }]
    case 'reglas':
      return [{ reglasRecompensa: { none: { activo: true } } }]
    default:
      return []
  }
}

function whereFiltro(f: FiltroOperaciones, ahora: Date): Prisma.CompanyWhereInput {
  const and: Prisma.CompanyWhereInput[] = [...whereAmbito(f), ...whereFalta(f, ahora)]
  if (f.q) and.push({ name: { contains: f.q, mode: 'insensitive' } })
  return and.length > 0 ? { AND: and } : {}
}

export async function listarOperaciones(
  f: FiltroOperaciones,
  /**
   * Códigos de vertical → nombre. Llega de fuera A PROPÓSITO:
   * `verticalesElegibles()` abre su propia transacción, y llamarlo desde dentro
   * de la de aquí pediría una segunda conexión del pool. Eso no falla — se
   * degrada, que es peor.
   */
  verticales: Map<string, string>,
  opciones: { todo?: boolean } = {}
): Promise<ListadoOperaciones> {
  // Un solo «ahora» para el filtro, los conteos y los avisos: leerlo por
  // separado daría una empresa «sin promociones vigentes» que sí aparece en el
  // conteo de al lado.
  const ahora = new Date()
  const where = whereFiltro(f, ahora)
  const hace30Dias = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000)
  const ambito: Prisma.CompanyWhereInput =
    whereAmbito(f).length > 0 ? { AND: whereAmbito(f) } : {}

  return sinEmpresa('operaciones de plataforma: compara empresas entre sí', async (tx) => {
    const [empresas, total, totalAmbito, sinWhatsapp, sinPromos, sinReglas] = await Promise.all([
      tx.company.findMany({
        where,
        orderBy: { name: 'asc' },
        ...(opciones.todo ? {} : { skip: (f.pagina - 1) * POR_PAGINA, take: POR_PAGINA }),
        select: {
          id: true,
          name: true,
          type: true,
          tipoNegocioCodigo: true,
          esDemo: true,
          isActive: true,
          isPublished: true,
          whatsappConfig: { select: { codigoPais: true, numero: true, activo: true } },
        },
      }),
      tx.company.count({ where }),
      tx.company.count({ where: ambito }),
      tx.company.count({
        where: {
          AND: [
            ambito,
            { OR: [{ whatsappConfig: { is: null } }, { whatsappConfig: { activo: false } }] },
          ],
        },
      }),
      tx.company.count({
        where: { AND: [ambito, { promociones: { none: promocionVigente(ahora) } }] },
      }),
      tx.company.count({
        where: { AND: [ambito, { reglasRecompensa: { none: { activo: true } } }] },
      }),
    ])

    /**
     * Las cifras por empresa, EN BLOQUE.
     *
     * Es lo único que la versión anterior hacía bien y se conserva tal cual:
     * cinco agregaciones acotadas a los ids de la página, no cinco consultas
     * por empresa. Con cuarenta empresas eso era la diferencia entre cinco
     * viajes a la base y doscientos.
     */
    const ids = empresas.map((e) => e.id)
    type Agrupado = { companyId: string; _count: { _all: number } }
    // Con la página vacía no se pregunta nada: `in: []` son cinco viajes a la
    // base para traer cinco listas vacías.
    let promosVig: Agrupado[] = []
    let promosTot: Agrupado[] = []
    let refTotal: Agrupado[] = []
    let refMes: Agrupado[] = []
    let reglas: Agrupado[] = []
    if (ids.length > 0) {
      ;[promosVig, promosTot, refTotal, refMes, reglas] = await Promise.all([
            tx.promocion.groupBy({
              by: ['companyId'],
              where: { companyId: { in: ids }, ...promocionVigente(ahora) },
              _count: { _all: true },
            }),
            tx.promocion.groupBy({
              by: ['companyId'],
              // El total tampoco cuenta las archivadas: archivar es la forma de
              // retirarla, así que sumarla al denominador infla el «3 / 12» con
              // material que nadie va a volver a publicar.
              where: { companyId: { in: ids }, archivada: false },
              _count: { _all: true },
            }),
            tx.referido.groupBy({
              by: ['companyId'],
              where: { companyId: { in: ids }, estado: 'COMPLETADO' },
              _count: { _all: true },
            }),
            tx.referido.groupBy({
              by: ['companyId'],
              where: {
                companyId: { in: ids },
                estado: 'COMPLETADO',
                completadoEn: { gte: hace30Dias },
              },
              _count: { _all: true },
            }),
            tx.reglaRecompensa.groupBy({
              by: ['companyId'],
              where: { companyId: { in: ids }, activo: true },
              _count: { _all: true },
            }),
      ])
    }

    const contar = (filas: Agrupado[], id: string): number =>
      filas.find((x) => x.companyId === id)?._count._all ?? 0

    const filas: OperacionEmpresa[] = empresas.map((e) => {
      // `tipoNegocioCodigo` manda cuando está; si no, se resuelve como siempre.
      // Es la misma regla que ya aplican el registro y las capacidades, y la
      // razón por la que la insignia enseñaba una categoría que el sistema
      // había dejado de usar para decidir.
      const codigo = e.tipoNegocioCodigo ?? e.type
      return {
        id: e.id,
        name: e.name,
        verticalCodigo: codigo,
        verticalNombre: verticales.get(codigo) ?? codigo,
        esDemo: e.esDemo,
        isActive: e.isActive,
        isPublished: e.isPublished,
        promosVigentes: contar(promosVig, e.id),
        promosTotal: contar(promosTot, e.id),
        referidosCompletados: contar(refTotal, e.id),
        referidosMes: contar(refMes, e.id),
        reglasActivas: contar(reglas, e.id),
        whatsapp: e.whatsappConfig
          ? {
              // El número se enseñaba sin el código de país, que se guarda
              // aparte: quien lo copiara para llamar marcaba un número
              // incompleto.
              numero: `${e.whatsappConfig.codigoPais} ${e.whatsappConfig.numero}`.trim(),
              activo: e.whatsappConfig.activo,
            }
          : null,
      }
    })

    return {
      filas,
      total,
      totalAmbito,
      faltan: { whatsapp: sinWhatsapp, promociones: sinPromos, reglas: sinReglas },
    }
  })
}
