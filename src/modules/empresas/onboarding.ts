import { conEmpresa } from '@/lib/tenant'

// F5.1: checklist de onboarding de la empresa. Se calcula desde los datos
// reales (sin columnas de estado): el progreso se "retoma" solo porque
// refleja lo que ya está completado.
//
// Experiencia comercial (2026-10-08): a los pasos del perfil se suman los del
// COMERCIO —sucursal, primer producto, inventario, publicación, primera
// oferta— en el orden en que se usan. No bloquean nada entre sí: la empresa
// puede hacerlos en otro orden y la lista solo refleja lo que ya está.

export interface OnboardingItem {
  key: string
  label: string
  done: boolean
  href: string
  cta: string
  /**
   * false = paso del COMERCIO: se recomienda y se muestra el progreso, pero no
   * bloquea publicar la empresa (una empresa puede publicar su perfil y crear el
   * catálogo después, o en otro orden).
   */
  requeridoParaPublicar: boolean
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
  const [company, categorias, planes, promos, sucursales, productos, productosPublicados, conInventario, conExistencias, ofertas] = await conEmpresa(companyId, async (tx) => {
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
      // ── Onboarding COMERCIAL (experiencia comercial, 2026-10-08) ─────────
      // Los pasos salen de los datos reales de Commerce Core, igual que los del
      // perfil: una sucursal activa, un producto o servicio, su inventario (solo
      // si algún ítem lo controla), su publicación en el marketplace y una oferta.
      tx.sucursal.count({ where: { companyId, activa: true } }).catch(() => 0),
      tx.catalogItem.count({ where: { companyId, status: { not: 'ARCHIVED' } } }).catch(() => 0),
      tx.catalogItem.count({ where: { companyId, status: 'ACTIVE' } }).catch(() => 0),
      tx.catalogItem.count({ where: { companyId, status: { not: 'ARCHIVED' }, capabilities: { path: ['trackInventory'], equals: true } } }).catch(() => 0),
      tx.inventoryLevel.count({ where: { companyId, onHand: { gt: 0 } } }).catch(() => 0),
      tx.deal.count({ where: { companyId, status: { notIn: ['ARCHIVED'] } } }).catch(() => 0),
    ])
    return results
  })
  if (!company) return null

  const items: OnboardingItem[] = [
    {
      key: 'logo',
      requeridoParaPublicar: true,
      label: 'Logo cargado',
      done: !!company.logoUrl,
      href: '/admin/perfil',
      cta: 'Subir logo',
    },
    {
      key: 'banner',
      requeridoParaPublicar: true,
      label: 'Banner cargado',
      done: !!company.bannerUrl,
      href: '/admin/perfil',
      cta: 'Subir banner',
    },
    {
      key: 'descripcion',
      requeridoParaPublicar: true,
      label: 'Descripción completada',
      done: !!company.description && company.description.length >= 20,
      href: '/admin/perfil',
      cta: 'Escribir descripción',
    },
    {
      key: 'ubicacion',
      requeridoParaPublicar: true,
      label: 'Ubicación configurada',
      done: !!(company.ciudad || company.direccion),
      href: '/admin/perfil',
      cta: 'Configurar ubicación',
    },
    {
      key: 'contacto',
      requeridoParaPublicar: true,
      label: 'Contacto (teléfono o WhatsApp)',
      done: !!(company.telefono || company.whatsapp),
      href: '/admin/perfil',
      cta: 'Agregar contacto',
    },
    {
      key: 'categorias',
      requeridoParaPublicar: true,
      label: 'Al menos una categoría',
      done: categorias > 0,
      href: '/admin/perfil',
      cta: 'Elegir categorías',
    },
    // ── Comercio: lo que vende, dónde, cuánto tiene, y la primera oferta ──
    {
      key: 'sucursal',
      requeridoParaPublicar: false,
      label: 'Una sucursal activa (donde se recoge o se atiende)',
      done: sucursales > 0,
      href: '/admin/sucursales',
      cta: 'Agregar sucursal',
    },
    {
      key: 'producto',
      requeridoParaPublicar: false,
      label: 'Tu primer producto o servicio en el catálogo',
      done: productos > 0,
      href: '/admin/catalogo/nuevo',
      cta: 'Crear producto',
    },
    {
      // Hecho si ningún ítem controla inventario (un negocio de servicios no tiene
      // cajas que contar) o si ya hay existencias registradas en alguna sucursal.
      key: 'inventario',
      requeridoParaPublicar: false,
      label: 'Disponibilidad o inventario configurado',
      done: productos > 0 && (conInventario === 0 || conExistencias > 0),
      href: '/admin/inventario',
      cta: 'Configurar inventario',
    },
    {
      key: 'publicar',
      requeridoParaPublicar: false,
      label: 'Al menos un producto o servicio publicado en el marketplace',
      done: productosPublicados > 0,
      href: '/admin/catalogo',
      cta: 'Publicar',
    },
    {
      key: 'oferta',
      requeridoParaPublicar: false,
      label: 'Tu primera oferta sobre un producto o servicio',
      done: ofertas > 0 || promos > 0,
      href: '/admin/deals/nueva',
      cta: 'Crear oferta',
    },
    {
      key: 'plan',
      requeridoParaPublicar: false,
      label: 'Al menos un plan de membresía (opcional si solo vendes productos)',
      done: planes > 0 || productosPublicados > 0,
      href: '/admin/planes/nuevo',
      cta: 'Crear plan',
    },
  ]

  const completados = items.filter((i) => i.done).length
  return {
    items,
    completados,
    total: items.length,
    // Publicar exige el PERFIL completo; los pasos del comercio son el camino recomendado, no una puerta.
    listoParaPublicar: items.filter((i) => i.requeridoParaPublicar).every((i) => i.done),
    publicado: company.isPublished,
  }
}
