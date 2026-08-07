import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import type { CampanaCanal, CampanaDirigidaEstado, Prisma } from '@prisma/client'
import { normalizarRaiz, type Nodo, type SegmentoRaiz } from './arbol'
import { estimarNodo, UMBRAL_MINIMO_AUDIENCIA, type Estimacion } from './estimador'
import { SegmentoServicio } from './segmentos'
import { RADIO_MAX_KM, RADIO_MIN_KM } from './campos'

/**
 * CampanaDirigidaService (docs/GEOLOCALIZACION.md §14 Fase 5 y §25-28).
 *
 * Campaña a una audiencia dirigida (segmento guardado o radio alrededor de una
 * sucursal). Es un modelo NUEVO a propósito (§3.6): no reescribe
 * MarketingCampaign (el banner "vivo en el home") ni CampanaGlobal.
 *
 * Flujo: crear (BORRADOR) → programar (PROGRAMADA, snapshot de audiencia) →
 * activar (ACTIVA + fan-out por cola). El guardrail de audiencia mínima
 * bloquea programar/activar cuando la estimación queda bajo el umbral (§32).
 */

export const CANALES_SOPORTADOS: CampanaCanal[] = ['IN_APP', 'EMAIL']

export interface CampanaInput {
  nombre: string
  mensaje: string
  canales: CampanaCanal[]
  programadaEn?: Date | null
  maxPorDia?: number | null
  maxPorSemana?: number | null
  prioridad?: number
  segmentoId?: string | null
  sucursalId?: string | null
  radioKm?: number | null
}

const LIMITE_NOMBRE = 120
const LIMITE_MENSAJE = 600

function validarInput(input: CampanaInput): Required<
  Pick<CampanaInput, 'nombre' | 'mensaje' | 'maxPorDia' | 'maxPorSemana' | 'prioridad'>
> {
  const nombre = input.nombre.trim().slice(0, LIMITE_NOMBRE)
  if (!nombre) throw new Error('El nombre de la campaña es obligatorio.')
  const mensaje = input.mensaje.trim().slice(0, LIMITE_MENSAJE)
  if (!mensaje) throw new Error('El mensaje de la campaña es obligatorio.')

  if (!input.canales || input.canales.length === 0) {
    throw new Error('Elige al menos un canal (in-app o email).')
  }
  for (const canal of input.canales) {
    if (!CANALES_SOPORTADOS.includes(canal)) {
      throw new Error(`Canal no soportado en esta versión: ${canal}.`)
    }
  }

  const tieneSegmento = Boolean(input.segmentoId)
  const tieneRadio = Boolean(input.sucursalId && input.radioKm)
  if (tieneSegmento && tieneRadio) {
    throw new Error('Elige un segmento O un radio alrededor de una sucursal, no ambos.')
  }
  if (!tieneSegmento && !tieneRadio) {
    throw new Error('La campaña necesita un segmento o un radio de sucursal.')
  }
  if (tieneRadio) {
    const km = Number(input.radioKm)
    if (!Number.isInteger(km) || km < RADIO_MIN_KM || km > RADIO_MAX_KM) {
      throw new Error(`El radio debe estar entre ${RADIO_MIN_KM} y ${RADIO_MAX_KM} km.`)
    }
  }

  const maxPorDia = input.maxPorDia ?? 1
  const maxPorSemana = input.maxPorSemana ?? 2
  if (maxPorDia < 1 || maxPorSemana < 1 || maxPorSemana < maxPorDia) {
    throw new Error('Frecuencia inválida: al menos 1 por día, 1 por semana y semana ≥ día.')
  }
  const prioridad = Math.min(10, Math.max(0, input.prioridad ?? 0))

  return { nombre, mensaje, maxPorDia, maxPorSemana, prioridad }
}

/** Construye el AST de la audiencia de la campaña (segmento o radio). */
async function arbolDeCampana(
  companyId: string,
  input: CampanaInput
): Promise<Nodo> {
  if (input.segmentoId) {
    const nodo = await SegmentoServicio.arbol(companyId, input.segmentoId)
    if (!nodo) throw new Error('El segmento elegido no existe o no pertenece a esta empresa.')
    return nodo
  }
  if (input.sucursalId && input.radioKm) {
    const raiz: SegmentoRaiz = {
      operador: 'AND',
      condiciones: [
        {
          campo: 'cliente.distanciaSucursalKm',
          operador: 'lte',
          valor: { sucursalId: input.sucursalId, km: Number(input.radioKm) },
        },
      ],
      grupos: [],
    }
    return normalizarRaiz(raiz)
  }
  throw new Error('La campaña necesita un segmento o un radio de sucursal.')
}

