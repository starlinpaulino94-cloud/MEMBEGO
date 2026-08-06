'use server'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureEmailIdentity } from '@/lib/supabase/identity'
import { registerLimiter } from '@/lib/rate-limit'
import { getRequestMeta } from '@/lib/server-utils'
import { TERMS_VERSION } from '@/lib/legal'
import { isEmailVerificationEnabled, sendVerificationEmail } from '@/lib/auth/emailVerification'
import { ensureSucursalPrincipal } from '@/modules/empresas/sucursalPrincipal'
import { anotarFallo } from '@/lib/prisma-errors'

// F5.1: registro self-service de empresas (B2B). La empresa se crea
// DESPUBLICADA (isPublished: false): no aparece en el marketplace hasta
// completar el checklist de onboarding y publicarse desde su panel.

export interface RegistroEmpresaState {
  error?: string
  success?: boolean
  /** Cuenta creada pero pendiente de confirmar el correo (flag O-1). */
  pendingVerification?: boolean
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

async function uniqueCompanySlug(name: string): Promise<string> {
  const base = slugify(name) || 'empresa'
  let slug = base
  let n = 1
  while (await sinEmpresa('registro: comprobar slug de empresa (catálogo global)', (tx) =>
    tx.company.findUnique({ where: { slug } })
  )) {
    n += 1
    slug = `${base}-${n}`
  }
  return slug
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

  const supabase = createAdminClient()
  let companyId: string | null = null
  let supabaseId: string | null = null

  try {
    const slug = await uniqueCompanySlug(nombreComercial)
    const company = await sinEmpresa('registro: crear la nueva empresa', (tx) =>
      tx.company.create({
        data: {
          name: nombreComercial,
          slug,
          type: tipo,
          pais: pais || null,
          isActive: true,
          // Clave del onboarding: no aparece en el marketplace todavía.
          isPublished: false,
        },
      })
    )
    companyId = company.id

    // Toda empresa nace con su sucursal principal: la mayoría tiene un solo
    // local y sin sucursal la Caja no puede cobrar. La dirección/teléfono se
    // completan solos cuando el dueño los registre en el onboarding.
    await ensureSucursalPrincipal(company.id)

    const verificarCorreo = isEmailVerificationEnabled()
    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        // Con verificación activada la cuenta nace SIN confirmar.
        email_confirm: !verificarCorreo,
        user_metadata: { name: nombrePropietario },
      })
    if (createError || !created.user) {
      throw new Error(createError?.message ?? 'No se pudo crear la cuenta.')
    }
    supabaseId = created.user.id
    const nuevoSupabaseId = supabaseId

    await ensureEmailIdentity(supabaseId, email)

    const now = new Date()
    const dbUser = await conEmpresa(company.id, (tx) =>
      tx.user.create({
        data: {
          supabaseId: nuevoSupabaseId,
          email,
          name: nombrePropietario,
          role: 'ADMINISTRADOR',
          companyId: company.id,
          termsAcceptedAt: now,
          termsVersion: TERMS_VERSION,
          marketingConsent,
          marketingConsentAt: marketingConsent ? now : null,
        },
      })
    )

    await supabase.auth.admin.updateUserById(supabaseId, {
      app_metadata: {
        role: 'ADMINISTRADOR',
        dbUserId: dbUser.id,
        companyId,
      },
    })

    if (verificarCorreo) {
      await sendVerificationEmail(supabase, email, nombrePropietario)
      return { pendingVerification: true }
    }
    return { success: true }
  } catch (e) {
    console.error('[registro-empresa]', e)
    // Rollback para no dejar registros huérfanos.
    if (supabaseId) {
      await supabase.auth.admin.deleteUser(supabaseId).catch(anotarFallo('registro:rollback-auth-user'))
    }
    if (companyId) {
      const idEmpresa = companyId
      await conEmpresa(idEmpresa, (tx) =>
        tx.company.delete({ where: { id: idEmpresa } })
      ).catch(anotarFallo('registro:company.delete'))
    }
    return { error: 'No se pudo completar el registro. Intenta de nuevo.' }
  }
}
