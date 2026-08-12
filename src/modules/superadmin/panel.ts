import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { contarColasDePago } from '@/modules/pagos/colasConteo'
import { periodoAnterior, variacion, whereCobrado } from '@/modules/pagos/cobrado'
import { COLAS_TICKET } from '@/lib/soporte'

/**
 * Los datos del Centro de control (panel de plataforma).
 *
 * TODO EN UNA SOLA TRANSACCIÓN. Antes la página llamaba, desde dentro de su
 * transacción, a dos funciones que abrían la suya: eso pide una segunda conexión
 * desde dentro de una abierta y, con el pooler de Supabase delante, es como se
 * agota el pool. No daba un error legible — daba timeouts intermitentes bajo
 * carga. `scripts/transacciones-anidadas.mjs` vigila que no vuelva.
 *
 * UNA SOLA REGLA PARA LAS EMPRESAS DE PRÁCTICA. Todo lo que se mide aquí las
 * excluye, sin excepciones. Antes «Empresas» las contaba y las otras tres
 * tarjetas no, así que la misma fila decía dos cosas distintas mientras la
 * página afirmaba abajo que sus números no cuentan.
 */

/** Periodos que ofrece el selector. En días. */
export const PERIODOS = [7, 30, 90] as const
export type Periodo = (typeof PERIODOS)[number]
export const PERIODO_LABEL: Record<Periodo, string> = {
  7: 'Últimos 7 días',
  30: 'Últimos 30 días',
  90: 'Últimos 90 días',
}

/**
 * Sin señal de vida en este tiempo, una empresa está en silencio.
 *
 * Fijo y no atado al periodo elegido A PROPÓSITO: el aviso tiene que significar
 * lo mismo mirando 7 días que mirando 90. Si dependiera del selector, cambiar el
 * periodo cambiaría cuántas empresas «están en silencio», que es justo la clase
 * de número que deja de creerse.
 */
export const DIAS_SILENCIO = 14

export function leerPeriodo(valor: string | undefined): Periodo {
  const n = Number(valor)
  return (PERIODOS as readonly number[]).includes(n) ? (n as Periodo) : 30
}

export interface EmpresaPanel {
  id: string
  name: string
  logoUrl: string | null
  isActive: boolean
  isPublished: boolean
  esDemo: boolean
  clientes: number
  activas: number
  pendientes: number
  /** Milisegundos desde la última señal de vida. `null` = nunca hubo. */
  desdeUltimaActividad: number | null
  /**
   * Sin señal de vida en `DIAS_SILENCIO`, estando activa.
   *
   * Se decide AQUÍ y no en la tarjeta: el aviso «Empresas en silencio» y el
   * resalte de cada tarjeta tienen que estar de acuerdo siempre. Con la regla
   * escrita en los dos sitios, el día que uno cambie el panel dirá «3 en
   * silencio» y solo dos tarjetas aparecerán marcadas.
   */
  enSilencio: boolean
}

export interface Metrica {
  valor: number
  /** Mismo tramo, periodo anterior. */
  anterior: number
  /** Porcentaje; `null` si antes no hubo nada con lo que comparar. */
  variacion: number | null
}

export interface PanelPlataforma {
  empresas: EmpresaPanel[]
  demos: EmpresaPanel[]
  totalEmpresas: number
  totalClientes: number
  totalActivas: number
  /** Altas de clientes dentro del periodo, con su comparación. */
  nuevos: Metrica
  /** Dinero cobrado dentro del periodo, con su comparación. */
  cobrado: Metrica
  porValidar: number
  sinPublicar: number
  ticketsAbiertos: number
  /** Empresas reales y activas sin señal de vida en `DIAS_SILENCIO`. */
  enSilencio: number
  actividad: {
    id: string
    accion: string
    entidadTipo: string | null
    createdAt: Date
    empresa: string | null
    autor: string | null
  }[]
}

const SELECT_EMPRESA = {
  id: true,
  name: true,
  logoUrl: true,
  isActive: true,
  isPublished: true,
  _count: { select: { clientes: true } },
} as const

