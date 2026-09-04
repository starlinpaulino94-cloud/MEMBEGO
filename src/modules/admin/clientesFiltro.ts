import type { Prisma } from '@prisma/client'
import { membresiaTerminada, membresiaVigente } from '@/modules/membresia/vigencia'
import {
  DIAS_PARA_VENCER,
  DIAS_SIN_VISITAS,
  dentroDeDias,
  haceDias,
  leerVentana,
} from '@/modules/admin/filtrosComunes'
import { normalizarBusqueda } from '@/modules/busqueda/normalizar'

/**
 * Filtros del directorio de clientes — UNA definición, varios consumidores
 * (la pantalla, su exportación y los enlaces desde Notificaciones y el Resumen).
 *
 * Los segmentos que el sistema ya calculaba —«sin visitas en 30 días»,
 * «membresías por vencer»— solo servían para MANDAR una notificación a ciegas:
 * devolvían identificadores y no había pantalla que dijera quiénes son. Estos
 * filtros son esa pantalla, y por eso sus nombres coinciden con los de los
 * segmentos: enlazar desde allí es poner una URL.
 */

export const MEMBRESIA_OPCIONES = [
  { clave: 'vigente', label: 'Con membresía vigente' },
  { clave: 'por_vencer', label: 'Membresía por vencer' },
  { clave: 'vencida', label: 'Membresía vencida' },
  { clave: 'sin', label: 'Sin membresía' },
] as const

export type MembresiaClave = (typeof MEMBRESIA_OPCIONES)[number]['clave']

export interface FiltrosClientes {
  q?: string
  /** Sin visitas en los últimos N días (incluye a quien nunca vino). */
  sinVisitas?: string
  /** Situación de su membresía. */
  membresia?: string
  /** Registrados en los últimos N días. */
  nuevos?: string
  /** Categoría de vehículo. */
  vehiculo?: string
  /** Ventana usada por `membresia=por_vencer` (7, 15 o 30 días). */
  vence?: string
}

export function leerFiltrosClientes(sp: Record<string, string | undefined>) {
  return {
    q: (sp.q ?? '').trim(),
    sinVisitas: leerVentana(sp.sinVisitas, DIAS_SIN_VISITAS),
    membresia: MEMBRESIA_OPCIONES.some((m) => m.clave === sp.membresia)
      ? (sp.membresia as MembresiaClave)
      : undefined,
    nuevos: leerVentana(sp.nuevos, [7, 30, 90] as const),
    vehiculo: sp.vehiculo?.trim() || undefined,
    vence: leerVentana(sp.vence, DIAS_PARA_VENCER) ?? 7,
  }
}

export type FiltrosClientesLeidos = ReturnType<typeof leerFiltrosClientes>

/**
 * Traduce los filtros a una consulta. Igual que en Membresías, todo va dentro
 * de un único `AND`: varias condiciones traen su propio `OR` y como claves
 * sueltas se pisarían en silencio.
 */
export function whereClientes(
  companyId: string | null | undefined,
  filtros: FiltrosClientes | string | undefined,
  ahora: Date = new Date()
): Prisma.ClienteWhereInput {
  // Compatibilidad: durante un tiempo esto recibía solo el texto de búsqueda.
  // Y tolerancia: una llamada sin filtros vale «todos», no un fallo.
  const entrada: FiltrosClientes =
    typeof filtros === 'string' ? { q: filtros } : (filtros ?? {})
  const f = leerFiltrosClientes(entrada as Record<string, string | undefined>)
  const condiciones: Prisma.ClienteWhereInput[] = []

  if (f.sinVisitas) {
    // `none` incluye a quien NUNCA ha venido. No es un efecto secundario: el
    // cliente que pagó y jamás apareció es el más urgente de la lista.
    condiciones.push({ visits: { none: { fechaVisita: { gte: haceDias(f.sinVisitas, ahora) } } } })
  }

  switch (f.membresia) {
    case 'vigente':
      condiciones.push({ memberships: { some: membresiaVigente(ahora) } })
      break
    case 'por_vencer':
      condiciones.push({
        memberships: {
          some: {
            ...membresiaVigente(ahora),
            fechaVencimiento: { gte: ahora, lte: dentroDeDias(f.vence, ahora) },
          },
        },
      })
      break
    case 'vencida':
      // Vencida Y sin ninguna vigente: quien renovó no está «vencido», está al
      // día, y aparecer en esta lista sería un error que cuesta una llamada.
      //
      // «Vencida» la decide `membresiaTerminada()`, que además de los estados
      // marcados incluye las que siguen diciendo ACTIVA porque el job diario no
      // pasó. Mirando solo el estado, esos clientes no salían en ningún filtro.
      condiciones.push({
        memberships: { some: membresiaTerminada(ahora) },
        NOT: { memberships: { some: membresiaVigente(ahora) } },
      })
      break
    case 'sin':
      condiciones.push({ memberships: { none: {} } })
      break
  }

  if (f.nuevos) condiciones.push({ createdAt: { gte: haceDias(f.nuevos, ahora) } })

  if (f.vehiculo) condiciones.push({ vehiculos: { some: { tipoVehiculoId: f.vehiculo } } })

  if (f.q) {
    condiciones.push({
      OR: [
        { nombreBusqueda: { contains: normalizarBusqueda(f.q) } },
        { email: { contains: f.q, mode: 'insensitive' } },
        { telefono: { contains: f.q } },
      ],
    })
  }

  return {
    // La búsqueda se ancla SIEMPRE a la empresa: el término lo escribe el
    // usuario, pero el `companyId` no es negociable ni viaja por la URL.
    ...(companyId ? { companyId } : {}),
    ...(condiciones.length ? { AND: condiciones } : {}),
  }
}

/** ¿Hay algún filtro además de la búsqueda? Para ofrecer «limpiar». */
export function hayFiltrosClientes(f: FiltrosClientesLeidos): boolean {
  return Boolean(f.sinVisitas || f.membresia || f.nuevos || f.vehiculo)
}