async function crearSnapshot(
  tx: Prisma.TransactionClient,
  campanaId: string,
  est: Estimacion
): Promise<void> {
  await tx.campanaAudienciaSnapshot.create({
    data: {
      campanaId,
      totalElegibles: est.totalElegibles,
      totalExcluidos: est.sinConsentimiento,
      sinConsentimiento: est.sinConsentimiento,
      porCiudad: est.porCiudad as Prisma.InputJsonValue,
      porSector: est.porSector as Prisma.InputJsonValue,
      advertencias: est.advertencias as Prisma.InputJsonValue,
    },
  })
}

export const CampanaDirigidaService = {
  async crear(
    companyId: string,
    createdById: string,
    input: CampanaInput
  ): Promise<string> {
    const v = validarInput(input)
    await arbolDeCampana(companyId, input)
    return conEmpresa(companyId, async (tx) => {
      const campana = await tx.campanaDirigida.create({
        data: {
          companyId,
          nombre: v.nombre,
          mensaje: v.mensaje,
          canales: input.canales,
          programadaEn: input.programadaEn ?? null,
          maxPorDia: v.maxPorDia,
          maxPorSemana: v.maxPorSemana,
          prioridad: v.prioridad,
          segmentId: input.segmentoId ?? null,
          sucursalId: input.sucursalId ?? null,
          radioKm: input.sucursalId ? Number(input.radioKm) : null,
          estado: 'BORRADOR',
        },
      })
      void createdById
      return campana.id
    })
  },

  async actualizar(
    companyId: string,
    campanaId: string,
    input: CampanaInput
  ): Promise<void> {
    const v = validarInput(input)
    await arbolDeCampana(companyId, input)
    await conEmpresa(companyId, async (tx) => {
      const existente = await tx.campanaDirigida.findFirst({
        where: { id: campanaId, companyId },
        select: { estado: true },
      })
      if (!existente) throw new Error('La campaña no existe o no pertenece a esta empresa.')
      if (existente.estado !== 'BORRADOR') {
        throw new Error('Solo se edita una campaña en borrador.')
      }
      await tx.campanaDirigida.update({
        where: { id: campanaId },
        data: {
          nombre: v.nombre,
          mensaje: v.mensaje,
          canales: input.canales,
          programadaEn: input.programadaEn ?? null,
          maxPorDia: v.maxPorDia,
          maxPorSemana: v.maxPorSemana,
          prioridad: v.prioridad,
          segmentId: input.segmentoId ?? null,
          sucursalId: input.sucursalId ?? null,
          radioKm: input.sucursalId ? Number(input.radioKm) : null,
        },
      })
    })
  },

  /** Estimación en vivo (vista previa y snapshot). */
  async estimar(companyId: string, campanaId: string): Promise<Estimacion> {
    const campana = await conEmpresa(companyId, async (tx) => {
      return tx.campanaDirigida.findFirst({ where: { id: campanaId, companyId } })
    })
    if (!campana) throw new Error('La campaña no existe.')
    const nodo = await arbolDeCampana(companyId, {
      segmentoId: campana.segmentId,
      sucursalId: campana.sucursalId,
      radioKm: campana.radioKm,
      nombre: '',
      mensaje: '',
      canales: [],
    })
    return estimarNodo(companyId, nodo)
  },

  /**
   * Programa la campaña: recalcula la audiencia, la congela en un snapshot y
   * bloquea si queda bajo el umbral mínimo (§32).
   */
  async programar(
    companyId: string,
    campanaId: string,
    programadaEn?: Date | null
  ): Promise<Estimacion> {
    return cambiarEstado(companyId, campanaId, 'PROGRAMADA', programadaEn ?? null)
  },

  /** Activa la campaña: guardrail + snapshot + fan-out por cola. */
  async activar(companyId: string, campanaId: string): Promise<Estimacion> {
    return cambiarEstado(companyId, campanaId, 'ACTIVA', null)
  },

  async pausar(companyId: string, campanaId: string): Promise<void> {
    await conEmpresa(companyId, (tx) =>
      tx.campanaDirigida.updateMany({
        where: { id: campanaId, companyId },
        data: { estado: 'PAUSADA' },
      })
    )
  },

  async finalizar(companyId: string, campanaId: string): Promise<void> {
    await conEmpresa(companyId, (tx) =>
      tx.campanaDirigida.updateMany({
        where: { id: campanaId, companyId },
        data: { estado: 'FINALIZADA' },
      })
    )
  },

  async listar(companyId: string): Promise<
    {
      id: string
      nombre: string
      estado: CampanaDirigidaEstado
      canales: CampanaCanal[]
      programadaEn: Date | null
      prioridad: number
      updatedAt: Date
      audiencia: number | null
      entregas: number
    }[]
  > {
    return conEmpresa(companyId, async (tx) => {
      const campanas = await tx.campanaDirigida.findMany({
        where: { companyId },
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: { select: { entregas: true } },
          snapshots: { orderBy: { calculadaAt: 'desc' }, take: 1, select: { totalElegibles: true } },
        },
      })
      return campanas.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        estado: c.estado,
        canales: c.canales,
        programadaEn: c.programadaEn,
        prioridad: c.prioridad,
        updatedAt: c.updatedAt,
        audiencia: c.snapshots[0]?.totalElegibles ?? null,
        entregas: c._count.entregas,
      }))
    })
  },

  async obtener(
    companyId: string,
    campanaId: string
  ): Promise<
    | (Prisma.CampanaDirigidaGetPayload<{
        include: {
          segment: { select: { id: true; name: true } }
          sucursal: { select: { id: true; nombre: true } }
        }
      }> & {
        snapshots: { totalElegibles: number; sinConsentimiento: number; calculadaAt: Date; advertencias: Prisma.JsonValue }[]
        entregasPorEstado: { estado: string; n: number }[]
      })
    | null
  > {
    return conEmpresa(companyId, async (tx) => {
      const campana = await tx.campanaDirigida.findFirst({
        where: { id: campanaId, companyId },
        include: {
          segment: { select: { id: true, name: true } },
          sucursal: { select: { id: true, nombre: true } },
          snapshots: { orderBy: { calculadaAt: 'desc' }, take: 1 },
        },
      })
      if (!campana) return null
      const porEstado = await tx.campanaEntrega.groupBy({
        by: ['estado'],
        where: { campanaId },
        _count: { _all: true },
      })
      return {
        ...campana,
        snapshots: campana.snapshots.map((s) => ({
          totalElegibles: s.totalElegibles,
          sinConsentimiento: s.sinConsentimiento,
          calculadaAt: s.calculadaAt,
          advertencias: s.advertencias,
        })),
        entregasPorEstado: porEstado.map((g) => ({ estado: g.estado, n: g._count._all })),
      }
    })
  },
}