export async function getPanelPlataforma(periodoDias: Periodo): Promise<PanelPlataforma> {
  const ahora = new Date()
  const desde = new Date(ahora.getTime() - periodoDias * 86_400_000)
  const previo = periodoAnterior(desde, ahora)
  const limiteSilencio = new Date(ahora.getTime() - DIAS_SILENCIO * 86_400_000)

  return sinEmpresa('panel de plataforma: los totales son de todas las empresas', async (tx) => {
    // `esDemo` puede no estar migrada todavía. Se intenta con la columna y se
    // cae sin ella: el centro de control no puede quedarse en blanco por eso, y
    // sin la columna la verdad es que aún no hay empresas de práctica.
    const filas = await tx.company
      .findMany({ orderBy: { name: 'asc' }, select: { ...SELECT_EMPRESA, esDemo: true } })
      .catch(async () =>
        (await tx.company
          .findMany({ orderBy: { name: 'asc' }, select: SELECT_EMPRESA })
          .catch(() => [])
        ).map((f) => ({ ...f, esDemo: false }))
      )

    const idsReales = filas.filter((f) => !f.esDemo).map((f) => f.id)
    const soloReales = { companyId: { in: idsReales } }

    const [
      membresias,
      nuevosActual,
      nuevosPrevio,
      cobradoActual,
      cobradoPrevio,
      colas,
      ticketsAbiertos,
      ultimaPorEmpresa,
      actividad,
    ] = await Promise.all([
      tx.membership
        .groupBy({
          by: ['companyId', 'estado'],
          where: { estado: { in: ['ACTIVA', 'PENDIENTE_PAGO'] } },
          _count: { _all: true },
        })
        .catch(() => []),

      tx.cliente.count({ where: { ...soloReales, createdAt: { gte: desde } } }).catch(() => 0),
      tx.cliente
        .count({ where: { ...soloReales, createdAt: { gte: previo.desde, lt: previo.hasta } } })
        .catch(() => 0),

      tx.membership
        .aggregate({ where: whereCobrado(desde, ahora, soloReales), _sum: { montoPagado: true } })
        .then((a) => Number(a._sum.montoPagado ?? 0))
        .catch(() => 0),
      tx.membership
        .aggregate({
          where: whereCobrado(previo.desde, previo.hasta, soloReales),
          _sum: { montoPagado: true },
        })
        .then((a) => Number(a._sum.montoPagado ?? 0))
        .catch(() => 0),

      // Con el `tx` ya abierto. Es el MISMO recuento que pinta las pestañas de
      // Operaciones, para que el aviso y su destino digan el mismo número.
      contarColasDePago(null, tx),

      tx.supportTicket
        .count({ where: { estado: { in: [...COLAS_TICKET.pendientes] } } })
        .catch(() => 0),

      // Última señal de vida por empresa, en una sola consulta. La bitácora y no
      // las visitas: una empresa que solo cobra por transferencia no genera
      // visitas y no por eso está muerta.
      tx.auditLog
        .groupBy({ by: ['companyId'], _max: { createdAt: true } })
        .catch(() => [] as { companyId: string | null; _max: { createdAt: Date | null } }[]),

      tx.auditLog
        .findMany({
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true,
            accion: true,
            entidadTipo: true,
            createdAt: true,
            company: { select: { name: true } },
            user: { select: { name: true } },
          },
        })
        .catch(() => []),
    ])

    const conteo = (companyId: string, estado: string) =>
      membresias.find((g) => g.companyId === companyId && g.estado === estado)?._count._all ?? 0
    const ultima = new Map(
      ultimaPorEmpresa.map((g) => [g.companyId ?? '', g._max.createdAt ?? null])
    )

    const todas: EmpresaPanel[] = filas.map((c) => ({
      id: c.id,
      name: c.name,
      logoUrl: c.logoUrl,
      isActive: c.isActive,
      isPublished: c.isPublished,
      esDemo: c.esDemo,
      clientes: c._count.clientes,
      activas: conteo(c.id, 'ACTIVA'),
      pendientes: conteo(c.id, 'PENDIENTE_PAGO'),
      desdeUltimaActividad: ultima.get(c.id) ? ahora.getTime() - ultima.get(c.id)!.getTime() : null,
      // Solo las activas: una empresa dada de baja no está «en silencio», está
      // cerrada, y mezclarlas convertiría el aviso en ruido permanente.
      enSilencio:
        c.isActive && !c.esDemo && (!ultima.get(c.id) || ultima.get(c.id)! < limiteSilencio),
    }))

    const empresas = todas.filter((c) => !c.esDemo)
    const demos = todas.filter((c) => c.esDemo)

    return {
      empresas,
      demos,
      totalEmpresas: empresas.length,
      totalClientes: empresas.reduce((s, c) => s + c.clientes, 0),
      totalActivas: empresas.reduce((s, c) => s + c.activas, 0),
      nuevos: {
        valor: nuevosActual,
        anterior: nuevosPrevio,
        variacion: variacion(nuevosActual, nuevosPrevio),
      },
      cobrado: {
        valor: cobradoActual,
        anterior: cobradoPrevio,
        variacion: variacion(cobradoActual, cobradoPrevio),
      },
      porValidar: colas.porValidar,
      // Sin publicar y por validar son AVISOS DE TRABAJO: nadie tiene que
      // publicar una empresa de práctica ni validar su pago de mentira.
      sinPublicar: empresas.filter((c) => !c.isPublished).length,
      ticketsAbiertos,
      enSilencio: empresas.filter((c) => c.enSilencio).length,
      actividad: actividad.map((a) => ({
        id: a.id,
        accion: a.accion,
        entidadTipo: a.entidadTipo,
        createdAt: a.createdAt,
        empresa: a.company?.name ?? null,
        autor: a.user?.name ?? null,
      })),
    }
  })
}
