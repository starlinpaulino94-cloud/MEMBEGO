'use server'

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { anotarFallo } from '@/lib/prisma-errors'

export interface ConfigActionState {
  error?: string
  success?: string
}

export async function guardarExcursionesConfig(
  _prev: ConfigActionState,
  formData: FormData
): Promise<ConfigActionState> {
  try {
    const user = await requireSection('excursiones')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const politicaAtribucion = String(formData.get('politicaAtribucion') ?? 'PRIMERA').trim()
    const ventanaAtribucionDias = Math.max(1, Math.min(365, Number(formData.get('ventanaAtribucionDias') ?? 30)))
    const monedaDefecto = String(formData.get('monedaDefecto') ?? 'DOP').trim().toUpperCase()
    const reglaAprobacion = String(formData.get('reglaAprobacion') ?? 'MANUAL').trim()

    const permitirReduccionPasajeros = formData.get('permitirReduccionPasajeros') === 'true' || formData.get('permitirReduccionPasajeros') === 'on'
    const anticipacionMinimaHoras = Math.max(0, Math.min(720, Number(formData.get('anticipacionMinimaHoras') ?? 24)))
    const permitirCancelacion = formData.get('permitirCancelacion') === 'true' || formData.get('permitirCancelacion') === 'on'
    const anticipacionCancelacionHoras = Math.max(0, Math.min(720, Number(formData.get('anticipacionCancelacionHoras') ?? 48)))
    const penalizacionCancelacionPct = Math.max(0, Math.min(100, Number(formData.get('penalizacionCancelacionPct') ?? 0)))
    const tipoReembolso = String(formData.get('tipoReembolso') ?? 'COMPLETO').trim().toUpperCase()
    const horasLimiteReembolso = Math.max(0, Math.min(720, Number(formData.get('horasLimiteReembolso') ?? 24)))
    const notasPoliticas = String(formData.get('notasPoliticas') ?? '').trim() || null

    // Parse tasasCambio from form fields
    const tasasCambio: Record<string, number> = {}
    const tasaFields = ['DOP_USD', 'USD_DOP', 'EUR_USD', 'EUR_DOP', 'USD_EUR', 'DOP_EUR']
    for (const key of tasaFields) {
      const val = Number(formData.get(`tasa_${key}`))
      if (Number.isFinite(val) && val > 0) tasasCambio[key] = val
    }

    const data = {
      politicaAtribucion,
      ventanaAtribucionDias,
      monedaDefecto,
      reglaAprobacion,
      permitirReduccionPasajeros,
      anticipacionMinimaHoras,
      permitirCancelacion,
      anticipacionCancelacionHoras,
      penalizacionCancelacionPct,
      tipoReembolso,
      horasLimiteReembolso,
      notasPoliticas,
      tasasCambio,
    }

    await conEmpresa(companyId, (tx) =>
      tx.excursionesConfig.upsert({
        where: { companyId },
        create: {
          companyId,
          ...data,
        },
        update: data,
      })
    )

    revalidatePath('/admin/excursiones/config')
    revalidatePath('/admin/excursiones')

    return { success: 'Configuración guardada exitosamente.' }
  } catch (e) {
    anotarFallo('excursiones:guardarExcursionesConfig')(e)
    return { error: 'Error al guardar la configuración.' }
  }
}
