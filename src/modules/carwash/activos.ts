import { conEmpresa } from '@/lib/tenant'

/**
 * App Car Wash · Fase 3 — EQUIPOS Y MANTENIMIENTO.
 *
 * LO QUE ESTE MÓDULO MIDE NO ES EL EQUIPO, ES LA PISTA PARADA. Un car wash con
 * dos hidrolavadoras y una dañada trabaja al 50%, y hoy eso no aparece en
 * ningún número: aparece como una cola que no baja.
 *
 * EL VALOR ESTÁ EN AVISAR ANTES. `proximoMantenimiento` se recalcula cada vez
 * que se registra un mantenimiento, así el panel puede decir "a la
 * hidrolavadora 2 le toca en 3 días" en lugar de enterarse cuando revienta.
 */

export const ACTIVO_ESTADOS = ['OPERATIVO', 'EN_MANTENIMIENTO', 'DANADO', 'BAJA'] as const
export type ActivoEstado = (typeof ACTIVO_ESTADOS)[number]

export const ACTIVO_ESTADO_LABELS: Record<ActivoEstado, string> = {
  OPERATIVO: 'Operativo',
  EN_MANTENIMIENTO: 'En mantenimiento',
  DANADO: 'Dañado',
  BAJA: 'Dado de baja',
}

/** Estados que dejan el equipo fuera de servicio. */
export const ESTADOS_PARADO: ActivoEstado[] = ['EN_MANTENIMIENTO', 'DANADO']

export const MANTENIMIENTO_TIPOS = ['PREVENTIVO', 'CORRECTIVO'] as const
export type MantenimientoTipo = (typeof MANTENIMIENTO_TIPOS)[number]

export const MANTENIMIENTO_TIPO_LABELS: Record<MantenimientoTipo, string> = {
  PREVENTIVO: 'Preventivo (programado)',
  CORRECTIVO: 'Correctivo (se dañó)',
}

/**
 * Cuándo toca el próximo mantenimiento. `null` si el equipo no tiene
 * frecuencia programada — no todo equipo la necesita, y forzar una fecha
 * inventada llenaría el panel de avisos falsos.
 */
export function calcularProximo(desde: Date, frecuenciaDias: number): Date | null {
  if (!frecuenciaDias || frecuenciaDias <= 0) return null
  return new Date(desde.getTime() + frecuenciaDias * 24 * 60 * 60 * 1000)
}

/**
 * Clasifica cuán urgente es el mantenimiento de un equipo.
 *
 * El umbral de 7 días para "pronto" no es arbitrario: es lo que da tiempo a
 * conseguir el repuesto o al técnico antes de que el equipo pare.
 */
export type UrgenciaMantenimiento = 'VENCIDO' | 'PRONTO' | 'AL_DIA' | 'SIN_PROGRAMA'

export function urgenciaDe(
  proximo: Date | null | undefined,
  ahora: Date
): UrgenciaMantenimiento {
  if (!proximo) return 'SIN_PROGRAMA'
  const dias = Math.floor((proximo.getTime() - ahora.getTime()) / (24 * 60 * 60 * 1000))
  if (dias < 0) return 'VENCIDO'
  if (dias <= 7) return 'PRONTO'
  return 'AL_DIA'
}

export interface ActivoFila {
  id: string
  nombre: string
  categoria: string | null
  marca: string | null
  modelo: string | null
  ubicacion: string | null
  estado: string
  frecuenciaDias: number
  proximoMantenimiento: Date | null
  urgencia: UrgenciaMantenimiento
  ultimoMantenimiento: Date | null
  mantenimientos: number
  /** Horas acumuladas fuera de servicio. El costo real de las averías. */
  horasParado: number
}

export interface PanelActivos {
  filas: ActivoFila[]
  kpis: {
    total: number
    operativos: number
    parados: number
    vencidos: number
    costoPeriodo: number
    horasParadoPeriodo: number
  }
}

/** Panel de equipos. `null` = migración 20260765 sin correr. */
export async function getPanelActivos(
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<PanelActivos | null> {
  try {
    const ahora = new Date()
    const [activos, agg] = await conEmpresa(companyId, (tx) =>
      Promise.all([
        tx.activo.findMany({
          where: { companyId, activo: true },
          orderBy: [{ estado: 'asc' }, { nombre: 'asc' }],
          select: {
            id: true,
            nombre: true,
            categoria: true,
            marca: true,
            modelo: true,
            ubicacion: true,
            estado: true,
            frecuenciaDias: true,
            proximoMantenimiento: true,
            _count: { select: { mantenimientos: true } },
            mantenimientos: {
              orderBy: { realizadoAt: 'desc' },
              take: 1,
              select: { realizadoAt: true },
            },
          },
        }),
      tx.mantenimiento.aggregate({
        where: { activo: { companyId }, realizadoAt: { gte: desde, lte: hasta } },
        _sum: { costo: true, horasParado: true },
      }),
    ])
    )

    // Horas paradas por equipo, en una sola consulta para toda la lista.
    const horasPorActivo = await conEmpresa(companyId, (tx) =>
      tx.mantenimiento.groupBy({
        by: ['activoId'],
        where: { activo: { companyId } },
        _sum: { horasParado: true },
      })
    )
    const horas = new Map(
      horasPorActivo.map((h) => [h.activoId, Number(h._sum.horasParado ?? 0)])
    )

    const filas: ActivoFila[] = activos.map((a) => ({
      id: a.id,
      nombre: a.nombre,
      categoria: a.categoria,
      marca: a.marca,
      modelo: a.modelo,
      ubicacion: a.ubicacion,
      estado: a.estado,
      frecuenciaDias: a.frecuenciaDias,
      proximoMantenimiento: a.proximoMantenimiento,
      urgencia: urgenciaDe(a.proximoMantenimiento, ahora),
      ultimoMantenimiento: a.mantenimientos[0]?.realizadoAt ?? null,
      mantenimientos: a._count.mantenimientos,
      horasParado: horas.get(a.id) ?? 0,
    }))

    return {
      filas,
      kpis: {
        total: filas.length,
        operativos: filas.filter((f) => f.estado === 'OPERATIVO').length,
        parados: filas.filter((f) => (ESTADOS_PARADO as string[]).includes(f.estado)).length,
        vencidos: filas.filter((f) => f.urgencia === 'VENCIDO').length,
        costoPeriodo: Number(agg._sum.costo ?? 0),
        horasParadoPeriodo: Number(agg._sum.horasParado ?? 0),
      },
    }
  } catch {
    return null
  }
}

/** Historial de mantenimientos de un equipo. */
export async function getMantenimientos(companyId: string, activoId: string) {
  try {
    return await conEmpresa(companyId, (tx) =>
      tx.mantenimiento.findMany({
        where: { activoId, activo: { companyId } },
        orderBy: { realizadoAt: 'desc' },
        take: 100,
        select: {
          id: true,
          tipo: true,
          descripcion: true,
          costo: true,
          horasParado: true,
          realizadoAt: true,
          proveedor: true,
          hechoPor: { select: { name: true, email: true } },
        },
      })
    )
  } catch {
    return []
  }
}
