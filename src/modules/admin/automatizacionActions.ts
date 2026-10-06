'use server'

import { requireAdminUser } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import {
  ejecutarAutomatizacionesEmpresa,
  type ResultadoAutomatizaciones,
} from './automatizaciones'

export interface AutomatizacionState {
  error?: string
  success?: boolean
  resultado?: ResultadoAutomatizaciones
}

/** Ejecuta las automatizaciones de la empresa del usuario (idempotente). */
export async function ejecutarAutomatizaciones(
  _prev: AutomatizacionState,
  _formData: FormData
): Promise<AutomatizacionState> {
  const user = await requireAdminUser('automatizaciones')
  if (!user) return { error: 'No autorizado.' }

  const companyId = await resolveCompanyId(user)
  if (!companyId) return { error: 'Esta función es del panel de empresa.' }

  try {
    const resultado = await ejecutarAutomatizacionesEmpresa(companyId)
    return { success: true, resultado }
  } catch (e) {
    console.error('[automatizaciones] ejecutar', e)
    return { error: 'No se pudieron ejecutar. Intenta de nuevo.' }
  }
}
