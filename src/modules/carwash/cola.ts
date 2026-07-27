import { prisma } from '@/lib/prisma'

/**
 * App Car Wash · E5 — COLA DE VEHÍCULOS (pista).
 * Estados como String en BD (sin enum) validados aquí; el flujo es lineal:
 * EN_ESPERA → EN_SERVICIO → LISTO → ENTREGADO, con CANCELADO como salida
 * desde cualquier estado activo. Capacidad: COLA_VEHICULOS (nace apagada).
 */

export const COLA_ESTADOS = [
  'EN_ESPERA',
  'EN_SERVICIO',
  'LISTO',
  'ENTREGADO',
  'CANCELADO',
] as const
export type ColaEstado = (typeof COLA_ESTADOS)[number]

export const COLA_ESTADO_LABELS: Record<ColaEstado, string> = {
  EN_ESPERA: 'En espera',
  EN_SERVICIO: 'En servicio',
  LISTO: 'Listo',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelado',
}

/** Estados que mantienen el vehículo visible en el tablero. */
export const COLA_ACTIVOS: ColaEstado[] = ['EN_ESPERA', 'EN_SERVICIO', 'LISTO']

/** Transiciones permitidas desde cada estado (validadas en la acción). */
export const COLA_TRANSICIONES: Record<ColaEstado, ColaEstado[]> = {
  EN_ESPERA: ['EN_SERVICIO', 'CANCELADO'],
  EN_SERVICIO: ['LISTO', 'CANCELADO'],
  LISTO: ['ENTREGADO', 'CANCELADO'],
  ENTREGADO: [],
  CANCELADO: [],
}

/** Etiqueta del botón que lleva a cada estado destino. */
export const COLA_ACCION_LABELS: Record<string, string> = {
  EN_SERVICIO: 'Iniciar',
  LISTO: 'Listo',
  ENTREGADO: 'Entregar',
  CANCELADO: 'Cancelar',
}

const SELECT_ENTRADA = {
  id: true,
  placa: true,
  descripcion: true,
  servicio: true,
  notaInterna: true,
  estado: true,
  inicioAt: true,
  listoAt: true,
  entregadoAt: true,
  createdAt: true,
  cliente: { select: { id: true, nombre: true } },
  vehiculo: { select: { marca: true, modelo: true, placa: true } },
  /// Fase 2 · quién trabaja el vehículo. Sin esto la comisión no tiene dueño.
  atendidoPorId: true,
  _count: { select: { evidencias: true } },
} as const

export type ColaEntrada = Awaited<ReturnType<typeof getColaTablero>>['activos'][number]

/**
 * Tablero de la cola: entradas ACTIVAS (de cualquier fecha — un vehículo sin
 * entregar de ayer sigue pendiente) + terminadas del día (historial corto).
 */
export async function getColaTablero(companyId: string, inicioDia: Date) {
  const [activos, terminadosHoy] = await Promise.all([
    prisma.colaVehiculo.findMany({
      where: { companyId, estado: { in: COLA_ACTIVOS } },
      select: SELECT_ENTRADA,
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
    prisma.colaVehiculo.findMany({
      where: {
        companyId,
        estado: { in: ['ENTREGADO', 'CANCELADO'] },
        updatedAt: { gte: inicioDia },
      },
      select: SELECT_ENTRADA,
      orderBy: { updatedAt: 'desc' },
      take: 30,
    }),
  ])
  return { activos, terminadosHoy }
}
