'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { requireAdminUser } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { ensureSucursalPrincipal } from '@/modules/empresas/sucursalPrincipal'

// F4.1: la empresa administra su propio perfil público del marketplace.
// Solo puede tocar campos de presentación — nunca isActive/isPublished/
// isFeatured (eso es del superadmin) ni datos de otra empresa.

export interface PerfilState {
  error?: string
  success?: boolean
}

const val = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim() || null

const num = (formData: FormData, key: string) => {
  const raw = String(formData.get(key) ?? '').trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export async function actualizarPerfilPublico(
  _prev: PerfilState,
  formData: FormData
): Promise<PerfilState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  // Superadmin: empresa del formulario o, si no viene, la ACTIVA del
  // selector del panel (verificada). Staff: siempre la de su sesión.
  const companyId = await resolveCompanyId(user, formData)
  if (!companyId) {
    return { error: 'Empresa requerida.' }
  }

  const galleryImages = formData
    .getAll('galleryImages')
    .map(String)
    .filter(Boolean)
    .slice(0, 8)

  const categoryIds = formData
    .getAll('categoryIds')
    .map(String)
    .filter(Boolean)

  try {
    await conEmpresa(companyId, async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: {
          description: val(formData, 'description'),
          horario: val(formData, 'horario'),
          logoUrl: val(formData, 'logoUrl'),
          bannerUrl: val(formData, 'bannerUrl'),
          galleryImages,
          direccion: val(formData, 'direccion'),
          ciudad: val(formData, 'ciudad'),
          provincia: val(formData, 'provincia'),
          pais: val(formData, 'pais'),
          codigoPostal: val(formData, 'codigoPostal'),
          razonSocial: val(formData, 'razonSocial'),
          zonaCobertura: val(formData, 'zonaCobertura'),
          latitud: num(formData, 'latitud'),
          longitud: num(formData, 'longitud'),
          // Paso 4: configuración regional/marca/políticas. moneda/idioma/
          // zonaHoraria son NOT NULL: si vinieran vacíos se conserva el default.
          moneda: val(formData, 'moneda') ?? undefined,
          idioma: val(formData, 'idioma') ?? undefined,
          zonaHoraria: val(formData, 'zonaHoraria') ?? undefined,
          colorPrimario: val(formData, 'colorPrimario'),
          politicaCancelacion: val(formData, 'politicaCancelacion'),
          politicaPrivacidad: val(formData, 'politicaPrivacidad'),
          terminosEmpresa: val(formData, 'terminosEmpresa'),
          telefono: val(formData, 'telefono'),
          whatsapp: val(formData, 'whatsapp'),
          email: val(formData, 'email'),
          website: val(formData, 'website'),
          instagram: val(formData, 'instagram'),
          facebook: val(formData, 'facebook'),
          tiktok: val(formData, 'tiktok'),
          googleMapsUrl: val(formData, 'googleMapsUrl'),
        },
      })
      await tx.companyToCategory.deleteMany({ where: { companyId } })
      if (categoryIds.length > 0) {
        await tx.companyToCategory.createMany({
          data: categoryIds.map((categoryId) => ({ companyId, categoryId })),
          skipDuplicates: true,
        })
      }
    })

    // La dirección/teléfono recién guardados completan la sucursal principal
    // auto-creada (solo campos vacíos; nunca pisa ediciones del admin).
    await ensureSucursalPrincipal(companyId)

    revalidatePath('/admin/perfil')
    revalidatePath('/empresas', 'layout')
    revalidatePath('/')
    revalidateTag('marketplace', 'max')
    return { success: true }
  } catch (e) {
    console.error('[perfil-empresa]', e)
    return { error: 'No se pudo guardar. Intenta de nuevo.' }
  }
}

/**
 * F5.1: publica la empresa en el marketplace. Requiere el checklist de
 * onboarding completo — evita perfiles vacíos que resten confianza.
 */
export async function publicarMiEmpresa(
  _prev: PerfilState,
  _formData: FormData
): Promise<PerfilState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Esta función es del panel de empresa.' }

  try {
    const { getOnboardingEmpresa } = await import('./onboarding')
    const onboarding = await getOnboardingEmpresa(companyId)
    if (!onboarding) return { error: 'Empresa no encontrada.' }
    if (onboarding.publicado) return { error: 'Tu empresa ya está publicada.' }
    if (!onboarding.listoParaPublicar) {
      const faltan = onboarding.items.filter((i) => !i.done).map((i) => i.label)
      return { error: `Completa antes: ${faltan.join(', ')}.` }
    }

    await conEmpresa(companyId, (tx) =>
      tx.company.update({
        where: { id: companyId },
        data: { isPublished: true },
      })
    )

    revalidatePath('/admin/dashboard')
    revalidatePath('/empresas', 'layout')
    revalidateTag('marketplace', 'max')
    revalidatePath('/')
    return { success: true }
  } catch (e) {
    console.error('[publicar-empresa]', e)
    return { error: 'No se pudo publicar. Intenta de nuevo.' }
  }
}
