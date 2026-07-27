import { prisma } from '@/lib/prisma'

/**
 * App Car Wash · Fase 3 — TURNOS Y ASISTENCIA.
 *
 * PARA QUÉ SIRVE DE VERDAD: cruzado con los vehículos entregados da el COSTO
 * LABORAL POR LAVADO. Ese es el número que dice si el precio de lista tiene
 * sentido. Sin turnos no existe, y el precio se pone a ojo — que es
 * exactamente como está hoy.
 *
 * `salidaAt` nulo = turno abierto. Es el estado normal durante la jornada, no
 * un error. Un índice único parcial en la base impide que un mismo empleado
 * tenga dos turnos abiertos: dos pestañas marcando entrada a la vez no pueden
 * duplicarlo, y eso no se puede garantizar solo desde el código.
 */

/** Horas trabajadas de un turno. Turno abierto = se cuenta hasta ahora. */
export function horasDeTurno(
  entradaAt: Date,
  salidaAt: Date | null | undefined,
  ahora: Date
): number {
  const fin = salidaAt ?? ahora
  const ms = fin.getTime() - entradaAt.getTime()
  if (ms <= 0) return 0
  return Math.round((ms / (1000 * 60 * 60)) * 100) / 100
}

/**
 * Costo laboral por vehículo entregado.
 *
 * `null` cuando no hay vehículos: dividir entre cero daría Infinity, y un
 * panel que muestra "∞ por lavado" es peor que uno que muestra un guión.
 */
export function costoPorVehiculo(costoTotal: number, vehiculos: number): number | null {
  if (vehiculos <= 0) return null
  return Math.round((costoTotal / vehiculos) * 100) / 100
}

export interface TurnoFila {
  id: string
  empleado: string
  userId: string
  entradaAt: Date
  salidaAt: Date | null
  horas: number
  costoHora: number | null
  costo: number
  abierto: boolean
}

export interface ResumenEmpleado {
  userId: string
  nombre: string
  turnos: number
  horas: number
  costo: number
}

export interface PanelTurnos {
  filas: TurnoFila[]
  porEmpleado: ResumenEmpleado[]
  /** Quiénes están dentro ahora mismo. */
  abiertos: { userId: string; nombre: string; entradaAt: Date; horas: number }[]
  kpis: {
    horas: number
    costo: number
    vehiculos: number
    /** El número que justifica el módulo. */
    costoPorVehiculo: number | null
  }
  /** Personal al que se le puede marcar entrada. */
  empleados: { id: string; nombre: string }[]
}

/** Panel de turnos del período. `null` = migración 20260765 sin correr. */
export async function getPanelTurnos(
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<PanelTurnos | null> {
  try {
    const ahora = new Date()
    const [turnos, vehiculos, empleados] = await Promise.all([
      prisma.turno.findMany({
        where: {
          companyId,
          // Un turno cuenta en el período si ENTRÓ en él. Usar la salida
          // dejaría fuera los turnos todavía abiertos, que son justamente los
          // que interesan cuando se mira el panel a media jornada.
          entradaAt: { gte: desde, lte: hasta },
        },
        orderBy: { entradaAt: 'desc' },
        take: 500,
        select: {
          id: true,
          entradaAt: true,
          salidaAt: true,
          costoHora: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.colaVehiculo.count({
        where: { companyId, estado: 'ENTREGADO', entregadoAt: { gte: desde, lte: hasta } },
      }),
      prisma.user.findMany({
        where: { companyId, role: { not: 'CLIENTE' } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, email: true },
      }),
    ])

    const filas: TurnoFila[] = turnos.map((t) => {
      const horas = horasDeTurno(t.entradaAt, t.salidaAt, ahora)
      const costoHora = t.costoHora == null ? null : Number(t.costoHora)
      return {
        id: t.id,
        empleado: t.user.name || t.user.email || 'Sin nombre',
        userId: t.user.id,
        entradaAt: t.entradaAt,
        salidaAt: t.salidaAt,
        horas,
        costoHora,
        costo: costoHora == null ? 0 : Math.round(horas * costoHora * 100) / 100,
        abierto: t.salidaAt == null,
      }
    })

    const porEmpleado = new Map<string, ResumenEmpleado>()
    for (const f of filas) {
      const acc = porEmpleado.get(f.userId) ?? {
        userId: f.userId,
        nombre: f.empleado,
        turnos: 0,
        horas: 0,
        costo: 0,
      }
      acc.turnos += 1
      acc.horas += f.horas
      acc.costo += f.costo
      porEmpleado.set(f.userId, acc)
    }

    const horasTotal = Math.round(filas.reduce((a, f) => a + f.horas, 0) * 100) / 100
    const costoTotal = Math.round(filas.reduce((a, f) => a + f.costo, 0) * 100) / 100

    return {
      filas,
      porEmpleado: [...porEmpleado.values()]
        .map((e) => ({
          ...e,
          horas: Math.round(e.horas * 100) / 100,
          costo: Math.round(e.costo * 100) / 100,
        }))
        .sort((a, b) => b.horas - a.horas),
      abiertos: filas
        .filter((f) => f.abierto)
        .map((f) => ({
          userId: f.userId,
          nombre: f.empleado,
          entradaAt: f.entradaAt,
          horas: f.horas,
        })),
      kpis: {
        horas: horasTotal,
        costo: costoTotal,
        vehiculos,
        costoPorVehiculo: costoPorVehiculo(costoTotal, vehiculos),
      },
      empleados: empleados.map((e) => ({
        id: e.id,
        nombre: e.name || e.email || 'Sin nombre',
      })),
    }
  } catch {
    return null
  }
}
