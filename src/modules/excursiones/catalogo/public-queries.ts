/**
 * EXCURSIONES · Catálogo — Queries PÚBLICAS (sin RLS admin).
 *
 * Estas queries leyeron excursiones activas para clientes y visitantes.
 * No usan conEmpresa (RLS) porque el contexto público no tiene company_id
 * en el JWT — se resuelve el companyId desde el slug de la empresa.
 */

import { prisma } from '@/lib/prisma'
import type { Decimal } from '@prisma/client/runtime/library'

/** Convierte Decimal a number de forma segura (Prisma devuelve Decimal para campos Decimal). */
function toNum(d: Decimal | null): number | null {
  return d == null ? null : Number(d)
}

/** Convierte los Decimal de una fila de Prisma a number para el tipo ExcursionPublica. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(r: any): ExcursionPublica {
  return {
    ...r,
    impuestoPct: toNum(r.impuestoPct as unknown as Decimal | null),
    variantes: r.variantes.map((v: (typeof r.variantes)[number]) => ({
      ...v,
      precioAdulto: Number(v.precioAdulto),
      precioNino: toNum(v.precioNino as unknown as Decimal | null),
    })),
  }
}

export interface SalidaDisponible {
  id: string
  fecha: string
  horaSalida: string
  horaRegreso: string | null
  cupoDisponible: number
  agotada: boolean
  fechaPasada: boolean
}

export interface ExcursionPublica {
  id: string
  nombre: string
  slug: string
  descripcion: string | null
  portadaUrl: string | null
  galeria: unknown
  duracionMin: number | null
  ubicacion: string | null
  categoria: string | null
  moneda: string
  impuestoPct: number | null
  capacidad: number | null
  puntoSalida: string | null
  horaSalida: string | null
  horaRegreso: string | null
  incluye: string | null
  noIncluye: string | null
  politicas: string | null
  variantes: {
    id: string
    nombre: string
    precioAdulto: number
    precioNino: number | null
    capacidad: number | null
    orden: number
  }[]
  horarios: {
    id: string
    diasSemana: number[]
    horaSalida: string
    cupo: number | null
  }[]
  proximasSalidas: SalidaDisponible[]
  agotadaGlobal: boolean
  todasFechasPasadas: boolean
}

/** Días ISO (1 = lunes … 7 = domingo). */
const DIAS_SEMANA_MAP = {
  1: 1, // Lunes
  2: 2, // Martes
  3: 3, // Miércoles
  4: 4, // Jueves
  5: 5, // Viernes
  6: 6, // Sábado
  7: 0, // Domingo (JS Date: 0 = domingo)
} as const

/** Genera las próximas fechas para un día de la semana dado (próximos 90 días). */
function generarFechasParaDia(diaSemana: number, limiteDias = 90): string[] {
  const fechas: string[] = []
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  const targetDay = DIAS_SEMANA_MAP[diaSemana as keyof typeof DIAS_SEMANA_MAP] ?? diaSemana
  let fecha = new Date(hoy)
  const diff = (targetDay - fecha.getDay() + 7) % 7
  fecha.setDate(fecha.getDate() + diff)

  for (let i = 0; i < limiteDias; i += 7) {
    if (fecha > new Date()) {
      fechas.push(fecha.toISOString().split('T')[0])
    }
    fecha.setDate(fecha.getDate() + 7)
  }
  return fechas
}

