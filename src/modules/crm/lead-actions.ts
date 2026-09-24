'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getRequestMeta } from '@/lib/server-utils'
import { Prisma } from '@prisma/client'
import type { Lead, LeadUpdateInput, LeadEtapa, LeadFuente, LeadCanal, LeadEstado, LeadPrioridad } from './types'

// ── State ──────────────────────────────────────────────────────────────────

export interface LeadActionState {
  error?: string
  success?: boolean
  leadId?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_ETAPAS: readonly LeadEtapa[] = [
  'NUEVO', 'CONTACTADO', 'INTERESADO', 'PROPUESTA', 'NEGOCIACION', 'GANADO', 'PERDIDO',
] as const

/**
 * Verifica que el lead pertenezca a la empresa del usuario.
 *
 * Trae además el ESTADO ANTERIOR (nombre, etapa, estado, a quién estaba
 * asignado) porque sin él la bitácora solo puede decir «alguien lo movió», y
 * la pregunta que se hace de verdad es «¿de dónde a dónde?». Son cuatro
 * columnas con `select` expreso, no la fila entera.
 */
async function leadDeMiEmpresa(
  leadId: string,
  companyId: string
) {
  return sinEmpresa('lead por id sin conocer la empresa', (tx) =>
    tx.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        companyId: true,
        nombre: true,
        etapa: true,
        estado: true,
        asignadoA: true,
      },
    })
  ).then((lead) => {
    if (!lead) return null
    return lead.companyId === companyId ? lead : null
  })
}

/**
 * Asienta en la bitácora lo que se acaba de hacer con un prospecto.
 *
 * FAIL-OPEN, Y ES UNA DECISIÓN. Va FUERA de la transacción del prospecto y se
 * traga su propio error a propósito. Los valores nuevos de `AuditAccion` viven
 * en la migración `20260930_crm_auditoria`, y en este proyecto las migraciones
 * se aplican a mano: si este código llega a producción antes que ella,
 * PostgreSQL rechaza el valor desconocido. Dentro de la misma transacción eso
 * arrastraría el cambio del prospecto y el CRM entero quedaría de solo lectura
 * sin más explicación que «Ocurrió un error». El precio es que, mientras falte
 * la migración, no hay rastro. Mismo razonamiento que `auditarPlan` en
 * `modules/admin/planActions.ts`.
 */
