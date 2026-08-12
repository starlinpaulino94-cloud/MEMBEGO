import 'server-only'

import type { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { whereCobrado } from '@/modules/pagos/cobrado'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import { estaEnSilencio } from './silencio'
import { POR_PAGINA, type FiltroEmpresas } from './filtros'

/**
 * El listado del CRM de empresas.
 *
 * Sustituye a `listEmpresas()`, que traía TODAS las empresas con todos sus
 * campos para que el navegador las filtrara después. Cuatro cosas de aquel
 * código no eran una decisión, eran defectos:
 *
 *  1. NO SELECCIONABA `esDemo`, así que la empresa de práctica entraba en los
 *     cuatro totales y en la lista como un negocio real. El Resumen la restaba:
 *     dos pantallas a un clic de distancia decían 99 y 100 clientes.
 *
 *  2. «Ingresos» sumaba `montoPagado: { not: null }` — CUALQUIER membresía con
 *     un monto escrito, confirmado el pago o no. Era la cuarta definición de
 *     dinero cobrado del sistema, y la más laxa. Ahora pasa por `whereCobrado`,
 *     la misma que usan Reportes y los dos Resúmenes. La cifra BAJA, y esa
 *     bajada es la corrección.
 *
 *  3. «Activas» contaba `estado: 'ACTIVA'` sin mirar el vencimiento, cuando
 *     `membresiaVigente()` existe justo porque nada las vence solas. Esta
 *     pantalla podía decir 40 y el panel de esa misma empresa decir menos.
 *
 *  4. `email`, `telefono`, `ciudad`, `categoria` y `website` se leían con un
 *     cast desde un objeto que NO los traía: llegaban siempre `null`. Por eso
 *     los filtros de categoría y ciudad no tenían ni una opción y los botones de
 *     correo y WhatsApp no aparecían nunca. Un filtro que no filtra es peor que
 *     no tenerlo: ocupa sitio y enseña que la pantalla no responde.
 */

export interface EmpresaFila {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  email: string | null
  telefono: string | null
  ciudad: string | null
  categoria: string | null
  isActive: boolean
  isPublished: boolean
  esDemo: boolean
  clientes: number
  usuarios: number
  sucursales: number
  planes: number
  membresiasVigentes: number
  /** Cobrado desde siempre (con pago confirmado). */
  ingresosHistoricos: number
  /** Cobrado en el mes en curso. Es el número con el que se decide algo. */
  cobradoMes: number
  /** Milisegundos desde la última señal de vida; `null` = nunca hubo. */
  desdeUltimaActividad: number | null
  enSilencio: boolean
}

export interface ListadoEmpresas {
  filas: EmpresaFila[]
  /** Cuántas cumplen el filtro (paginación y el «N de M»). */
  total: number
  /** Cuántas hay en el ámbito elegido, sin más filtros. */
  totalAmbito: number
  activas: number
  clientes: number
  ingresosHistoricos: number
  cobradoMes: number
  /** Opciones REALES de los desplegables, sacadas de los datos. */
  categorias: string[]
  ciudades: string[]
  hayDemos: boolean
}

function whereAmbito(f: FiltroEmpresas): Prisma.CompanyWhereInput {
  if (f.ambito === 'reales') return { esDemo: false }
  if (f.ambito === 'practica') return { esDemo: true }
  return {}
}

function whereDeFiltro(f: FiltroEmpresas): Prisma.CompanyWhereInput {
  // TODO dentro de un solo `AND`. Si el `OR` de la búsqueda fuera hermano de los
  // demás, buscar «car» devolvería también las suspendidas: el `OR` de arriba
  // gana y el resto de condiciones deja de aplicarse. Es el fallo que ya
  // apareció en los filtros de Clientes y Membresías.
  const cond: Prisma.CompanyWhereInput[] = [whereAmbito(f)]

  if (f.estado === 'activas') cond.push({ isActive: true })
  else if (f.estado === 'suspendidas') cond.push({ isActive: false })
  else if (f.estado === 'sin-publicar') cond.push({ isPublished: false })

  if (f.categoria) cond.push({ categoria: f.categoria })
  if (f.ciudad) cond.push({ ciudad: f.ciudad })

  if (f.q) {
    cond.push({
      OR: [
        { name: { contains: f.q, mode: 'insensitive' } },
        { slug: { contains: f.q, mode: 'insensitive' } },
        { email: { contains: f.q, mode: 'insensitive' } },
        { ciudad: { contains: f.q, mode: 'insensitive' } },
      ],
    })
  }

  return { AND: cond }
}

/**
 * Orden en la base de datos… salvo dos casos, y conviene decir cuáles.
 *
 * `ingresos` y `actividad` no son columnas de `companies`: salen de agregar
 * membresías y bitácora. Ordenar por ellas en SQL pediría una vista o una
 * subconsulta correlacionada. Con estos volúmenes —decenas de empresas— se
 * ordenan en memoria, lo que obliga a traer TODAS las que cumplen el filtro en
 * lugar de una página.
 *
 * Está escrito aquí para que nadie lo descubra el día que haya mil empresas: ese
 * día, estos dos órdenes son lo que hay que llevar a SQL. Los otros tres ya
 * paginan en la base, que es el caso de todos los días.
 */
function orderByDeFiltro(f: FiltroEmpresas): Prisma.CompanyOrderByWithRelationInput | null {
  if (f.orden === 'nombre') return { name: 'asc' }
  if (f.orden === 'reciente') return { createdAt: 'desc' }
  if (f.orden === 'clientes') return { clientes: { _count: 'desc' } }
  return null
}

function comparador(f: FiltroEmpresas) {
  return (a: EmpresaFila, b: EmpresaFila) => {
    if (f.orden === 'ingresos') return b.ingresosHistoricos - a.ingresosHistoricos
    // Más tiempo callada primero. «Nunca» es el silencio más largo que hay, así
    // que va arriba del todo y no al final por ser `null`.
    const x = a.desdeUltimaActividad ?? Number.POSITIVE_INFINITY
    const y = b.desdeUltimaActividad ?? Number.POSITIVE_INFINITY
    return y - x
  }
}

export async function listarEmpresas(
  f: FiltroEmpresas,
  /**
   * Sin paginar. Lo usa la EXPORTACIÓN: el CSV tiene que llevar todo lo que
   * cumple el filtro, no la página que se estuviera mirando. Un archivo con 24
   * de 300 filas y sin decirlo es peor que no exportar.
   */
  opciones?: { todo?: boolean }
): Promise<ListadoEmpresas> {
  const todo = opciones?.todo === true
  const ahora = new Date()
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
  const desdeSiempre = new Date(0)

  const where = whereDeFiltro(f)
  const orderBy = orderByDeFiltro(f)
  const enMemoria = orderBy === null

  return sinEmpresa('superadmin: CRM de todas las empresas', async (tx) => {
    const [companies, total, totalAmbito, activas, clientes, historico, mes, valoresFiltro, demos] =
      await Promise.all([
        tx.company.findMany({
          where,
          orderBy: orderBy ?? { name: 'asc' },
          ...(enMemoria || todo ? {} : { skip: (f.pagina - 1) * POR_PAGINA, take: POR_PAGINA }),
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            email: true,
            telefono: true,
            ciudad: true,
            categoria: true,
            isActive: true,
            isPublished: true,
            esDemo: true,
            _count: { select: { clientes: true, users: true, plans: true, sucursales: true } },
          },
        }),
        tx.company.count({ where }),
        tx.company.count({ where: whereAmbito(f) }),
        tx.company.count({ where: { AND: [where, { isActive: true }] } }),

        // LOS TOTALES SON DE TODO EL FILTRO, NO DE LA PÁGINA. Se piden por la
        // relación (`company: where`) en vez de por una lista de ids: así
        // «Clientes totales» sigue diciendo lo mismo al pasar de página, que es
        // lo que espera cualquiera que lea una cabecera de resumen.
        tx.cliente.count({ where: { company: where } }).catch(() => 0),
        tx.membership
          .aggregate({
            where: whereCobrado(desdeSiempre, undefined, { company: where }),
            _sum: { montoPagado: true },
          })
          .then((a) => Number(a._sum.montoPagado ?? 0))
          .catch(() => 0),
        tx.membership
          .aggregate({
            where: whereCobrado(inicioMes, undefined, { company: where }),
            _sum: { montoPagado: true },
          })
          .then((a) => Number(a._sum.montoPagado ?? 0))
          .catch(() => 0),

        // Las opciones de los desplegables salen del ÁMBITO, no del filtro
        // aplicado: si salieran del filtro, elegir una ciudad dejaría la lista
        // de ciudades con una sola opción y no habría forma de cambiarla.
        tx.company
          .findMany({
            where: whereAmbito(f),
            select: { categoria: true, ciudad: true },
          })
          .catch(() => [] as { categoria: string | null; ciudad: string | null }[]),
        tx.company.count({ where: { esDemo: true } }).catch(() => 0),
      ])

    const ids = companies.map((c) => c.id)
    const deEstas = { companyId: { in: ids } }

    const [vigentes, historicoPorEmpresa, mesPorEmpresa, actividad] = await Promise.all([
      tx.membership
        .groupBy({
          by: ['companyId'],
          where: { AND: [deEstas, membresiaVigente(ahora)] },
          _count: { _all: true },
        })
        .catch(() => [] as { companyId: string; _count: { _all: number } }[]),
      tx.membership
        .groupBy({
          by: ['companyId'],
          where: whereCobrado(desdeSiempre, undefined, deEstas),
          _sum: { montoPagado: true },
        })
        .catch(() => [] as { companyId: string; _sum: { montoPagado: unknown } }[]),
      tx.membership
        .groupBy({
          by: ['companyId'],
          where: whereCobrado(inicioMes, undefined, deEstas),
          _sum: { montoPagado: true },
        })
        .catch(() => [] as { companyId: string; _sum: { montoPagado: unknown } }[]),
      tx.auditLog
        .groupBy({ by: ['companyId'], where: deEstas, _max: { createdAt: true } })
        .catch(() => [] as { companyId: string | null; _max: { createdAt: Date | null } }[]),
    ])

    const vigentesDe = new Map(vigentes.map((g) => [g.companyId, g._count._all]))
    const historicoDe = new Map(
      historicoPorEmpresa.map((g) => [g.companyId, Number(g._sum.montoPagado ?? 0)])
    )
    const mesDe = new Map(mesPorEmpresa.map((g) => [g.companyId, Number(g._sum.montoPagado ?? 0)]))
    const actividadDe = new Map(actividad.map((g) => [g.companyId ?? '', g._max.createdAt]))

    let filas: EmpresaFila[] = companies.map((c) => {
      const ultima = actividadDe.get(c.id) ?? null
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        logoUrl: c.logoUrl,
        email: c.email,
        telefono: c.telefono,
        ciudad: c.ciudad,
        categoria: c.categoria,
        isActive: c.isActive,
        isPublished: c.isPublished,
        esDemo: c.esDemo,
        clientes: c._count.clientes,
        usuarios: c._count.users,
        sucursales: c._count.sucursales,
        planes: c._count.plans,
        membresiasVigentes: vigentesDe.get(c.id) ?? 0,
        ingresosHistoricos: historicoDe.get(c.id) ?? 0,
        cobradoMes: mesDe.get(c.id) ?? 0,
        desdeUltimaActividad: ultima ? ahora.getTime() - ultima.getTime() : null,
        // La MISMA regla que usa el Centro de control, importada y no copiada.
        enSilencio: estaEnSilencio({ isActive: c.isActive, ultimaActividad: ultima }, ahora),
      }
    })

    if (enMemoria) filas.sort(comparador(f))
    if (enMemoria && !todo) {
      filas = filas.slice((f.pagina - 1) * POR_PAGINA, f.pagina * POR_PAGINA)
    }

    const unicos = (vs: (string | null)[]) =>
      [...new Set(vs.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b))

    return {
      filas,
      total,
      totalAmbito,
      activas,
      clientes,
      ingresosHistoricos: historico,
      cobradoMes: mes,
      categorias: unicos(valoresFiltro.map((o) => o.categoria)),
      ciudades: unicos(valoresFiltro.map((o) => o.ciudad)),
      hayDemos: demos > 0,
    }
  })
}