/** Calcula disponibilidad para una excursión. */
async function calcularDisponibilidad(
  companyId: string,
  excursionId: string,
  capacidad: number | null,
  horarios: { id: string; diasSemana: number[]; horaSalida: string; cupo: number | null }[],
  horaRegreso: string | null
): Promise<{ proximasSalidas: SalidaDisponible[]; agotadaGlobal: boolean; todasFechasPasadas: boolean }> {
  if (!capacidad || capacidad <= 0 || horarios.length === 0) {
    return { proximasSalidas: [], agotadaGlobal: true, todasFechasPasadas: true }
  }

  // Obtener reservas confirmadas para esta excursión (próximos 90 días)
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const dentroDe90 = new Date(hoy)
  dentroDe90.setDate(dentroDe90.getDate() + 90)

  const reservas = await prisma.reservaExc.findMany({
    where: {
      companyId,
      excursionId,
      fecha: { gte: hoy, lte: dentroDe90 },
      estado: { notIn: ['CANCELADA', 'NO_SHOW', 'COMPLETADA'] },
    },
    select: { fecha: true, hora: true, adultos: true, ninos: true },
  })

  // Mapa de reservas por fecha+hora: { '2026-01-15|10:00': totalPasajeros }
  const reservasMap = new Map<string, number>()
  for (const r of reservas) {
    const fechaStr = r.fecha.toISOString().split('T')[0]
    const key = `${fechaStr}|${r.hora || ''}`
    reservasMap.set(key, (reservasMap.get(key) || 0) + r.adultos + r.ninos)
  }

  const capacidadTotal = capacidad ?? 0
  const salidas: SalidaDisponible[] = []

  for (const horario of horarios) {
    for (const diaSemana of horario.diasSemana) {
      const fechas = generarFechasParaDia(diaSemana)
      for (const fecha of fechas) {
        const key = `${fecha}|${horario.horaSalida}`
        const reservados = reservasMap.get(key) || 0
        const cupoEfectivo = capacidadTotal
        const cupoDisponible = Math.max(0, cupoEfectivo - reservados)
        const fechaObj = new Date(fecha)
        const fechaPasada = fechaObj < new Date(new Date().setHours(0, 0, 0, 0))
        const agotada = cupoDisponible <= 0 || fechaPasada

        salidas.push({
          id: `${horario.id}-${fecha}`,
          fecha,
          horaSalida: horario.horaSalida,
          horaRegreso: null,
          cupoDisponible,
          agotada,
          fechaPasada,
        })
      }
    }
  }

  // Agregar horaRegreso a todas las salidas (usar la de la excursión)
  salidas.forEach(s => { s.horaRegreso = null })

  // Ordenar por fecha y hora
  salidas.sort((a, b) => {
    const diff = new Date(a.fecha).getTime() - new Date(b.fecha).getTime()
    if (diff !== 0) return diff
    return a.horaSalida.localeCompare(b.horaSalida)
  })

  const ahora = new Date()
  ahora.setHours(0, 0, 0, 0)
  const salidasFuturas = salidas.filter((s) => new Date(s.fecha) >= ahora)
  const agotadaGlobal = salidasFuturas.length === 0 || salidasFuturas.every((s) => s.agotada)
  const todasFechasPasadas = salidas.every((s) => s.fechaPasada)

  return { proximasSalidas: salidas, agotadaGlobal, todasFechasPasadas }
}

/** Excursiones ACTIVAS de una empresa, para listados públicos. */
export async function excursionesPublicas(companyId: string): Promise<ExcursionPublica[]> {
  const rows = await prisma.excursion.findMany({
    where: { companyId, estado: 'ACTIVA' },
    orderBy: { nombre: 'asc' },
    select: {
      id: true,
      nombre: true,
      slug: true,
      descripcion: true,
      portadaUrl: true,
      galeria: true,
      duracionMin: true,
      ubicacion: true,
      categoria: true,
      moneda: true,
      impuestoPct: true,
      capacidad: true,
      puntoSalida: true,
      horaSalida: true,
      horaRegreso: true,
      incluye: true,
      noIncluye: true,
      politicas: true,
      variantes: {
        where: { activa: true },
        orderBy: { orden: 'asc' },
        select: {
          id: true,
          nombre: true,
          precioAdulto: true,
          precioNino: true,
          capacidad: true,
          orden: true,
        },
      },
      horarios: {
        where: { activo: true },
        orderBy: { horaSalida: 'asc' },
        select: {
          id: true,
          diasSemana: true,
          horaSalida: true,
          cupo: true,
        },
      },
    },
  })

  // Calcular disponibilidad para cada excursión en paralelo
  const excursionesConDisponibilidad = await Promise.all(
    rows.map(async (exc) => {
      const disponibilidad = await calcularDisponibilidad(
        companyId,
        exc.id,
        exc.capacidad,
        exc.horarios as { id: string; diasSemana: number[]; horaSalida: string; cupo: number | null }[],
        exc.horaRegreso
      )
      const mapped = mapRow({
        ...exc,
        ...disponibilidad,
      })
      return mapped
    })
  )

  return excursionesConDisponibilidad
}