/** Activa campañas programadas cuya fecha ya llegó, desde el cron global. */
export async function activarCampanasProgramadas(): Promise<{
  activadas: number
  bloqueadas: number
}> {
  const ahora = new Date()
  const pendientes = await sinEmpresa('cron: campañas dirigidas programadas', (tx) =>
    tx.campanaDirigida.findMany({
      where: { estado: 'PROGRAMADA', programadaEn: { lte: ahora } },
      select: { id: true, companyId: true },
      orderBy: { id: 'asc' },
    })
  )

  let activadas = 0
  let bloqueadas = 0
  for (const campana of pendientes) {
    try {
      await CampanaDirigidaService.activar(campana.companyId, campana.id)
      activadas++
    } catch (error) {
      // Una audiencia bajo el umbral queda PROGRAMADA para revisión manual.
      bloqueadas++
      console.error('[cron-campanas-dirigidas]', campana.id, error)
    }
  }
  return { activadas, bloqueadas }
}

async function cambiarEstado(
  companyId: string,
  campanaId: string,
  estado: 'PROGRAMADA' | 'ACTIVA',
  programadaEn: Date | null | undefined
): Promise<Estimacion> {
  const campana = await conEmpresa(companyId, async (tx) => {
    return tx.campanaDirigida.findFirst({ where: { id: campanaId, companyId } })
  })
  if (!campana) throw new Error('La campaña no existe o no pertenece a esta empresa.')

  const nodo = await arbolDeCampana(companyId, {
    segmentoId: campana.segmentId,
    sucursalId: campana.sucursalId,
    radioKm: campana.radioKm,
    nombre: '',
    mensaje: '',
    canales: [],
  })
  const est = await estimarNodo(companyId, nodo)

  if (est.bajoUmbral) {
    throw new Error(
      `La audiencia (${est.totalElegibles}) está por debajo del mínimo de ${UMBRAL_MINIMO_AUDIENCIA}. Ajusta el segmento o pide excepción al superadmin.`
    )
  }

  await conEmpresa(companyId, async (tx) => {
    await crearSnapshot(tx, campanaId, est)
    await tx.campanaDirigida.update({
      where: { id: campanaId },
      data: {
        estado,
        ...(programadaEn !== undefined ? { programadaEn } : {}),
      },
    })
  })

  if (estado === 'ACTIVA') {
    const { encolar } = await import('@/modules/jobs/cola')
    await encolar({ tipo: 'campana-dirigida', companyId, campanaId, desde: 0 })
  }

  return est
}
