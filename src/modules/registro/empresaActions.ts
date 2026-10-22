'use server'

import { sinEmpresa } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { registerLimiter } from '@/lib/rate-limit'
import { getRequestMeta } from '@/lib/server-utils'
import { TERMS_VERSION } from '@/lib/legal'
import { isEmailVerificationEnabled, sendVerificationEmail } from '@/lib/auth/emailVerification'
import { darDeAltaEmpresa } from '@/modules/empresas/alta'
import { verticalValido } from '@/modules/empresas/verticales'

// F5.1: registro self-service de empresas (B2B). La empresa se crea
// DESPUBLICADA (isPublished: false): no aparece en el marketplace hasta
// completar el checklist de onboarding y publicarse desde su panel.

export interface RegistroEmpresaState {
  error?: string
  success?: boolean
  /** Cuenta creada pero pendiente de confirmar el correo (flag O-1). */
  pendingVerification?: boolean
}

export async function registrarEmpresa(
  _prev: RegistroEmpresaState,
  formData: FormData
): Promise<RegistroEmpresaState> {
  const meta = await getRequestMeta()
  if (!(await registerLimiter(meta.ipAddress ?? 'unknown'))) {
    return { error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' }
  }

  const nombrePropietario = String(formData.get('nombrePropietario') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const pais = String(formData.get('pais') ?? '').trim()
  const nombreComercial = String(formData.get('nombreComercial') ?? '').trim()
  const tipo = String(formData.get('tipo') ?? 'otro').trim() || 'otro'
  const aceptaTerminos = formData.get('terminos') === 'on'
  const marketingConsent = formData.getAll('marketingConsent').at(-1) === 'on'

  if (!nombrePropietario || !email || !password || !nombreComercial) {
    return { error: 'Completa todos los campos obligatorios.' }
  }
  if (!/.+@.+\..+/.test(email)) return { error: 'El correo no es válido.' }
  if (password.length < 6) {
    return { error: 'La contraseña debe tener al menos 6 caracteres.' }
  }
  if (!aceptaTerminos) {
    return { error: 'Debes aceptar los términos y condiciones.' }
  }

  // Unicidad de correo (auth) y detección de duplicados básicos.
  const existingUser = await sinEmpresa('registro: buscar usuario por email (cross-tenant)', (tx) =>
    tx.user.findUnique({ where: { email } })
  )
  if (existingUser) {
    return { error: 'Ya existe una cuenta con ese correo. Inicia sesión.' }
  }

  try {
    // El vertical se escribe en la columna que manda, como en el alta del superadmin: antes este camino la dejaba vacía (el hueco que
    // `registro.ts` avisaba) y la empresa se resolvía por el texto de `type`.
    const codigoVertical = await verticalValido(tipo)
    const verificarCorreo = isEmailVerificationEnabled()
    const ahora = new Date()

    await darDeAltaEmpresa({
      empresa: {
        nombre: nombreComercial,
        tipo,
        tipoNegocioCodigo: codigoVertical,
        pais: pais || null,
        // Clave del onboarding: no aparece en el marketplace todavía. La dirección y el teléfono se completan solos cuando el dueño los
        // registre en el onboarding.
        publicada: false,
      },
      administrador: {
        modo: 'nuevo',
        nombre: nombrePropietario,
        email,
        password,
        // Con verificación activada la cuenta nace SIN confirmar.
        confirmarCorreo: !verificarCorreo,
        consentimiento: { terminosVersion: TERMS_VERSION, marketing: marketingConsent, en: ahora },
      },
      // Dentro de la protección del alta: si el correo de verificación no sale, no queda una cuenta que nunca podrá entrar.
      alTerminar: verificarCorreo
        ? async () => {
            await sendVerificationEmail(createAdminClient(), email, nombrePropietario)
          }
        : undefined,
    })

    return verificarCorreo ? { pendingVerification: true } : { success: true }
  } catch (e) {
    console.error('[registro-empresa]', e)
    return { error: 'No se pudo completar el registro. Intenta de nuevo.' }
  }
}