/** Detalle de una excursión pública por slug. */
export async function excursionPublica(
  companyId: string,
  slug: string
): Promise<ExcursionPublica | null> {
  const row = await prisma.excursion.findFirst({
    where: { companyId, slug, estado: 'ACTIVA' },
    select: {
      id: true,
      nombre: true,
      slug: true,
      descripcion: true,
      portadaUrl: true,
      galeria: true,
      duracionMin: true,
      ubicacion: true,
      categoria: true,
      moneda: true,
      impuestoPct: true,
      capacidad: true,
      puntoSalida: true,
      horaSalida: true,
      horaRegreso: true,
      incluye: true,
      noIncluye: true,
      politicas: true,
      variantes: {
        where: { activa: true },
        orderBy: { orden: 'asc' },
        select: {
          id: true,
          nombre: true,
          precioAdulto: true,
          precioNino: true,
          capacidad: true,
          orden: true,
        },
      },
      horarios: {
        where: { activo: true },
        orderBy: { horaSalida: 'asc' },
        select: {
          id: true,
          diasSemana: true,
          horaSalida: true,
          cupo: true,
        },
      },
    },
  })
  if (!row) return null

  const disponibilidad = await calcularDisponibilidad(
    companyId,
    row.id,
    row.capacidad,
    row.horarios as { id: string; diasSemana: number[]; horaSalida: string; cupo: number | null }[],
    row.horaRegreso
  )

  return mapRow({
    ...row,
    ...disponibilidad,
  })
}

/** Reserva de una excursión por ID (para páginas de confirmación). */
export async function excursionPorId(
  companyId: string,
  excursionId: string
): Promise<ExcursionPublica | null> {
  const row = await prisma.excursion.findFirst({
    where: { id: excursionId, companyId, estado: 'ACTIVA' },
    select: {
      id: true,
      nombre: true,
      slug: true,
      descripcion: true,
      portadaUrl: true,
      galeria: true,
      duracionMin: true,
      ubicacion: true,
      categoria: true,
      moneda: true,
      impuestoPct: true,
      capacidad: true,
      puntoSalida: true,
      horaSalida: true,
      horaRegreso: true,
      incluye: true,
      noIncluye: true,
      politicas: true,
      variantes: {
        where: { activa: true },
        orderBy: { orden: 'asc' },
        select: {
          id: true,
          nombre: true,
          precioAdulto: true,
          precioNino: true,
          capacidad: true,
          orden: true,
        },
      },
      horarios: {
        where: { activo: true },
        orderBy: { horaSalida: 'asc' },
        select: {
          id: true,
          diasSemana: true,
          horaSalida: true,
          cupo: true,
        },
      },
    },
  })
  if (!row) return null

  const disponibilidad = await calcularDisponibilidad(
    companyId,
    row.id,
    row.capacidad,
    row.horarios as { id: string; diasSemana: number[]; horaSalida: string; cupo: number | null }[],
    row.horaRegreso
  )

  return mapRow({
    ...row,
    ...disponibilidad,
  })
}

/** companyId desde slug de empresa (para resolver en páginas públicas). */
export async function companyIdPorSlug(slug: string): Promise<string | null> {
  const company = await prisma.company.findUnique({
    where: { slug },
    select: { id: true },
  })
  return company?.id ?? null
}