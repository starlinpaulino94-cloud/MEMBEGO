import { prisma } from '@/lib/prisma'

/**
 * App Car Wash · Fase 2 — INCIDENCIAS Y REWASH.
 *
 * EL DATO QUE NADIE MIDE Y TODOS PAGAN: el rewash. Cada trabajo repetido es
 * una bahía ocupada gratis — costo laboral, químicos y un turno que otro
 * cliente no pudo usar. En un cuaderno eso desaparece; aquí se cuenta.
 *
 * Por eso una incidencia de tipo REWASH puede enlazar la entrada de cola que
 * se creó para rehacer el trabajo (`rewashColaId`): así el costo del error se
 * puede leer en minutos de pista, no solo en quejas.
 */

export const INCIDENCIA_TIPOS = ['REWASH', 'DANO', 'QUEJA', 'FALTANTE', 'OTRO'] as const
export type IncidenciaTipo = (typeof INCIDENCIA_TIPOS)[number]

export const INCIDENCIA_TIPO_LABELS: Record<IncidenciaTipo, string> = {
  REWASH: 'Hay que repetirlo',
  DANO: 'Daño al vehículo',
  QUEJA: 'Queja del cliente',
  FALTANTE: 'Objeto faltante',
  OTRO: 'Otro',
}

export const INCIDENCIA_ESTADOS = ['ABIERTA', 'EN_PROCESO', 'RESUELTA'] as const
export type IncidenciaEstado = (typeof INCIDENCIA_ESTADOS)[number]

export const INCIDENCIA_ESTADO_LABELS: Record<IncidenciaEstado, string> = {
  ABIERTA: 'Abierta',
  EN_PROCESO: 'En proceso',
  RESUELTA: 'Resuelta',
}

export const GRAVEDADES = ['BAJA', 'MEDIA', 'ALTA'] as const
export type Gravedad = (typeof GRAVEDADES)[number]

export const GRAVEDAD_LABELS: Record<Gravedad, string> = {
  BAJA: 'Baja',
  MEDIA: 'Media',
  ALTA: 'Alta',
}

export interface IncidenciaFila {
  id: string
  fecha: Date
  tipo: string
  gravedad: string
  estado: string
  descripcion: string
  resolucion: string | null
  placa: string | null
  cliente: string | null
  costo: number | null
  reportadaPor: string | null
  responsable: string | null
  /** true = ya hay una entrada de cola creada para rehacer el trabajo. */
  tieneRewash: boolean
}

export interface PanelIncidencias {
  filas: IncidenciaFila[]
  kpis: {
    abiertas: number
    delPeriodo: number
    rewash: number
    costo: number
    /** Rewash sobre vehículos entregados en el período, en %. */
    tasaRewash: number | null
  }
}

/**
 * Panel de incidencias del período. `null` = migración 20260764 sin correr.
 *
 * La tasa de rewash se calcula sobre los vehículos ENTREGADOS del período, no
 * sobre el total de entradas: repetir un trabajo solo tiene sentido cuando el
 * trabajo llegó a entregarse.
 */
export async function getPanelIncidencias(
  companyId: string,
  desde: Date,
  hasta: Date,
  filtro: { estado?: string; tipo?: string } = {}
): Promise<PanelIncidencias | null> {
  try {
    const rango = { gte: desde, lte: hasta }
    const where = {
      companyId,
      createdAt: rango,
      ...(filtro.estado && (INCIDENCIA_ESTADOS as readonly string[]).includes(filtro.estado)
        ? { estado: filtro.estado }
        : {}),
      ...(filtro.tipo && (INCIDENCIA_TIPOS as readonly string[]).includes(filtro.tipo)
        ? { tipo: filtro.tipo }
        : {}),
    }

    const [filas, abiertas, delPeriodo, rewash, costoAgg, entregados] = await Promise.all([
      prisma.incidencia.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: {
          id: true,
          createdAt: true,
          tipo: true,
          gravedad: true,
          estado: true,
          descripcion: true,
          resolucion: true,
          placa: true,
          costo: true,
          rewashColaId: true,
          cliente: { select: { nombre: true } },
          vehiculo: { select: { placa: true } },
          reportadaPor: { select: { name: true, email: true } },
          responsable: { select: { name: true, email: true } },
        },
      }),
      // Abiertas de SIEMPRE, no solo del período: una incidencia de hace tres
      // semanas sin resolver sigue siendo un problema abierto hoy.
      prisma.incidencia.count({ where: { companyId, estado: { not: 'RESUELTA' } } }),
      prisma.incidencia.count({ where: { companyId, createdAt: rango } }),
      prisma.incidencia.count({ where: { companyId, createdAt: rango, tipo: 'REWASH' } }),
      prisma.incidencia.aggregate({
        where: { companyId, createdAt: rango },
        _sum: { costo: true },
      }),
      prisma.colaVehiculo.count({
        where: { companyId, estado: 'ENTREGADO', entregadoAt: rango },
      }),
    ])

    return {
      filas: filas.map((f) => ({
        id: f.id,
        fecha: f.createdAt,
        tipo: f.tipo,
        gravedad: f.gravedad,
        estado: f.estado,
        descripcion: f.descripcion,
        resolucion: f.resolucion,
        placa: f.placa ?? f.vehiculo?.placa ?? null,
        cliente: f.cliente?.nombre ?? null,
        costo: f.costo == null ? null : Number(f.costo),
        reportadaPor: f.reportadaPor?.name ?? f.reportadaPor?.email ?? null,
        responsable: f.responsable?.name ?? f.responsable?.email ?? null,
        tieneRewash: f.rewashColaId != null,
      })),
      kpis: {
        abiertas,
        delPeriodo,
        rewash,
        costo: Number(costoAgg._sum.costo ?? 0),
        tasaRewash: entregados > 0 ? Math.round((rewash / entregados) * 1000) / 10 : null,
      },
    }
  } catch {
    return null
  }
}

/**
 * Vehículos entregados recientemente: lo que se puede señalar al abrir una
 * incidencia.
 *
 * El "hace N días" se calcula AQUÍ y no en la página: leer el reloj durante el
 * render de un componente lo vuelve no idempotente (y el linter de React lo
 * marca con razón). Aquí es una consulta, no un render.
 */
export async function getEntregadosRecientes(companyId: string, dias = 3) {
  try {
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
    return await prisma.colaVehiculo.findMany({
      where: { companyId, estado: 'ENTREGADO', entregadoAt: { gte: desde } },
      orderBy: { entregadoAt: 'desc' },
      take: 60,
      select: {
        id: true,
        placa: true,
        descripcion: true,
        entregadoAt: true,
        clienteId: true,
        vehiculoId: true,
        vehiculo: { select: { placa: true, marca: true, modelo: true } },
        cliente: { select: { nombre: true } },
      },
    })
  } catch {
    return []
  }
}