async function auditarProspecto(
  companyId: string,
  userId: string | null,
  accion:
    | 'PROSPECTO_CREADO'
    | 'PROSPECTO_ACTUALIZADO'
    | 'PROSPECTO_DESCARTADO'
    | 'PROSPECTO_ETAPA_CAMBIADA'
    | 'PROSPECTO_ASIGNADO',
  leadId: string,
  // `Prisma.InputJsonObject` y no `Record<string, unknown>`: la columna es JSON
  // y el tipo laxo dejaría colar un `Date` o un `undefined` que revientan al
  // serializar, justo en el camino que no puede fallar.
  payload: Prisma.InputJsonObject
) {
  try {
    // La IP y el navegador son el motivo por el que esto existe: si mañana
    // aparece un prospecto borrado sin explicación, el nombre solo dice quién
    // tenía la sesión.
    const meta = await getRequestMeta()
    await conEmpresa(companyId, (tx) =>
      tx.auditLog.create({
        data: { companyId, userId, accion, entidadTipo: 'Lead', entidadId: leadId, payload, ...meta },
      })
    )
  } catch (e) {
    console.error('[crm] no se pudo auditar', accion, e)
  }
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Crea un lead nuevo en la empresa del usuario.
 */
export async function createLead(
  _prev: LeadActionState,
  formData: FormData
): Promise<LeadActionState> {
  const user = await requireSection('leads', 'lead_crear')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  if (!nombre) return { error: 'El nombre es requerido.' }
  if (nombre.length > 200) return { error: 'El nombre es demasiado largo (máx 200).' }

  const email = String(formData.get('email') ?? '').trim() || null
  const telefono = String(formData.get('telefono') ?? '').trim() || null
  const fuente = String(formData.get('fuente') ?? 'ORGANICO')
  const canal = String(formData.get('canal') ?? 'WEB')
  const prioridad = String(formData.get('prioridad') ?? 'MEDIA')
  const notas = String(formData.get('notas') ?? '').trim() || null
  const tagsRaw = String(formData.get('tags') ?? '').trim()
  const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : []
  const fechaSeguimientoRaw = String(formData.get('fechaSeguimiento') ?? '').trim()
  const fechaSeguimiento = fechaSeguimientoRaw ? new Date(fechaSeguimientoRaw) : null

  try {
    const lead = await conEmpresa(companyId, (tx) =>
      tx.lead.create({
        data: {
          companyId,
          nombre,
          email,
          telefono,
          fuente,
          canal,
          prioridad,
          notas,
          tags,
          fechaSeguimiento,
        },
      })
    )

    await auditarProspecto(companyId, user.metadata.dbUserId ?? null, 'PROSPECTO_CREADO', lead.id, {
      nombre,
      fuente,
      canal,
      prioridad,
      // El teléfono y el correo NO se copian aquí: ya están en la fila del
      // prospecto, y la bitácora la lee más gente que el CRM.
    })

    revalidatePath('/admin/crm')
    return { success: true, leadId: lead.id }
  } catch (e) {
    console.error('[crm] createLead', e)
    return { error: 'Ocurrió un error al crear el lead.' }
  }
}

/**
 * Actualiza un lead existente.
 */
export async function updateLead(
  _prev: LeadActionState,
  formData: FormData
): Promise<LeadActionState> {
  const user = await requireSection('leads', 'lead_editar')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const leadId = String(formData.get('leadId') ?? '').trim()
  if (!leadId) return { error: 'Lead no especificado.' }

  const existing = await leadDeMiEmpresa(leadId, companyId)
  if (!existing) return { error: 'Lead no encontrado.' }

  const data: LeadUpdateInput = {}
  const nombre = String(formData.get('nombre') ?? '').trim()
  if (nombre) data.nombre = nombre
  if (formData.has('email')) data.email = String(formData.get('email') ?? '').trim() || null
  if (formData.has('telefono')) data.telefono = String(formData.get('telefono') ?? '').trim() || null
  if (formData.has('fuente')) data.fuente = String(formData.get('fuente')) as LeadFuente
  if (formData.has('canal')) data.canal = String(formData.get('canal')) as LeadCanal
  if (formData.has('estado')) data.estado = String(formData.get('estado')) as LeadEstado
  if (formData.has('etapa')) data.etapa = String(formData.get('etapa')) as LeadEtapa
  if (formData.has('prioridad')) data.prioridad = String(formData.get('prioridad')) as LeadPrioridad
  if (formData.has('asignadoA')) data.asignadoA = String(formData.get('asignadoA') ?? '').trim() || null
  if (formData.has('notas')) data.notas = String(formData.get('notas') ?? '').trim() || null
  if (formData.has('score')) data.score = Number(formData.get('score')) || null
  if (formData.has('fechaSeguimiento')) {
    const raw = String(formData.get('fechaSeguimiento') ?? '').trim()
    data.fechaSeguimiento = raw ? new Date(raw) : null
  }
  if (formData.has('tags')) {
    const tagsRaw = String(formData.get('tags') ?? '').trim()
    data.tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : []
  }

  if (Object.keys(data).length === 0) return { error: 'Sin cambios para guardar.' }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.lead.update({ where: { id: leadId }, data })
    )

    await auditarProspecto(companyId, user.metadata.dbUserId ?? null, 'PROSPECTO_ACTUALIZADO', leadId, {
      prospecto: existing.nombre,
      // Solo los NOMBRES de los campos tocados. Los valores no: aquí pasan
      // teléfonos, correos y notas privadas, y la bitácora es otra pantalla
      // con otros lectores. Para saber qué dice hoy el prospecto está el
      // prospecto.
      campos: Object.keys(data),
    })

    revalidatePath('/admin/crm')
    revalidatePath(`/admin/crm/${leadId}`)
    return { success: true, leadId }
  } catch (e) {
    console.error('[crm] updateLead', e)
    return { error: 'Ocurrió un error al actualizar el lead.' }
  }
}

