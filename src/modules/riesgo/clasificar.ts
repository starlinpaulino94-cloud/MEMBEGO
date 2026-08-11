import 'server-only'

import {
  clasificarCliente,
  type DatosCliente,
  type Semaforo,
  type UmbralesRetencion,
} from '@/modules/riesgo/semaforo'

/**
 * Puente entre lo que devuelve Prisma y lo que necesita el semáforo.
 *
 * Existe para que ninguna pantalla vuelva a decidir qué significa «vigente» ni
 * de dónde sale la última visita. La regla vive en `semaforo.ts` (puro y
 * probado); esto solo traduce filas.
 */

/** La forma mínima que hay que pedirle a Prisma para poder clasificar. */
export interface FilaClasificable {
  memberships: Array<{
    estado: string
    fechaVencimiento: Date | null
    lavadosRestantes: number
    plan: { esIlimitado: boolean }
  }>
  visits: Array<{ fechaVisita: Date }>
}

/**
 * El `select` de Prisma correspondiente. Se exporta para que las pantallas no
 * lo copien: si mañana el semáforo necesita un campo más, se añade aquí y
 * todas lo traen — en vez de descubrir en producción que una tabla clasifica
 * con datos incompletos.
 */
export const SELECT_CLASIFICABLE = {
  memberships: {
    select: {
      estado: true,
      fechaVencimiento: true,
      lavadosRestantes: true,
      plan: { select: { esIlimitado: true } },
    },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
  visits: {
    select: { fechaVisita: true },
    orderBy: { fechaVisita: 'desc' as const },
    take: 1,
  },
}

export function datosDeFila(fila: FilaClasificable, ahora: Date = new Date()): DatosCliente {
  const m = fila.memberships[0]
  const vigente =
    !!m && m.estado === 'ACTIVA' && (m.fechaVencimiento == null || m.fechaVencimiento >= ahora)
  return {
    tieneVigente: vigente,
    fechaVencimiento: vigente ? (m?.fechaVencimiento ?? null) : null,
    usosRestantes: m?.lavadosRestantes ?? 0,
    esIlimitado: m?.plan.esIlimitado ?? false,
    ultimaVisita: fila.visits[0]?.fechaVisita ?? null,
    // Si no está vigente, su fecha de vencimiento es la del final de la
    // relación: es lo que mide cuánto hace que se fue.
    ultimoVencimiento: !vigente ? (m?.fechaVencimiento ?? null) : null,
    tuvoMembresia: !!m,
  }
}

export function semaforoDeFila(
  fila: FilaClasificable,
  umbrales: UmbralesRetencion,
  ahora: Date = new Date()
): Semaforo {
  return clasificarCliente(datosDeFila(fila, ahora), umbrales, ahora)
}
