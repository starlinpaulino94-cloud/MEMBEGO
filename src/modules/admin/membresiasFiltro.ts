import type { Prisma } from '@prisma/client'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import {
  DIAS_PARA_VENCER,
  DIAS_SIN_VISITAS,
  dentroDeDias,
  haceDias,
  leerVentana,
} from '@/modules/admin/filtrosComunes'

/**
 * Filtros de la pantalla de Membresías — UNA definición, tres consumidores
 * (la tabla, su exportación y los enlaces del Resumen).
 *
 * Antes había un solo filtro —el estado— y los avisos del panel («2 membresías
 * vencen esta semana») llevaban a la lista completa sin filtrar: el sistema
 * identificaba a las dos personas a las que llamar y después dejaba al
 * administrador buscándolas a mano. Estos filtros son el destino que faltaba.
 */

/** Los chips de estado. «Vigentes» no es un estado: es estado + fecha. */
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

export const USOS_OPCIONES = [
  { clave: 'con', label: 'Con usos por consumir' },
  { clave: 'sin', label: 'Sin usos' },
] as const

export interface FiltrosMembresias {
  estado?: string
  q?: string
  /** Vence dentro de N días (7, 15 o 30). Implica vigente. */
  vence?: string
  /** 'con' | 'sin' usos restantes. */
  usos?: string
  /** El cliente no viene desde hace N días. */
  sinVisitas?: string
  /** Id de plan. */
  plan?: string
  /** Id de categoría de vehículo (del cliente). */
  vehiculo?: string
}

/** Los filtros que están puestos ahora mismo, ya validados. */
export function leerFiltrosMembresias(sp: Record<string, string | undefined>) {
  return {
    estado: estadoValido(sp.estado),
    q: (sp.q ?? '').trim(),
    vence: leerVentana(sp.vence, DIAS_PARA_VENCER),
    usos: sp.usos === 'con' || sp.usos === 'sin' ? sp.usos : undefined,
    sinVisitas: leerVentana(sp.sinVisitas, DIAS_SIN_VISITAS),
    plan: sp.plan?.trim() || undefined,
    vehiculo: sp.vehiculo?.trim() || undefined,
  }
}

export type FiltrosMembresiasLeidos = ReturnType<typeof leerFiltrosMembresias>

/**
 * Traduce los filtros a una consulta.
 *
 * TODO va dentro de un único `AND`. Es deliberado: varias condiciones necesitan
 * su propio `OR` (vigencia, búsqueda, usos de un plan ilimitado) y al ponerlas
 * como claves sueltas del mismo objeto, la última pisaría a la anterior **en
 * silencio** — la lista saldría mal filtrada sin ningún error. Con una lista de
 * condiciones, añadir un filtro nuevo no puede romper los que ya había.
 */
export function whereMembresias(
  companyId: string | null | undefined,
  filtros: FiltrosMembresias,
  ahora: Date = new Date()
): Prisma.MembershipWhereInput {
  const f = leerFiltrosMembresias(filtros as Record<string, string | undefined>)
  const condiciones: Prisma.MembershipWhereInput[] = []

  if (f.estado === 'ACTIVA') condiciones.push(membresiaVigente(ahora))
  else if (f.estado) condiciones.push({ estado: f.estado })

  if (f.vence) {
    // Vencer implica estar vigente: una membresía vencida hace un mes no
    // «vence en 7 días». Se añade aunque el chip de estado no esté puesto.
    condiciones.push(membresiaVigente(ahora))
    condiciones.push({ fechaVencimiento: { gte: ahora, lte: dentroDeDias(f.vence, ahora) } })
  }

  if (f.usos === 'con') {
    // Un plan ilimitado SIEMPRE tiene usos: no se le puede exigir un contador.
    condiciones.push({
      OR: [{ plan: { esIlimitado: true } }, { lavadosRestantes: { gt: 0 } }],
    })
  } else if (f.usos === 'sin') {
    condiciones.push({ plan: { esIlimitado: false }, lavadosRestantes: { lte: 0 } })
  }

  if (f.sinVisitas) {
    // Del CLIENTE, no de esta membresía: lo que importa es si la persona pisó
    // el negocio, con la membresía que sea. `none` incluye a quien no ha
    // venido nunca, que es justamente el caso más urgente.
    condiciones.push({
      cliente: { visits: { none: { fechaVisita: { gte: haceDias(f.sinVisitas, ahora) } } } },
    })
  }

  if (f.plan) condiciones.push({ planId: f.plan })

  if (f.vehiculo) {
    // Por la categoría del vehículo del CLIENTE y no por la asociada a la
    // membresía: las membresías anteriores al rediseño no tienen vehículo
    // asociado y desaparecerían del filtro sin que nadie entendiera por qué.
    condiciones.push({ cliente: { vehiculos: { some: { tipoVehiculoId: f.vehiculo } } } })
  }

  if (f.q) {
    condiciones.push({
      OR: [
        { cliente: { nombre: { contains: f.q, mode: 'insensitive' } } },
        { cliente: { email: { contains: f.q, mode: 'insensitive' } } },
        { cliente: { telefono: { contains: f.q } } },
        { plan: { nombre: { contains: f.q, mode: 'insensitive' } } },
      ],
    })
  }

  return {
    ...(companyId ? { cliente: { companyId } } : {}),
    ...(condiciones.length ? { AND: condiciones } : {}),
  }
}

/** ¿Hay algún filtro puesto además de la búsqueda? Para ofrecer «limpiar». */
export function hayFiltrosMembresias(f: FiltrosMembresiasLeidos): boolean {
  return Boolean(f.estado || f.vence || f.usos || f.sinVisitas || f.plan || f.vehiculo)
}