/**
 * Elimina un lead (soft delete → cambia estado a DESCARTADO).
 */
export async function deleteLead(
  _prev: LeadActionState,
  formData: FormData
): Promise<LeadActionState> {
  const user = await requireSection('leads', 'lead_eliminar')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const leadId = String(formData.get('leadId') ?? '').trim()
  if (!leadId) return { error: 'Lead no especificado.' }

  const existing = await leadDeMiEmpresa(leadId, companyId)
  if (!existing) return { error: 'Lead no encontrado.' }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.lead.update({
        where: { id: leadId },
        data: { estado: 'DESCARTADO' },
      })
    )

    await auditarProspecto(companyId, user.metadata.dbUserId ?? null, 'PROSPECTO_DESCARTADO', leadId, {
      prospecto: existing.nombre,
      etapaAlDescartar: existing.etapa,
    })

    revalidatePath('/admin/crm')
    return { success: true, leadId }
  } catch (e) {
    console.error('[crm] deleteLead', e)
    return { error: 'Ocurrió un error al eliminar el lead.' }
  }
}

/**
 * Mueve un lead a una etapa del pipeline.
 */
export async function moveToStage(
  _prev: LeadActionState,
  formData: FormData
): Promise<LeadActionState> {
  const user = await requireSection('leads', 'lead_mover_etapa')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const leadId = String(formData.get('leadId') ?? '').trim()
  const etapa = String(formData.get('etapa') ?? '').trim()

  if (!leadId) return { error: 'Lead no especificado.' }
  if (!etapa) return { error: 'Etapa no especificada.' }
  if (!(VALID_ETAPAS as readonly string[]).includes(etapa)) {
    return { error: `Etapa inválida: ${etapa}` }
  }

  const existing = await leadDeMiEmpresa(leadId, companyId)
  if (!existing) return { error: 'Lead no encontrado.' }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.lead.update({
        where: { id: leadId },
        data: { etapa },
      })
    )

    await auditarProspecto(companyId, user.metadata.dbUserId ?? null, 'PROSPECTO_ETAPA_CAMBIADA', leadId, {
      prospecto: existing.nombre,
      de: existing.etapa,
      a: etapa,
    })

    revalidatePath('/admin/crm')
    revalidatePath(`/admin/crm/${leadId}`)
    return { success: true, leadId }
  } catch (e) {
    console.error('[crm] moveToStage', e)
    return { error: 'Ocurrió al mover el lead.' }
  }
}

/**
 * Asigna un lead a un usuario (empleado/admin).
 */
export async function assignLead(
  _prev: LeadActionState,
  formData: FormData
): Promise<LeadActionState> {
  const user = await requireSection('leads', 'lead_asignar')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const leadId = String(formData.get('leadId') ?? '').trim()
  const asignadoA = String(formData.get('asignadoA') ?? '').trim() || null

  if (!leadId) return { error: 'Lead no especificado.' }

  const existing = await leadDeMiEmpresa(leadId, companyId)
  if (!existing) return { error: 'Lead no encontrado.' }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.lead.update({
        where: { id: leadId },
        data: { asignadoA },
      })
    )

    await auditarProspecto(companyId, user.metadata.dbUserId ?? null, 'PROSPECTO_ASIGNADO', leadId, {
      prospecto: existing.nombre,
      de: existing.asignadoA,
      a: asignadoA,
    })

    revalidatePath('/admin/crm')
    revalidatePath(`/admin/crm/${leadId}`)
    return { success: true, leadId }
  } catch (e) {
    console.error('[crm] assignLead', e)
    return { error: 'Ocurrió al asignar el lead.' }
  }
}

export async function fetchLeadDetails(
  leadId: string
): Promise<Lead | null> {
  const user = await requireSection('leads')
  if (!user) return null

  const companyId = user.metadata.companyId
  if (!companyId) return null

  const lead = await sinEmpresa('lead details', (tx) =>
    tx.lead.findUnique({
      where: { id: leadId },
      include: { notasSeguimiento: { orderBy: { createdAt: 'desc' } } },
    })
  )

  if (!lead || lead.companyId !== companyId) return null
  return lead as Lead
}
