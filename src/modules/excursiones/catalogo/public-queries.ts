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

// Exportar funciones internas para uso en search-queries.ts
export { mapRow, calcularDisponibilidad }

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
  tipoItem?: string
  comboItems?: {
    horaSalida?: string | null
    permitirSolapamiento?: boolean
    horarioFijo?: unknown
    actividad: {
      id: string
      nombre: string
      slug: string
      tipoItem?: string | null
      portadaUrl: string | null
      duracionMin: number | null
      horaSalida: string | null
      horaRegreso: string | null
      categoria: string | null
      horarios?: {
        id: string
        horaSalida: string
        diasSemana: number[]
        cupo: number | null
      }[]
    }
  }[]
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
  const fecha = new Date(hoy)
  const diff = (targetDay - fecha.getDay() + 7) % 7
  fecha.setDate(fecha.getDate() + diff)

  for (let i = 0; i < limiteDias; i += 7) {
    if (fecha >= hoy) {
      fechas.push(fecha.toISOString().split('T')[0])
    }
    fecha.setDate(fecha.getDate() + 7)
  }
  return fechas
}

export interface ChildActividadParaCombo {
  horaSalida?: string | null
  permitirSolapamiento?: boolean
  horarioFijo?: string | null
  actividad: {
    id: string
    nombre: string
    tipoItem?: string | null
    capacidad: number | null
    horaSalida?: string | null
    horaRegreso?: string | null
    horarios?: { id: string; diasSemana: number[]; horaSalida: string; cupo: number | null }[]
  }
}

