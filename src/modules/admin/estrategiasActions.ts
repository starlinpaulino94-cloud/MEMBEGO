'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import {
  AutomationService,
  PrismaAutomationRepository,
  getPlaybook,
  playbookToCreateData,
} from '@/lib/automation'
import type { SessionUser } from '@/types'

/**
 * Plantillas de automatización (Automation Playbooks). Instala/publica/pausa/
 * archiva automatizaciones de la biblioteca (180 playbooks) para la empresa
 * activa. Reutiliza el Automation Engine real (tablas automations/…): instalar
 * crea la automatización en DRAFT; publicarla la deja lista para el bus de
 * eventos. Multi-tenant por companyId; superadmin usa la empresa activa.
 */

export interface EstrategiaState {
  error?: string
  success?: boolean
}

function service(tx: Tx) {
  return new AutomationService(new PrismaAutomationRepository(tx))
}

function revalidateEstrategias() {
  revalidatePath('/admin/automatizaciones/plantillas')
}

/** La automatización existe y pertenece a la empresa del usuario (o superadmin). */
async function automatizacionDeMiEmpresa(id: string, user: SessionUser) {
  const auto = await sinEmpresa('automatización por id sin conocer la empresa', (tx) =>
    tx.automation.findUnique({
      where: { id },
      select: { id: true, companyId: true, status: true, templateKey: true },
    })
  )
  if (!auto) return null
  if (user.metadata.role !== 'SUPERADMIN' && auto.companyId !== user.metadata.companyId) {
    return null
  }
  return auto
}

/** Instala un playbook de la biblioteca como automatización (DRAFT). */
export async function instalarEstrategia(
  _prev: EstrategiaState,
  formData: FormData
): Promise<EstrategiaState> {
  const user = await requireSection('automatizaciones', 'instalar')
  if (!user) return { error: 'No autorizado.' }

  const companyId = await resolveCompanyId(user, formData)
  if (!companyId) return { error: 'Empresa requerida.' }

  const playbookId = String(formData.get('playbookId') ?? '').trim()
  const playbook = getPlaybook(playbookId)
  if (!playbook) return { error: 'Plantilla no encontrada.' }

  try {
    // Evitar duplicados: una instalación activa (no archivada) por playbook.
    const existente = await conEmpresa(companyId, (tx) =>
      tx.automation.findFirst({
        where: {
          companyId,
          templateKey: `playbook.${playbook.id}`,
          status: { not: 'ARCHIVED' },
        },
        select: { id: true },
      })
    )
    if (existente) return { error: 'Esta plantilla ya está instalada.' }

    await conEmpresa(companyId, (tx) =>
      service(tx).createAutomation(playbookToCreateData(playbook, companyId))
    )
    revalidateEstrategias()
    return { success: true }
  } catch (e) {
    console.error('[estrategias] instalar', e)
    return { error: 'No se pudo instalar la plantilla. Intenta de nuevo.' }
  }
}

/** Publica (activa) una automatización instalada. */
export async function publicarEstrategia(
  _prev: EstrategiaState,
  formData: FormData
): Promise<EstrategiaState> {
  const user = await requireSection('automatizaciones', 'publicar')
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  const auto = await automatizacionDeMiEmpresa(id, user)
  if (!auto) return { error: 'Automatización no encontrada.' }

  try {
    await conEmpresa(auto.companyId, (tx) => service(tx).publishAutomation(id))
    revalidateEstrategias()
    return { success: true }
  } catch (e) {
    console.error('[estrategias] publicar', e)
    return { error: 'No se pudo activar. Intenta de nuevo.' }
  }
}

/** Pausa una automatización publicada. */
export async function pausarEstrategia(
  _prev: EstrategiaState,
  formData: FormData
): Promise<EstrategiaState> {
  const user = await requireSection('automatizaciones', 'pausar')
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  const auto = await automatizacionDeMiEmpresa(id, user)
  if (!auto) return { error: 'Automatización no encontrada.' }

  try {
    await conEmpresa(auto.companyId, (tx) => service(tx).pauseAutomation(id))
    revalidateEstrategias()
    return { success: true }
  } catch (e) {
    console.error('[estrategias] pausar', e)
    return { error: 'No se pudo pausar. Intenta de nuevo.' }
  }
}

/** Archiva (desinstala) una automatización; el historial de runs se conserva. */
export async function archivarEstrategia(
  _prev: EstrategiaState,
  formData: FormData
): Promise<EstrategiaState> {
  const user = await requireSection('automatizaciones', 'archivar')
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  const auto = await automatizacionDeMiEmpresa(id, user)
  if (!auto) return { error: 'Automatización no encontrada.' }

  try {
    await conEmpresa(auto.companyId, (tx) => service(tx).archiveAutomation(id))
    revalidateEstrategias()
    return { success: true }
  } catch (e) {
    console.error('[estrategias] archivar', e)
    return { error: 'No se pudo desinstalar. Intenta de nuevo.' }
  }
}
