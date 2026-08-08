'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { requireRole } from '@/lib/auth/guards'
import { leerUbicacionDeForm } from '@/modules/registro/geo-form'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import { LocationConsentService } from '@/modules/geo/consentimiento/service'

export interface UbicacionActionState {
  error?: string
  ok?: boolean
}

/**
 * Guardar o cambiar la vivienda desde el perfil (§42).
 *
 * POR QUÉ ESTA ACCIÓN EXISTE: `LocationService` estaba completo —guardar,
 * actualizar, eliminar, cambiar la primaria— pero solo se invocaba desde el
 * registro. Quien se saltaba ese paso, o se mudaba, no tenía ninguna forma de
 * poner su vivienda: el enlace "Cambiar" del Inicio llevaba al perfil y allí
 * no había nada que cambiar.
 *
 * No reimplementa nada: reutiliza el mismo parser del formulario que usa el
 * registro y el mismo servicio, con sus reglas de consentimiento intactas.
 * Guardar una vivienda EXIGE HOME_STORAGE, así que se otorga antes —igual que
 * en el registro— y solo cuando la persona marcó la casilla.
 */
export async function guardarUbicacionVivienda(
  _prev: UbicacionActionState,
  formData: FormData
): Promise<UbicacionActionState> {
  const user = await requireRole('CLIENTE')
  const dbUserId = user.metadata.dbUserId
  if (!dbUserId) return { error: 'Tu cuenta no está completamente configurada.' }

  const entradas = Object.fromEntries(formData.entries()) as Record<string, string>
  const resultado = leerUbicacionDeForm(entradas)
  if (!resultado.ok) return { error: resultado.error }

  if (!resultado.guardar) {
    return { error: 'Marca la casilla para guardar tu vivienda en tu cuenta.' }
  }

  try {
    const cabeceras = await headers()
    const meta = {
      canal: 'perfil' as const,
      ipAddress: cabeceras.get('x-forwarded-for'),
      userAgent: cabeceras.get('user-agent'),
    }

    // El orden importa: guardar la vivienda exige HOME_STORAGE activo.
    await LocationConsentService.otorgar(dbUserId, 'HOME_STORAGE', meta)
    await LocationConsentService.otorgar(dbUserId, 'FUNCTIONAL_USAGE', meta)
    if (resultado.marketingGeo) {
      await LocationConsentService.otorgar(dbUserId, 'MARKETING_GEO', meta)
    }

    // `isPrimary: true` desmarca la anterior dentro de la misma transacción,
    // así que cambiar de vivienda no deja dos primarias.
    await LocationService.guardar(dbUserId, { ...resultado.ubicacion, isPrimary: true })

    revalidatePath('/cliente/perfil')
    revalidatePath('/cliente/inicio')
    return { ok: true }
  } catch (e) {
    console.error('[perfil:ubicacion]', e)
    return { error: 'No pudimos guardar tu ubicación. Intenta de nuevo.' }
  }
}