/** Calcula disponibilidad para una excursión o combo considerando reservas directas e indirectas. */
async function calcularDisponibilidad(
  companyId: string,
  excursionId: string,
  capacidad: number | null,
  horarios: { id: string; diasSemana: number[]; horaSalida: string; cupo: number | null }[],
  horaRegreso: string | null,
  horaSalidaFallback?: string | null,
  tipoItem?: string | null,
  comboItems?: ChildActividadParaCombo[] | null
): Promise<{ proximasSalidas: SalidaDisponible[]; agotadaGlobal: boolean; todasFechasPasadas: boolean }> {
  const esPaseDia = tipoItem === 'PASE_DIA'
  const esCombo = tipoItem === 'COMBO'
  const effectiveHorarios =
    horarios && horarios.length > 0
      ? horarios
      : esPaseDia
        ? [
            {
              id: `default-${excursionId}`,
              diasSemana: [1, 2, 3, 4, 5, 6, 7],
              horaSalida: '00:00',
              cupo: null,
            },
          ]
        : horaSalidaFallback
          ? [
              {
                id: `default-${excursionId}`,
                diasSemana: [1, 2, 3, 4, 5, 6, 7],
                horaSalida: horaSalidaFallback,
                cupo: null,
              },
            ]
          : []

  if (effectiveHorarios.length === 0) {
    return { proximasSalidas: [], agotadaGlobal: true, todasFechasPasadas: true }
  }

  // Obtener reservas confirmadas para esta excursión (próximos 90 días)
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const dentroDe90 = new Date(hoy)
  dentroDe90.setDate(dentroDe90.getDate() + 90)

  // 1. Reservas directas de la actividad o combo
  // 2. Reservas donde esta actividad fue reservada como ítem de un combo (ReservaItem)
  const [reservasDirectas, reservasItems] = await Promise.all([
    prisma.reservaExc.findMany({
      where: {
        companyId,
        excursionId,
        fecha: { gte: hoy, lte: dentroDe90 },
        estado: { notIn: ['CANCELADA', 'NO_SHOW', 'REEMBOLSADA'] },
      },
      select: { fecha: true, hora: true, adultos: true, ninos: true },
    }),
    prisma.reservaItem.findMany({
      where: {
        companyId,
        actividadId: excursionId,
        fecha: { gte: hoy, lte: dentroDe90 },
        estado: { notIn: ['CANCELADA'] },
        reserva: {
          estado: { notIn: ['CANCELADA', 'NO_SHOW', 'REEMBOLSADA'] },
        },
      },
      select: { fecha: true, hora: true, adultos: true, ninos: true },
    }),
  ])

  // Mapa de reservas unificado por fecha+hora o solo fecha si es pase de día
  const reservasMap = new Map<string, number>()
  for (const r of reservasDirectas) {
    const fechaStr = r.fecha.toISOString().split('T')[0]
    const horaStr = (r.hora || '').trim().slice(0, 5)
    const key = esPaseDia ? fechaStr : `${fechaStr}|${horaStr}`
    reservasMap.set(key, (reservasMap.get(key) || 0) + r.adultos + r.ninos)
  }
  for (const r of reservasItems) {
    const fechaStr = r.fecha.toISOString().split('T')[0]
    const horaStr = (r.hora || '').trim().slice(0, 5)
    const key = esPaseDia ? fechaStr : `${fechaStr}|${horaStr}`
    reservasMap.set(key, (reservasMap.get(key) || 0) + r.adultos + r.ninos)
  }

  // 3. Si es un COMBO, obtener también la ocupación de todas sus actividades hijas
  const childReservasMap = new Map<string, number>()
  let childActividades: ChildActividadParaCombo[] = []

  if (esCombo) {
    if (comboItems && comboItems.length > 0) {
      childActividades = comboItems
    } else {
      const dbComboItems = await prisma.excursionComboItem.findMany({
        // `comboId` es el combo PADRE; `actividadId`, la actividad hija. Aquí
        // se piden las hijas de este combo, así que el filtro va por el padre.
        where: { comboId: excursionId },
        select: {
          horaSalida: true,
          actividad: {
            select: {
              id: true,
              nombre: true,
              tipoItem: true,
              capacidad: true,
              horaSalida: true,
              horaRegreso: true,
              horarios: {
                where: { activo: true },
                select: { id: true, horaSalida: true, diasSemana: true, cupo: true },
              },
            },
          },
        },
      })
      childActividades = dbComboItems as unknown as ChildActividadParaCombo[]
    }

    const childIds = childActividades.map((ci) => ci.actividad?.id).filter(Boolean)
    if (childIds.length > 0) {
      const [childDirectas, childCombos] = await Promise.all([
        prisma.reservaExc.findMany({
          where: {
            companyId,
            excursionId: { in: childIds },
            fecha: { gte: hoy, lte: dentroDe90 },
            estado: { notIn: ['CANCELADA', 'NO_SHOW', 'REEMBOLSADA'] },
          },
          select: { excursionId: true, fecha: true, hora: true, adultos: true, ninos: true },
        }),
        prisma.reservaItem.findMany({
          where: {
            companyId,
            actividadId: { in: childIds },
            fecha: { gte: hoy, lte: dentroDe90 },
            estado: { notIn: ['CANCELADA'] },
            reserva: {
              estado: { notIn: ['CANCELADA', 'NO_SHOW', 'REEMBOLSADA'] },
            },
          },
          select: { actividadId: true, fecha: true, hora: true, adultos: true, ninos: true },
        }),
      ])

      for (const r of childDirectas) {
        const fechaStr = r.fecha.toISOString().split('T')[0]
        const horaStr = (r.hora || '').trim().slice(0, 5)
        const key = `${r.excursionId}|${fechaStr}|${horaStr}`
        const keyDia = `${r.excursionId}|${fechaStr}`
        childReservasMap.set(key, (childReservasMap.get(key) || 0) + r.adultos + r.ninos)
        childReservasMap.set(keyDia, (childReservasMap.get(keyDia) || 0) + r.adultos + r.ninos)
      }
      for (const r of childCombos) {
        const fechaStr = r.fecha.toISOString().split('T')[0]
        const horaStr = (r.hora || '').trim().slice(0, 5)
        const key = `${r.actividadId}|${fechaStr}|${horaStr}`
        const keyDia = `${r.actividadId}|${fechaStr}`
        childReservasMap.set(key, (childReservasMap.get(key) || 0) + r.adultos + r.ninos)
        childReservasMap.set(keyDia, (childReservasMap.get(keyDia) || 0) + r.adultos + r.ninos)
      }
    }
  }

  const capacidadTotal = capacidad && capacidad > 0 ? capacidad : 50
  const salidas: SalidaDisponible[] = []
  const ahoraTimestamp = Date.now()

  for (const horario of effectiveHorarios) {
    const dias = Array.isArray(horario.diasSemana) ? horario.diasSemana : [1, 2, 3, 4, 5, 6, 7]
    for (const diaSemana of dias) {
      const fechas = generarFechasParaDia(diaSemana)
      for (const fecha of fechas) {
        const horaSalida = esPaseDia ? '' : (horario.horaSalida || '00:00').trim().slice(0, 5)
        const key = esPaseDia ? fecha : `${fecha}|${horaSalida}`
        const reservados = reservasMap.get(key) || 0
        const cupoEfectivo = horario.cupo && horario.cupo > 0 ? horario.cupo : capacidadTotal
        let cupoDisponible = Math.max(0, cupoEfectivo - reservados)

        // Si es un combo, acotar el cupo disponible por la menor disponibilidad entre sus actividades hijas
        if (esCombo && childActividades.length > 0) {
          const [y, m, d] = fecha.split('-').map(Number)
          const fechaObj = new Date(Date.UTC(y, m - 1, d))
          const diaSemanaJS = fechaObj.getUTCDay()
          const diaSemanaISO = diaSemanaJS === 0 ? 7 : diaSemanaJS

          for (const ci of childActividades) {
            const act = ci.actividad
            if (!act) continue
            const childEsPaseDia = act.tipoItem === 'PASE_DIA'
            const childHora = childEsPaseDia
              ? ''
              : (ci.horaSalida || act.horaSalida || horario.horaSalida || '00:00').trim().slice(0, 5)

            // Verificar si la actividad hija opera este día de la semana
            let operaDia = true
            if (act.horarios && act.horarios.length > 0) {
              operaDia = act.horarios.some((h) =>
                Array.isArray(h.diasSemana) ? h.diasSemana.includes(diaSemanaISO) : true
              )
            }
            if (!operaDia) {
              cupoDisponible = 0
              break
            }

            const childKey = childEsPaseDia
              ? `${act.id}|${fecha}`
              : `${act.id}|${fecha}|${childHora}`

            const childCapBase = act.capacidad && act.capacidad > 0 ? act.capacidad : 50
            let childCupoTurno = childCapBase
            if (!childEsPaseDia && act.horarios && act.horarios.length > 0) {
              const hMatch = act.horarios.find(
                (h) => (h.horaSalida || '').trim().slice(0, 5) === childHora
              )
              if (hMatch?.cupo && hMatch.cupo > 0) {
                childCupoTurno = Math.min(childCupoTurno, hMatch.cupo)
              }
            }

            const childReservados = childReservasMap.get(childKey) || 0
            const childDisp = Math.max(0, childCupoTurno - childReservados)
            cupoDisponible = Math.min(cupoDisponible, childDisp)
          }
        }

        // Calcular timestamp exacto de la salida
        const [y, m, d] = fecha.split('-').map(Number)
        let salidaDate: Date
        if (esPaseDia) {
          salidaDate = new Date(y, m - 1, d, 23, 59, 59, 999)
        } else {
          const [hStr, mStr] = horaSalida.split(':')
          salidaDate = new Date(y, m - 1, d, Number(hStr || 0), Number(mStr || 0), 0, 0)
        }
        const fechaPasada = salidaDate.getTime() < ahoraTimestamp
        const agotada = cupoDisponible <= 0 || fechaPasada

        salidas.push({
          id: `${horario.id}-${fecha}`,
          fecha,
          horaSalida,
          horaRegreso: esPaseDia ? null : horaRegreso || null,
          cupoDisponible,
          agotada,
          fechaPasada,
        })
      }
    }
  }

  // Ordenar por fecha y hora
  salidas.sort((a, b) => {
    const diff = new Date(a.fecha).getTime() - new Date(b.fecha).getTime()
    if (diff !== 0) return diff
    return a.horaSalida.localeCompare(b.horaSalida)
  })

  const salidasFuturas = salidas.filter((s) => !s.fechaPasada)
  const agotadaGlobal = salidasFuturas.length === 0 || salidasFuturas.every((s) => s.agotada)
  const todasFechasPasadas = salidas.length === 0 || salidasFuturas.length === 0

  return { proximasSalidas: salidasFuturas, agotadaGlobal, todasFechasPasadas }
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
      tipoItem: true,
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
      comboItems: {
        orderBy: { orden: 'asc' },
        select: {
          horaSalida: true,
          permitirSolapamiento: true,
          horarioFijo: true,
          actividad: {
            select: {
              id: true,
              nombre: true,
              tipoItem: true,
              capacidad: true,
              horaSalida: true,
              horaRegreso: true,
              horarios: {
                where: { activo: true },
                select: { id: true, horaSalida: true, diasSemana: true, cupo: true },
              },
            },
          },
        },
      },
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
        exc.horaRegreso,
        exc.horaSalida,
        exc.tipoItem,
        exc.comboItems as unknown as ChildActividadParaCombo[]
      )
      const mapped = mapRow({
        ...exc,
        ...disponibilidad,
      })
      return mapped
    })
  )

  // Filtrar solo las vigentes con salidas futuras y ordenar por fecha de salida más próxima
  const vigentes = excursionesConDisponibilidad.filter(
    (e) => !e.todasFechasPasadas && e.proximasSalidas && e.proximasSalidas.length > 0
  )

  vigentes.sort((a, b) => {
    const fechaA = a.proximasSalidas[0]?.fecha ? new Date(a.proximasSalidas[0].fecha).getTime() : Infinity
    const fechaB = b.proximasSalidas[0]?.fecha ? new Date(b.proximasSalidas[0].fecha).getTime() : Infinity
    if (fechaA !== fechaB) return fechaA - fechaB
    return a.nombre.localeCompare(b.nombre)
  })

  return vigentes
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
      tipoItem: true,
      comboItems: {
        orderBy: { orden: 'asc' },
        select: {
          horaSalida: true,
          permitirSolapamiento: true,
          horarioFijo: true,
          actividad: {
            select: {
              id: true,
              nombre: true,
              tipoItem: true,
              slug: true,
              portadaUrl: true,
              duracionMin: true,
              horaSalida: true,
              horaRegreso: true,
              categoria: true,
              horarios: {
                where: { activo: true },
                orderBy: { horaSalida: 'asc' },
                select: { id: true, horaSalida: true, diasSemana: true, cupo: true },
              },
            },
          },
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
    row.horaRegreso,
    row.horaSalida,
    row.tipoItem,
    row.comboItems as unknown as ChildActividadParaCombo[]
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
      tipoItem: true,
      comboItems: {
        orderBy: { orden: 'asc' },
        select: {
          horaSalida: true,
          permitirSolapamiento: true,
          horarioFijo: true,
          actividad: {
            select: {
              id: true,
              nombre: true,
              tipoItem: true,
              slug: true,
              portadaUrl: true,
              duracionMin: true,
              horaSalida: true,
              horaRegreso: true,
              categoria: true,
              horarios: {
                where: { activo: true },
                orderBy: { horaSalida: 'asc' },
                select: { id: true, horaSalida: true, diasSemana: true, cupo: true },
              },
            },
          },
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
    row.horaRegreso,
    row.horaSalida,
    row.tipoItem,
    row.comboItems as unknown as ChildActividadParaCombo[]
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