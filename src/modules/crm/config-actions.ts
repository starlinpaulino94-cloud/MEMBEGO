'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { categoriaDeType } from '@/modules/capacidades/catalogo'
import type { Prisma } from '@prisma/client'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ConfigActionState {
  error?: string
  success?: boolean
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_STAGES = [
  { id: 's1', nombre: 'Nuevo', color: 'bg-info', orden: 1 },
  { id: 's2', nombre: 'Contactado', color: 'bg-pending', orden: 2 },
  { id: 's3', nombre: 'Cotización', color: 'bg-warning', orden: 3 },
  { id: 's4', nombre: 'Negociación', color: 'bg-primary', orden: 4 },
  { id: 's5', nombre: 'Cerrado', color: 'bg-success', orden: 5 },
]

const DEFAULT_CAMPOS = [
  { key: 'fuente', label: 'Fuente del lead', tipo: 'select', opciones: ['WhatsApp', 'Instagram', 'Teléfono', 'Referido', 'Facebook', 'Walk-in'], obligatorio: false },
  { key: 'presupuesto', label: 'Presupuesto estimado', tipo: 'number', opciones: [], obligatorio: false },
  { key: 'tipoVehiculo', label: 'Tipo de vehículo', tipo: 'select', opciones: ['Sedán', 'SUV', 'Pickup', 'Van'], obligatorio: false },
  { key: 'frecuencia', label: 'Frecuencia deseada', tipo: 'select', opciones: ['Semanal', 'Quincenal', 'Mensual', 'Ocasional'], obligatorio: false },
]

const DEFAULT_AUTOMATIZACIONES = {
  bienvenida: true,
  recordatorio: true,
  recordatorioDias: 3,
  cierre: false,
}

async function getCategoria(companyId: string, tx: Prisma.TransactionClient): Promise<string> {
  const company = await tx.company.findUnique({ where: { id: companyId }, select: { type: true } })
  return categoriaDeType(company?.type)
}

// ── Actions ─────────────────────────────────────────────────────────────────

export async function updateStages(
  _prev: ConfigActionState,
  formData: FormData
): Promise<ConfigActionState> {
  try {
    const user = await requireSection('leads')
    if (!user) return { error: 'No autorizado.' }

    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Empresa no especificada.' }

    const stagesRaw = String(formData.get('stages') ?? '[]')
    const stages = JSON.parse(stagesRaw) as Prisma.InputJsonValue

    await conEmpresa(companyId, async (tx) => {
      const categoria = await getCategoria(companyId, tx)
      return tx.pipelineConfig.upsert({
        where: { companyId },
        update: { stages },
        create: { companyId, categoria, stages, camposCustom: [], automatizaciones: {} },
      })
    })

    revalidatePath('/admin/crm/configuracion')
    return { success: true }
  } catch (e) {
    anotarFallo('crm:updateStages')(e)
    return { error: 'Error al guardar las etapas.' }
  }
}

export async function updateCampos(
  _prev: ConfigActionState,
  formData: FormData
): Promise<ConfigActionState> {
  try {
    const user = await requireSection('leads')
    if (!user) return { error: 'No autorizado.' }

    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Empresa no especificada.' }

    const camposRaw = String(formData.get('campos') ?? '[]')
    const campos = JSON.parse(camposRaw) as Prisma.InputJsonValue

    await conEmpresa(companyId, async (tx) => {
      const categoria = await getCategoria(companyId, tx)
      return tx.pipelineConfig.upsert({
        where: { companyId },
        update: { camposCustom: campos },
        create: { companyId, categoria, stages: [], camposCustom: campos, automatizaciones: {} },
      })
    })

    revalidatePath('/admin/crm/configuracion')
    return { success: true }
  } catch (e) {
    anotarFallo('crm:updateCampos')(e)
    return { error: 'Error al guardar los campos.' }
  }
}

export async function updateAutomatizaciones(
  _prev: ConfigActionState,
  formData: FormData
): Promise<ConfigActionState> {
  try {
    const user = await requireSection('leads')
    if (!user) return { error: 'No autorizado.' }

    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Empresa no especificada.' }

    const automatizaciones = {
      bienvenida: formData.get('bienvenida') === 'true',
      recordatorio: formData.get('recordatorio') === 'true',
      recordatorioDias: Math.max(1, Math.min(30, Number(formData.get('recordatorioDias') ?? 3))),
      cierre: formData.get('cierre') === 'true',
    }

    await conEmpresa(companyId, async (tx) => {
      const categoria = await getCategoria(companyId, tx)
      return tx.pipelineConfig.upsert({
        where: { companyId },
        update: { automatizaciones },
        create: { companyId, categoria, stages: [], camposCustom: [], automatizaciones },
      })
    })

    revalidatePath('/admin/crm/configuracion')
    return { success: true }
  } catch (e) {
    anotarFallo('crm:updateAutomatizaciones')(e)
    return { error: 'Error al guardar las automatizaciones.' }
  }
}

export async function resetToDefaults(): Promise<ConfigActionState> {
  try {
    const user = await requireSection('leads')
    if (!user) return { error: 'No autorizado.' }

    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Empresa no especificada.' }

    await conEmpresa(companyId, async (tx) => {
      const categoria = await getCategoria(companyId, tx)
      return tx.pipelineConfig.upsert({
        where: { companyId },
        update: {
          stages: DEFAULT_STAGES,
          camposCustom: DEFAULT_CAMPOS,
          automatizaciones: DEFAULT_AUTOMATIZACIONES,
        },
        create: {
          companyId,
          categoria,
          stages: DEFAULT_STAGES,
          camposCustom: DEFAULT_CAMPOS,
          automatizaciones: DEFAULT_AUTOMATIZACIONES,
        },
      })
    })

    revalidatePath('/admin/crm/configuracion')
    return { success: true }
  } catch (e) {
    anotarFallo('crm:resetToDefaults')(e)
    return { error: 'Error al resetear la configuración.' }
  }
}
