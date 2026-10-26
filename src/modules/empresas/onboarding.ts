import { conEmpresa } from '@/lib/tenant'
import { conRetornoAlAsistente } from './onboarding-retorno'

export { conRetornoAlAsistente, PARAM_DESDE_ONBOARDING, VALOR_DESDE_ONBOARDING } from './onboarding-retorno'

// F5.1: checklist de onboarding de la empresa. Se calcula desde los datos
// reales (sin columnas de estado): el progreso se "retoma" solo porque
// refleja lo que ya está completado.
//
// Experiencia comercial (2026-10-08): a los pasos del perfil se suman los del
// COMERCIO —sucursal, primer producto, inventario, publicación, primera
// oferta— en el orden en que se usan. No bloquean nada entre sí: la empresa
// puede hacerlos en otro orden y la lista solo refleja lo que ya está.
//
// Fase 7 · 7.5 (auditoría admin, 01 · §5): faltaban el HORARIO y el COBRO —lo que un cliente necesita saber antes de venir y cómo
// pagarte— y ningún paso dejaba un camino de vuelta al asistente. El horario y el cobro se recomiendan pero NO bloquean publicar (las
// empresas que ya están en marcha no pueden quedar de pronto «sin listas»), y cada enlace lleva `?desde=onboarding`, que el panel
// recoge para ofrecer «Volver a configurar tu empresa».

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

/** Lo que hace falta saber de la empresa para armar la lista. Plano y sin servicios: se prueba sin base. */
export interface DatosDeOnboarding {
  logoUrl: string | null
  bannerUrl: string | null
  description: string | null
  ciudad: string | null
  direccion: string | null
  telefono: string | null
  whatsapp: string | null
  /** Texto libre del perfil (o el estructurado de alguna sucursal activa). */
  horario: string | null
  /** Sucursales activas con horario estructurado (el horario detallado vive en cada sucursal, no en la empresa). */
  sucursalesConHorario: number
  categorias: number
  planes: number
  promos: number
  sucursales: number
  /** Métodos de pago activos (transferencia o pago presencial). */
  metodosDePago: number
  productos: number
  productosPublicados: number
  conInventario: number
  conExistencias: number
  ofertas: number
}

/** Los pasos, en el orden en que se usan. Pura. */
export function pasosDeOnboarding(d: DatosDeOnboarding): OnboardingItem[] {
  const paso = (p: OnboardingItem): OnboardingItem => ({ ...p, href: conRetornoAlAsistente(p.href) })
  const horarioConfigurado = !!d.horario?.trim() || d.sucursalesConHorario > 0
  return [
    paso({ key: 'logo', requeridoParaPublicar: true, label: 'Logo cargado', done: !!d.logoUrl, href: '/admin/perfil', cta: 'Subir logo' }),
    paso({ key: 'banner', requeridoParaPublicar: true, label: 'Banner cargado', done: !!d.bannerUrl, href: '/admin/perfil', cta: 'Subir banner' }),
    paso({
      key: 'descripcion',
      requeridoParaPublicar: true,
      label: 'Descripción completada',
      done: !!d.description && d.description.length >= 20,
      href: '/admin/perfil',
      cta: 'Escribir descripción',
    }),
    paso({
      key: 'ubicacion',
      requeridoParaPublicar: true,
      label: 'Ubicación configurada',
      done: !!(d.ciudad || d.direccion),
      href: '/admin/perfil',
      cta: 'Configurar ubicación',
    }),
    paso({
      key: 'contacto',
      requeridoParaPublicar: true,
      label: 'Contacto (teléfono o WhatsApp)',
      done: !!(d.telefono || d.whatsapp),
      href: '/admin/perfil',
      cta: 'Agregar contacto',
    }),
    paso({ key: 'categorias', requeridoParaPublicar: true, label: 'Al menos una categoría', done: d.categorias > 0, href: '/admin/perfil', cta: 'Elegir categorías' }),
    // Lo que un cliente quiere saber antes de venir: cuándo abres. Se escribe en el perfil público (campo «Horario de atención»).
    paso({
      key: 'horario',
      requeridoParaPublicar: false,
      label: 'Horario de atención',
      done: horarioConfigurado,
      href: '/admin/perfil',
      cta: 'Escribir horario',
    }),
    // ── Comercio: lo que vende, dónde, cómo cobra, cuánto tiene, y la primera oferta ──
    paso({
      key: 'sucursal',
      requeridoParaPublicar: false,
      label: 'Una sucursal activa (donde se recoge o se atiende)',
      done: d.sucursales > 0,
      href: '/admin/sucursales',
      cta: 'Agregar sucursal',
    }),
    // Cómo te pagan: sin un método de pago, un cliente que quiere comprar no sabe a dónde transferir ni dónde pagar.
    paso({
      key: 'cobro',
      requeridoParaPublicar: false,
      label: 'Cómo cobras (transferencia o pago en sucursal)',
      done: d.metodosDePago > 0,
      href: '/admin/metodos-pago/nuevo',
      cta: 'Agregar método de pago',
    }),
    paso({
      key: 'producto',
      requeridoParaPublicar: false,
      label: 'Tu primer producto o servicio en el catálogo',
      done: d.productos > 0,
      href: '/admin/catalogo/nuevo',
      cta: 'Crear producto',
    }),
    paso({
      // Hecho si ningún ítem controla inventario (un negocio de servicios no tiene
      // cajas que contar) o si ya hay existencias registradas en alguna sucursal.
      key: 'inventario',
      requeridoParaPublicar: false,
      label: 'Disponibilidad o inventario configurado',
      done: d.productos > 0 && (d.conInventario === 0 || d.conExistencias > 0),
      href: '/admin/inventario',
      cta: 'Configurar inventario',
    }),
    paso({
      key: 'publicar',
      requeridoParaPublicar: false,
      label: 'Al menos un producto o servicio publicado en el marketplace',
      done: d.productosPublicados > 0,
      href: '/admin/catalogo',
      cta: 'Publicar',
    }),
    paso({
      key: 'oferta',
      requeridoParaPublicar: false,
      label: 'Tu primera oferta sobre un producto o servicio',
      done: d.ofertas > 0 || d.promos > 0,
      href: '/admin/deals/nueva',
      cta: 'Crear oferta',
    }),
    paso({
      key: 'plan',
      requeridoParaPublicar: false,
      label: 'Al menos un plan de membresía (opcional si solo vendes productos)',
      done: d.planes > 0 || d.productosPublicados > 0,
      href: '/admin/planes/nuevo',
      cta: 'Crear plan',
    }),
  ]
}

