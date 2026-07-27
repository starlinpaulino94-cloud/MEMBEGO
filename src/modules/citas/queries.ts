import { prisma } from '@/lib/prisma'
import {
  normalizarHorarios,
  slotsDelDia,
  utcDesdeLocal,
  sumarDias,
  diaSemanaDeYmd,
  ymdEnTz,
  type HorarioSemanal,
} from '@/modules/citas/disponibilidad'

/**
 * Módulo de Citas · consultas. Multi-tenant: todo se filtra por companyId.
 */

/** Estados que OCUPAN cupo (cuentan contra los límites por turno y por día). */
export const ESTADOS_ACTIVOS = ['PENDIENTE', 'CONFIRMADA'] as const

export interface AgendaConfigData {
  id: string
  activa: boolean
  duracionMin: number
  maxPorSlot: number
  maxPorDia: number
  anticipacionHoras: number
  ventanaDias: number
  autoConfirmar: boolean
  notas: string | null
  horarios: HorarioSemanal
}

export async function getAgendaConfig(companyId: string): Promise<AgendaConfigData | null> {
  const cfg = await prisma.agendaConfig.findUnique({ where: { companyId } })
  if (!cfg) return null
  return {
    id: cfg.id,
    activa: cfg.activa,
    duracionMin: cfg.duracionMin,
    maxPorSlot: cfg.maxPorSlot,
    maxPorDia: cfg.maxPorDia,
    anticipacionHoras: cfg.anticipacionHoras,
    ventanaDias: cfg.ventanaDias,
    autoConfirmar: cfg.autoConfirmar,
    notas: cfg.notas,
    horarios: normalizarHorarios(cfg.horarios),
  }
}

export interface SlotDisponible {
  hm: string
  inicioIso: string
  /** Cupos libres en el turno (0 = lleno). */
  libres: number
  /** true si el turno ya no admite reserva (pasado/anticipación). */
  vencido: boolean
}

export interface DisponibilidadDia {
  ymd: string
  cerrado: boolean
  limiteDiaAlcanzado: boolean
  slots: SlotDisponible[]
}

/**
 * Disponibilidad de un día: turnos del horario con sus cupos reales.
 * Los límites: `maxPorSlot` por turno y `maxPorDia` por día (0 = sin límite).
 */
export async function getDisponibilidadDia(
  companyId: string,
  cfg: AgendaConfigData,
  ymd: string,
  timeZone: string
): Promise<DisponibilidadDia> {
  const slots = slotsDelDia(cfg.horarios, ymd, cfg.duracionMin, timeZone)
  if (slots.length === 0) {
    return { ymd, cerrado: true, limiteDiaAlcanzado: false, slots: [] }
  }

  const inicioDia = utcDesdeLocal(ymd, '00:00', timeZone)
  const finDia = utcDesdeLocal(sumarDias(ymd, 1), '00:00', timeZone)
  const citas = await prisma.cita.findMany({
    where: {
      companyId,
      estado: { in: [...ESTADOS_ACTIVOS] },
      inicio: { gte: inicioDia, lt: finDia },
    },
    select: { inicio: true },
  })

  const porSlot = new Map<number, number>()
  for (const c of citas) {
    const k = c.inicio.getTime()
    porSlot.set(k, (porSlot.get(k) ?? 0) + 1)
  }
  const limiteDiaAlcanzado = cfg.maxPorDia > 0 && citas.length >= cfg.maxPorDia
  const corte = Date.now() + cfg.anticipacionHoras * 3600_000

  return {
    ymd,
    cerrado: false,
    limiteDiaAlcanzado,
    slots: slots.map((s) => ({
      hm: s.hm,
      inicioIso: s.inicio.toISOString(),
      libres: Math.max(0, cfg.maxPorSlot - (porSlot.get(s.inicio.getTime()) ?? 0)),
      vencido: s.inicio.getTime() < corte,
    })),
  }
}

export interface DiaAgenda {
  ymd: string
  etiquetaCerrado: boolean
}

/** Días reservables de la ventana (hoy → ventanaDias), marcando los cerrados. */
export function diasDeVentana(cfg: AgendaConfigData, timeZone: string): DiaAgenda[] {
  const hoy = ymdEnTz(new Date(), timeZone)
  const out: DiaAgenda[] = []
  for (let i = 0; i < Math.max(1, cfg.ventanaDias); i++) {
    const ymd = sumarDias(hoy, i)
    const abierto = (cfg.horarios[String(diaSemanaDeYmd(ymd, timeZone))] ?? []).length > 0
    out.push({ ymd, etiquetaCerrado: !abierto })
  }
  return out
}

/** Citas del cliente (próximas primero, luego historial reciente). */
export async function getCitasCliente(clienteId: string) {
  return prisma.cita.findMany({
    where: { clienteId },
    include: {
      vehiculo: { select: { marca: true, modelo: true } },
      sucursal: { select: { nombre: true } },
    },
    orderBy: { inicio: 'desc' },
    take: 30,
  })
}

/** Agenda del día para el panel (todas las citas, orden cronológico). */
export async function getCitasDia(companyId: string, ymd: string, timeZone: string) {
  const inicioDia = utcDesdeLocal(ymd, '00:00', timeZone)
  const finDia = utcDesdeLocal(sumarDias(ymd, 1), '00:00', timeZone)
  return prisma.cita.findMany({
    where: { companyId, inicio: { gte: inicioDia, lt: finDia } },
    include: {
      cliente: { select: { id: true, nombre: true, telefono: true } },
      vehiculo: { select: { marca: true, modelo: true, color: true } },
      sucursal: { select: { nombre: true } },
      atendidaPor: { select: { name: true } },
    },
    orderBy: { inicio: 'asc' },
  })
}

