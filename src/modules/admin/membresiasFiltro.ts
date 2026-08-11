import type { Prisma } from '@prisma/client'
import { membresiaVigente } from '@/modules/membresia/vigencia'

/**
 * Filtro de la pantalla de Membresías — UNA definición, dos consumidores
 * (la tabla y su exportación). Misma razón que en `clientesFiltro`: si cada
 * uno arma su `where`, el CSV se separa de lo que se ve en cuanto alguien
 * añada un filtro, y nadie se entera hasta que un informe cuadre mal.
 */

/** Los chips de la pantalla. «Vigentes» no es un estado: es estado + fecha. */
export const ESTADOS_MEMBRESIA = [
  { clave: 'ACTIVA', label: 'Vigentes' },
  { clave: 'PENDIENTE', label: 'Pendientes' },
  { clave: 'PENDIENTE_PAGO', label: 'Pend. pago' },
  { clave: 'RECHAZADA', label: 'Rechazadas' },
  { clave: 'VENCIDA', label: 'Vencidas' },
  { clave: 'CANCELADA', label: 'Canceladas' },
] as const

export type EstadoMembresiaClave = (typeof ESTADOS_MEMBRESIA)[number]['clave']

export function estadoValido(valor: string | undefined): EstadoMembresiaClave | undefined {
  return ESTADOS_MEMBRESIA.some((e) => e.clave === valor)
    ? (valor as EstadoMembresiaClave)
    : undefined
}

export function whereMembresias(
  companyId: string | null | undefined,
  filtros: { estado?: string; q?: string }
): Prisma.MembershipWhereInput {
  const estado = estadoValido(filtros.estado)
  const q = (filtros.q ?? '').trim()

  // El chip ACTIVA significa VIGENTE: activa Y sin vencer. Nada vencía las
  // membresías solas, así que este filtro enseñaba como activas membresías que
  // el escáner ya rechazaba (ver `modules/membresia/vigencia.ts`).
  const porEstado: Prisma.MembershipWhereInput =
    estado === 'ACTIVA' ? membresiaVigente() : estado ? { estado } : {}

  return {
    ...(companyId ? { cliente: { companyId } } : {}),
    ...porEstado,
    ...(q
      ? {
          OR: [
            { cliente: { nombre: { contains: q, mode: 'insensitive' as const } } },
            { cliente: { email: { contains: q, mode: 'insensitive' as const } } },
            { plan: { nombre: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }
}
