import { conEmpresa } from '@/lib/tenant'

// F5.1: checklist de onboarding de la empresa. Se calcula desde los datos
// reales (sin columnas de estado): el progreso se "retoma" solo porque
// refleja lo que ya está completado.

export interface OnboardingItem {
  key: string
  label: string
  done: boolean
  href: string
  cta: string
}

export interface OnboardingEmpresa {
  items: OnboardingItem[]
  completados: number
  total: number
  listoParaPublicar: boolean
  publicado: boolean
}

export async function getOnboardingEmpresa(
  companyId: string
): Promise<OnboardingEmpresa | null> {
  const [company, categorias, planes, promos] = await conEmpresa(companyId, async (tx) => {
    const results = await Promise.all([
      tx.company.findUnique({
        where: { id: companyId },
        select: {
          isPublished: true,
          logoUrl: true,
          bannerUrl: true,
          description: true,
          ciudad: true,
          direccion: true,
          telefono: true,
          whatsapp: true,
        },
      }),
      tx.companyToCategory.count({ where: { companyId } }),
      tx.plan.count({ where: { companyId, activo: true } }),
      tx.promocion.count({
        where: { companyId, activo: true, archivada: false },
      }),
    ])
    return results
  })
  if (!company) return null

  const items: OnboardingItem[] = [
    {
      key: 'logo',
      label: 'Logo cargado',
      done: !!company.logoUrl,
      href: '/admin/perfil',
      cta: 'Subir logo',
    },
    {
      key: 'banner',
      label: 'Banner cargado',
      done: !!company.bannerUrl,
      href: '/admin/perfil',
      cta: 'Subir banner',
    },
    {
      key: 'descripcion',
      label: 'Descripción completada',
      done: !!company.description && company.description.length >= 20,
      href: '/admin/perfil',
      cta: 'Escribir descripción',
    },
    {
      key: 'ubicacion',
      label: 'Ubicación configurada',
      done: !!(company.ciudad || company.direccion),
      href: '/admin/perfil',
      cta: 'Configurar ubicación',
    },
    {
      key: 'contacto',
      label: 'Contacto (teléfono o WhatsApp)',
      done: !!(company.telefono || company.whatsapp),
      href: '/admin/perfil',
      cta: 'Agregar contacto',
    },
    {
      key: 'categorias',
      label: 'Al menos una categoría',
      done: categorias > 0,
      href: '/admin/perfil',
      cta: 'Elegir categorías',
    },
    {
      key: 'plan',
      label: 'Al menos un plan creado',
      done: planes > 0,
      href: '/admin/planes/nuevo',
      cta: 'Crear plan',
    },
    {
      key: 'promocion',
      label: 'Al menos una promoción activa',
      done: promos > 0,
      href: '/admin/promociones/nuevo',
      cta: 'Crear promoción',
    },
  ]

  const completados = items.filter((i) => i.done).length
  return {
    items,
    completados,
    total: items.length,
    listoParaPublicar: completados === items.length,
    publicado: company.isPublished,
  }
}