// ─── Agenda completa (panel de la empresa) ──────────────────────────────────

/**
 * Rango temporal de la agenda. El panel ya no muestra SOLO el día de hoy: por
 * defecto abre en "próximas" (de ahora en adelante), que es lo que el negocio
 * necesita para prepararse, y desde ahí se puede ver todo o mirar atrás.
 */
export const RANGOS_AGENDA = ['proximas', 'hoy', 'semana', 'pasadas', 'todas'] as const
export type RangoAgenda = (typeof RANGOS_AGENDA)[number]

export const RANGO_LABELS: Record<RangoAgenda, string> = {
  proximas: 'Próximas',
  hoy: 'Hoy',
  semana: 'Próximos 7 días',
  pasadas: 'Pasadas',
  todas: 'Todas',
}

export const ESTADOS_CITA = [
  'PENDIENTE',
  'CONFIRMADA',
  'COMPLETADA',
  'CANCELADA',
  'NO_ASISTIO',
] as const
export type EstadoCita = (typeof ESTADOS_CITA)[number]

export interface FiltrosAgenda {
  rango: RangoAgenda
  /** null = todos los estados. */
  estado: EstadoCita | null
  /** Búsqueda por nombre o teléfono del cliente. */
  q: string
  /** Página (1-based). */
  pagina: number
}

/** Normaliza los parámetros de la URL a filtros válidos (nunca lanza). */
export function leerFiltrosAgenda(sp: {
  rango?: string
  estado?: string
  q?: string
  p?: string
}): FiltrosAgenda {
  const rango = (RANGOS_AGENDA as readonly string[]).includes(sp.rango ?? '')
    ? (sp.rango as RangoAgenda)
    : 'proximas'
  const estado = (ESTADOS_CITA as readonly string[]).includes(sp.estado ?? '')
    ? (sp.estado as EstadoCita)
    : null
  const pagina = Math.max(1, Number.parseInt(sp.p ?? '1', 10) || 1)
  return { rango, estado, q: (sp.q ?? '').trim().slice(0, 60), pagina }
}

const POR_PAGINA = 25

/** Traduce el rango elegido a un filtro de fechas sobre `inicio`. */
function ventanaDeRango(rango: RangoAgenda, timeZone: string) {
  const ahora = new Date()
  const hoyYmd = ymdEnTz(ahora, timeZone)
  switch (rango) {
    case 'hoy':
      return {
        gte: utcDesdeLocal(hoyYmd, '00:00', timeZone),
        lt: utcDesdeLocal(sumarDias(hoyYmd, 1), '00:00', timeZone),
      }
    case 'semana':
      return {
        gte: utcDesdeLocal(hoyYmd, '00:00', timeZone),
        lt: utcDesdeLocal(sumarDias(hoyYmd, 7), '00:00', timeZone),
      }
    case 'pasadas':
      return { lt: ahora }
    case 'todas':
      return undefined
    case 'proximas':
    default:
      return { gte: ahora }
  }
}

export interface AgendaPagina {
  citas: Awaited<ReturnType<typeof getCitasDia>>
  total: number
  pagina: number
  totalPaginas: number
  /** Conteo por estado dentro del rango (sin aplicar el filtro de estado). */
  porEstado: Record<EstadoCita, number>
}

/**
 * Agenda completa con filtros y paginación. Devuelve además el conteo por
 * estado del rango para que las pestañas muestren números reales.
 */
export async function getAgenda(
  companyId: string,
  filtros: FiltrosAgenda,
  timeZone: string
): Promise<AgendaPagina> {
  const inicio = ventanaDeRango(filtros.rango, timeZone)
  const q = filtros.q
  const baseWhere = {
    companyId,
    ...(inicio ? { inicio } : {}),
    ...(q
      ? {
          cliente: {
            OR: [
              { nombre: { contains: q, mode: 'insensitive' as const } },
              { telefono: { contains: q } },
            ],
          },
        }
      : {}),
  }
  const where = { ...baseWhere, ...(filtros.estado ? { estado: filtros.estado } : {}) }

  // Las pasadas se leen de la más reciente hacia atrás; el resto, cronológico.
  const orden = filtros.rango === 'pasadas' ? 'desc' : 'asc'

  const [citas, total, agrupado] = await Promise.all([
    prisma.cita.findMany({
      where,
      include: {
        cliente: { select: { id: true, nombre: true, telefono: true } },
        vehiculo: { select: { marca: true, modelo: true, color: true } },
        sucursal: { select: { nombre: true } },
        atendidaPor: { select: { name: true } },
      },
      orderBy: { inicio: orden },
      skip: (filtros.pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
    }),
    prisma.cita.count({ where }),
    prisma.cita.groupBy({ by: ['estado'], where: baseWhere, _count: { _all: true } }),
  ])

  const porEstado = Object.fromEntries(ESTADOS_CITA.map((e) => [e, 0])) as Record<
    EstadoCita,
    number
  >
  for (const g of agrupado) {
    const k = g.estado as EstadoCita
    if (k in porEstado) porEstado[k] = g._count._all
  }

  return {
    citas,
    total,
    pagina: filtros.pagina,
    totalPaginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
    porEstado,
  }
}