/** Publicar exige el PERFIL completo; los pasos del comercio son el camino recomendado, no una puerta. */
export function resumenDeOnboarding(items: OnboardingItem[], publicado: boolean): OnboardingEmpresa {
  return {
    items,
    completados: items.filter((i) => i.done).length,
    total: items.length,
    listoParaPublicar: items.filter((i) => i.requeridoParaPublicar).every((i) => i.done),
    publicado,
  }
}

export async function getOnboardingEmpresa(
  companyId: string
): Promise<OnboardingEmpresa | null> {
  const [company, categorias, planes, promos, sucursalesActivas, metodosDePago, productos, productosPublicados, conInventario, conExistencias, ofertas] = await conEmpresa(companyId, async (tx) => {
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
          horario: true,
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
      tx.sucursal.findMany({ where: { companyId, activa: true }, select: { horarioDetallado: true } }).catch(() => []),
      tx.metodoPago.count({ where: { companyId, activo: true } }).catch(() => 0),
      tx.catalogItem.count({ where: { companyId, status: { not: 'ARCHIVED' } } }).catch(() => 0),
      tx.catalogItem.count({ where: { companyId, status: 'ACTIVE' } }).catch(() => 0),
      tx.catalogItem.count({ where: { companyId, status: { not: 'ARCHIVED' }, capabilities: { path: ['trackInventory'], equals: true } } }).catch(() => 0),
      tx.inventoryLevel.count({ where: { companyId, onHand: { gt: 0 } } }).catch(() => 0),
      tx.deal.count({ where: { companyId, status: { notIn: ['ARCHIVED'] } } }).catch(() => 0),
    ])
    return results
  })
  if (!company) return null

  const items = pasosDeOnboarding({
    logoUrl: company.logoUrl,
    bannerUrl: company.bannerUrl,
    description: company.description,
    ciudad: company.ciudad,
    direccion: company.direccion,
    telefono: company.telefono,
    whatsapp: company.whatsapp,
    horario: company.horario,
    sucursalesConHorario: sucursalesActivas.filter((s) => s.horarioDetallado !== null).length,
    categorias,
    planes,
    promos,
    sucursales: sucursalesActivas.length,
    metodosDePago,
    productos,
    productosPublicados,
    conInventario,
    conExistencias,
    ofertas,
  })
  return resumenDeOnboarding(items, company.isPublished)
}
