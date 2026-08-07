import 'server-only'
import { sinEmpresa } from '@/lib/tenant'
import type { CampanaCanal, NotifTipo, Prisma } from '@prisma/client'
import { normalizarRaiz, type Nodo, type SegmentoRaiz } from './arbol'
import { leerArbolTx } from './segmentos'
import { dondeAudiencia } from './audiencia-sql'

/**
 * FAN-OUT DE CAMPAÑA DIRIGIDA (docs/GEOLOCALIZACION.md §28 y §31).
 *
 * Trabajo de la cola: procesa UN lote de clientes elegibles (los mismos que
 * cuenta el AudienceEstimator, incluido el consentimiento), aplica los
 * controles de frecuencia (maxPorDia/maxPorSemana de la campaña), registra la
 * entrega y despacha los canales. Si el lote quedó lleno, se encadena el
 * siguiente. El orden por `id` es estable: sin él, dos lotes encadenados se
 * solapan o se saltan gente (el mismo razonamiento que `notificarLote`).
 */

export const TAMANO_LOTE_CAMPANA = 1000

export interface ResultadoLote {
  procesados: number
  excludos: number
  continua: boolean
}

export async function procesarLoteCampana(
  campanaId: string,
  desde: number
): Promise<ResultadoLote> {
  return sinEmpresa('campaña dirigida: fan-out por lotes (cross-tenant)', async (tx) => {
    const campana = await tx.campanaDirigida.findUnique({ where: { id: campanaId } })
    if (!campana || campana.estado !== 'ACTIVA') {
      return { procesados: 0, excludos: 0, continua: false }
    }

    const nodo = await nodoDeCampana(tx, campanaId, campana)
    const donde = await dondeAudiencia(tx, campana.companyId, nodo)

    const lote = await tx.$queryRaw<
      { id: string; supabaseId: string; email: string | null }[]
    >`SELECT c.id, c.supabaseId, c.email
      FROM clientes c
      WHERE ${donde}
      ORDER BY c.id ASC
      LIMIT ${TAMANO_LOTE_CAMPANA} OFFSET ${desde}`

    if (lote.length === 0) return { procesados: 0, excludos: 0, continua: false }

    // ids de usuario para el canal in-app (un cliente puede ser varias empresas).
    const users = await tx.user.findMany({
      where: { supabaseId: { in: lote.map((c) => c.supabaseId) } },
      select: { id: true, supabaseId: true },
    })
    const userIdPorSupabase = new Map(users.map((u) => [u.supabaseId, u.id]))

    // Controles de frecuencia de ESTA campaña (ventanas día y semana).
    const limites = await limitesPorCliente(tx, campanaId, campana.maxPorDia, campana.maxPorSemana)
    const hoy = new Date()

    let procesados = 0
    let excludos = 0
    const notifRows: { userId: string; tipo: NotifTipo; titulo: string; mensaje: string }[] = []
    const entregas: Prisma.CampanaEntregaCreateManyInput[] = []

    for (const cliente of lote) {
      const limite = limites.get(cliente.id)
      if (limite && (limite.dia >= (campana.maxPorDia ?? 1) || limite.semana >= (campana.maxPorSemana ?? 2))) {
        excludos++
        continue
      }
      for (const canal of campana.canales as CampanaCanal[]) {
        entregas.push({ campanaId, clienteId: cliente.id, canal, estado: 'ENVIADA', enviadaAt: hoy })
        if (canal === 'IN_APP') {
          const userId = userIdPorSupabase.get(cliente.supabaseId)
          if (userId) {
            notifRows.push({
              userId,
              tipo: 'PROMOCION_NUEVA' as NotifTipo,
              titulo: campana.nombre,
              mensaje: campana.mensaje.slice(0, 280),
            })
          }
        }
      }
      procesados++
    }

    if (notifRows.length > 0) {
      await tx.notificacion.createMany({ data: notifRows, skipDuplicates: true })
    }
    if (entregas.length > 0) {
      await tx.campanaEntrega.createMany({ data: entregas })
    }

    // Canal email: se encola cada correo (el worker de email solo entrega).
    if ((campana.canales as CampanaCanal[]).includes('EMAIL')) {
      const { encolar } = await import('@/modules/jobs/cola')
      for (const cliente of lote) {
        const limite = limites.get(cliente.id)
        if (limite && (limite.dia >= (campana.maxPorDia ?? 1) || limite.semana >= (campana.maxPorSemana ?? 2))) {
          continue
        }
        if (!cliente.email) continue
        await encolar({
          tipo: 'email',
          to: cliente.email,
          subject: campana.nombre,
          text: campana.mensaje,
          companyId: campana.companyId,
        })
      }
    }

    const continua = lote.length === TAMANO_LOTE_CAMPANA
    if (continua) {
      const { encolar } = await import('@/modules/jobs/cola')
      await encolar({ tipo: 'campana-dirigida', companyId: campana.companyId, campanaId, desde: desde + TAMANO_LOTE_CAMPANA })
    }

    return { procesados, excludos, continua }
  })
}

/** AST de la audiencia de la campaña (segmento guardado o radio de sucursal). */
async function nodoDeCampana(
  tx: Prisma.TransactionClient,
  campanaId: string,
  campana: {
    segmentId: string | null
    sucursalId: string | null
    radioKm: number | null
  }
): Promise<Nodo> {
  void campanaId
  if (campana.segmentId) {
    return leerArbolTx(tx, campana.segmentId)
  }
  if (campana.sucursalId && campana.radioKm) {
    const raiz: SegmentoRaiz = {
      operador: 'AND',
      condiciones: [
        {
          campo: 'cliente.distanciaSucursalKm',
          operador: 'lte',
          valor: { sucursalId: campana.sucursalId, km: campana.radioKm },
        },
      ],
      grupos: [],
    }
    return normalizarRaiz(raiz)
  }
  throw new Error('La campaña no tiene audiencia definida.')
}

/** Conteos por cliente de esta campaña en las ventanas de día y semana. */
async function limitesPorCliente(
  tx: Prisma.TransactionClient,
  campanaId: string,
  maxPorDia: number | null,
  maxPorSemana: number | null
): Promise<Map<string, { dia: number; semana: number }>> {
  if (!maxPorDia && !maxPorSemana) return new Map()
  const ahora = Date.now()
  const inicioDia = new Date(ahora - 24 * 60 * 60 * 1000)
  const inicioSemana = new Date(ahora - 7 * 24 * 60 * 60 * 1000)

  const [porDia, porSemana] = await Promise.all([
    tx.$queryRaw<{ clienteId: string; n: number }[]>`
      SELECT clienteId, COUNT(*)::int AS n FROM campana_entregas
      WHERE campanaId = ${campanaId} AND createdAt >= ${inicioDia}
      GROUP BY clienteId`,
    tx.$queryRaw<{ clienteId: string; n: number }[]>`
      SELECT clienteId, COUNT(*)::int AS n FROM campana_entregas
      WHERE campanaId = ${campanaId} AND createdAt >= ${inicioSemana}
      GROUP BY clienteId`,
  ])

  const map = new Map<string, { dia: number; semana: number }>()
  for (const r of porDia) {
    const e = map.get(r.clienteId) ?? { dia: 0, semana: 0 }
    e.dia = r.n
    map.set(r.clienteId, e)
  }
  for (const r of porSemana) {
    const e = map.get(r.clienteId) ?? { dia: 0, semana: 0 }
    e.semana = r.n
    map.set(r.clienteId, e)
  }
  return map
}
