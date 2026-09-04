import 'server-only'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { anotarConector } from '@/modules/connect/bitacora'
import { reclamarActivo } from '@/modules/connect/meta/activos'
import { claseDeRespuestaGraph, llamarGraph } from '@/modules/connect/meta/graph'
import { anotarSalud } from '@/modules/connect/registro'
import { leerPlantillasDeMeta, type PlantillaLeida } from '@/modules/mensajeria/nucleo'

/**
 * PLANTILLAS DE WHATSAPP (Meta · Fase 2).
 *
 * Se leen de `GET /{WABA_ID}/message_templates` (permiso
 * `whatsapp_business_management`) y se guardan tal cual las devuelve Meta.
 * Solo las APPROVED se ofrecen para enviar. Se resincronizan a mano, y solas
 * cuando llega el webhook `message_template_status_update`.
 *
 * Una conexión hecha con token manual no conoce su WABA: no puede listar
 * plantillas, y la pantalla lo dice en vez de enseñar una lista vacía.
 */

const CAMPOS = 'id,name,language,status,category,components'
const MAX_PAGINAS = 10

export type ResultadoSincronizacion =
  | { ok: true; total: number; aprobadas: number }
  | { ok: false; motivo: 'sin_conexion' | 'sin_waba' | 'proveedor' | 'activo'; detalle?: string }

export async function sincronizarPlantillas(companyId: string): Promise<ResultadoSincronizacion> {
  const { credencialWhatsappViva } = await import('@/modules/connect/whatsapp')
  const cred = await credencialWhatsappViva(companyId)
  if (!cred) return { ok: false, motivo: 'sin_conexion' }
  if (!cred.wabaId) return { ok: false, motivo: 'sin_waba' }

  // El WABA como activo de la empresa (una conexión anterior a ActivoMeta no
  // lo tendría reclamado todavía).
  const waba = await reclamarActivo({ companyId, conexionId: cred.conexionId, tipo: 'WABA', idExterno: cred.wabaId })
  if (!waba.ok) return { ok: false, motivo: 'activo', detalle: waba.motivo }

  const leidas: PlantillaLeida[] = []
  let despues: string | null = null
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const r = await llamarGraph<unknown>({
      ruta: `/${encodeURIComponent(cred.wabaId)}/message_templates`,
      query: { fields: CAMPOS, ...(despues ? { after: despues } : {}) },
      token: cred.token,
    })
    if (!r.ok) {
      const detalle = r.respuesta.status === 0 ? 'no se pudo contactar con Meta' : `Meta respondió ${r.respuesta.status}`
      await anotarSalud({
        companyId,
        conexionId: cred.conexionId,
        resultado: { ok: false, error: detalle, clase: claseDeRespuestaGraph(r.respuesta) },
      })
      return { ok: false, motivo: 'proveedor', detalle }
    }
    const lote = leerPlantillasDeMeta(r.datos)
    leidas.push(...lote.plantillas)
    if (!lote.siguiente) break
    despues = lote.siguiente
  }

  const ahora = new Date()
  await conEmpresa(companyId, async (tx) => {
    for (const p of leidas) {
      await tx.plantillaWhatsapp.upsert({
        where: { activoId_idExterno: { activoId: waba.id, idExterno: p.idExterno } },
        create: {
          companyId,
          activoId: waba.id,
          idExterno: p.idExterno,
          nombre: p.nombre,
          idioma: p.idioma,
          categoria: p.categoria,
          estado: p.estado,
          componentes: p.componentes as Prisma.InputJsonArray,
          variables: p.variables,
          sincronizadoAt: ahora,
        },
        update: {
          nombre: p.nombre,
          idioma: p.idioma,
          categoria: p.categoria,
          estado: p.estado,
          componentes: p.componentes as Prisma.InputJsonArray,
          variables: p.variables,
          sincronizadoAt: ahora,
        },
      })
    }
    // Lo que Meta ya no devuelve dejó de existir allí: se marca, no se borra.
    await tx.plantillaWhatsapp.updateMany({
      where: { companyId, activoId: waba.id, sincronizadoAt: { lt: ahora } },
      data: { estado: 'DELETED' },
    })
  })

  await anotarSalud({ companyId, conexionId: cred.conexionId, resultado: { ok: true } })
  await anotarConector({
    companyId,
    origen: 'CONEXION',
    origenId: cred.conexionId,
    evento: 'whatsapp.plantillas_sincronizadas',
    detalle: { total: leidas.length },
  })
  const aprobadas = leidas.filter((p) => p.estado === 'APPROVED').length
  return { ok: true, total: leidas.length, aprobadas }
}

export interface PlantillaVista {
  id: string
  nombre: string
  idioma: string
  categoria: string
  estado: string
  variables: number
  /** El texto del BODY, para enseñarlo al elegir. */
  cuerpo: string | null
}

export async function plantillasDeEmpresa(
  companyId: string,
  opciones: { soloAprobadas?: boolean } = {}
): Promise<PlantillaVista[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.plantillaWhatsapp.findMany({
      where: { companyId, ...(opciones.soloAprobadas === false ? {} : { estado: 'APPROVED' }) },
      orderBy: [{ nombre: 'asc' }, { idioma: 'asc' }],
    })
  )
  return filas.map((f) => {
    const comps = Array.isArray(f.componentes) ? (f.componentes as unknown[]) : []
    const body = comps.find(
      (c) => c && typeof c === 'object' && (c as { type?: string }).type === 'BODY'
    ) as { text?: string } | undefined
    return {
      id: f.id,
      nombre: f.nombre,
      idioma: f.idioma,
      categoria: f.categoria,
      estado: f.estado,
      variables: f.variables,
      cuerpo: typeof body?.text === 'string' ? body.text : null,
    }
  })
}
