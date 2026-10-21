import type { AdminSection } from '@/lib/auth/permissions'
import type { Tx } from '@/lib/tenant'
import type { TonoEstado } from '@/components/ui/estado-chip'

/**
 * BENEFICIOS · los cuatro tipos que un negocio ofrece, en un solo lugar (auditoría admin · fase 5, tarea 5.4; 02 · U-06).
 *
 * Los modelos de datos siguen siendo cuatro e independientes —no se fusionan tablas—; lo que se unifica es la vista y la puerta
 * de entrada: UNA pantalla con una pestaña por tipo y UN solo «Crear beneficio». Cada pestaña declara la sección que exige, y
 * el tipo «sobre un producto o servicio» además la capacidad de Ofertas del marketplace (`tiposDisponibles`).
 *
 * No hay aquí ningún mapa «estado → clases de color»: el estado se dice con su etiqueta y su tono semántico, y el chip lo pinta.
 */

export type TipoBeneficio = 'publica' | 'relampago' | 'vip' | 'catalogo'

export interface InfoTipoBeneficio {
  key: TipoBeneficio
  /** En plural, para la pestaña y el título de la lista. */
  titulo: string
  /** En singular, para «Crear beneficio». */
  singular: string
  /** La etiqueta corta de su pestaña. */
  pestana: string
  descripcion: string
  /** La sección del panel que da acceso a este tipo. */
  seccion: AdminSection
  /** Solo se ofrece a quien tiene la capacidad de Ofertas del marketplace. */
  requiereDeals?: boolean
  crearHref: string
  gestionarHref: string
}

export const TIPOS_BENEFICIO: readonly InfoTipoBeneficio[] = [
  {
    key: 'publica',
    titulo: 'Promociones públicas',
    singular: 'Promoción pública',
    pestana: 'Promociones',
    descripcion:
      'Descuento o beneficio visible para todos tus clientes y seguidores. Se publica en tu perfil y en el inicio de la app.',
    seccion: 'promociones',
    crearHref: '/admin/promociones/nuevo',
    gestionarHref: '/admin/promociones',
  },
  {
    key: 'relampago',
    titulo: 'Ofertas relámpago',
    singular: 'Oferta relámpago',
    pestana: 'Relámpago',
    descripcion:
      'Happy Hour u oferta con tiempo límite que aparece viva en el inicio de tus clientes para generar urgencia.',
    seccion: 'marketing',
    crearHref: '/admin/marketing/nueva',
    gestionarHref: '/admin/marketing',
  },
  {
    key: 'vip',
    titulo: 'Regalos VIP',
    singular: 'Regalo VIP',
    pestana: 'Regalos VIP',
    descripcion:
      'Beneficio privado para una lista cerrada de clientes. No se publica: solo tu lista puede reclamarlo por enlace.',
    seccion: 'ofertas',
    crearHref: '/admin/ofertas/nueva',
    gestionarHref: '/admin/ofertas/vip',
  },
  {
    // Commerce Core (F5): la oferta que REFERENCIA un producto o servicio del catálogo. El marketplace la muestra con «antes /
    // ahora»; no crea un producto duplicado ni toca el inventario al publicarse.
    key: 'catalogo',
    titulo: 'Ofertas sobre un producto o servicio',
    singular: 'Oferta sobre un producto o servicio',
    pestana: 'Sobre productos',
    descripcion:
      'Descuento sobre algo de tu catálogo. El marketplace lo muestra con el precio de antes y el de ahora; el cliente lo obtiene y lo canjea con QR.',
    seccion: 'deals',
    requiereDeals: true,
    crearHref: '/admin/deals/nueva',
    gestionarHref: '/admin/deals',
  },
]

/** Los tipos que ESTA persona puede abrir: su sección permitida y, para el de catálogo, la capacidad encendida. */
export function tiposDisponibles(puede: (s: AdminSection) => boolean, conDeals: boolean): InfoTipoBeneficio[] {
  return TIPOS_BENEFICIO.filter((t) => puede(t.seccion) && (!t.requiereDeals || conDeals))
}

/** La pestaña pedida si existe y se puede abrir; si no, la primera disponible (la de promociones públicas, normalmente). */
export function tipoActivo(pedido: string | undefined, disponibles: readonly InfoTipoBeneficio[]): TipoBeneficio | null {
  return disponibles.find((t) => t.key === pedido)?.key ?? disponibles[0]?.key ?? null
}

/** Cómo se DICE el estado de un beneficio y con qué tono, sin un mapa de colores: una función, una decisión por tipo. */
export function estadoDeBeneficio(tipo: TipoBeneficio, estado: string | boolean): { etiqueta: string; tono: TonoEstado } {
  if (tipo === 'publica') return estado ? { etiqueta: 'Activa', tono: 'exito' } : { etiqueta: 'Pausada', tono: 'aviso' }
  const e = String(estado)
  if (e === 'ACTIVA' || e === 'ACTIVE') return { etiqueta: 'Activa', tono: 'exito' }
  if (e === 'PAUSADA' || e === 'PAUSED') return { etiqueta: 'Pausada', tono: 'aviso' }
  if (e === 'BORRADOR' || e === 'DRAFT') return { etiqueta: 'Borrador', tono: 'pendiente' }
  if (e === 'BUDGET_EXHAUSTED') return { etiqueta: 'Sin presupuesto', tono: 'aviso' }
  if (e === 'FINALIZADA' || e === 'COMPLETED') return { etiqueta: 'Finalizada', tono: 'neutro' }
  if (e === 'ARCHIVED') return { etiqueta: 'Archivada', tono: 'neutro' }
  return { etiqueta: e, tono: 'neutro' }
}

export interface FilaBeneficio {
  id: string
  titulo: string
  estado: { etiqueta: string; tono: TonoEstado }
  /** Hasta cuándo vale, si el tipo lo guarda; `null` = sin fecha. */
  hasta: Date | null
  /** La pantalla donde se edita o se gestiona ESTE beneficio. */
  href: string
}

/** Cuántos hay de cada tipo (total de la empresa). Cada uno cae a 0 por separado: la pantalla sigue siendo navegable. */
export async function contarBeneficios(
  tx: Tx,
  companyId: string,
  tipos: readonly InfoTipoBeneficio[]
): Promise<Record<TipoBeneficio, number>> {
  const cero = () => 0
  const cuenta: Record<TipoBeneficio, () => Promise<number>> = {
    publica: () => tx.promocion.count({ where: { companyId, archivada: false } }).catch(cero),
    relampago: () => tx.marketingCampaign.count({ where: { companyId } }).catch(cero),
    vip: () => tx.ofertaPrivada.count({ where: { companyId } }).catch(cero),
    catalogo: () => tx.deal.count({ where: { companyId, status: { not: 'ARCHIVED' } } }).catch(cero),
  }
  const total: Record<TipoBeneficio, number> = { publica: 0, relampago: 0, vip: 0, catalogo: 0 }
  await Promise.all(tipos.map(async (t) => void (total[t.key] = await cuenta[t.key]())))
  return total
}

/** Los más recientes de UN tipo (el de la pestaña abierta), con lo mínimo para decidir a cuál entrar. */
export async function listarBeneficios(tx: Tx, companyId: string, tipo: TipoBeneficio, limite = 25): Promise<FilaBeneficio[] | null> {
  try {
    switch (tipo) {
      case 'publica': {
        const f = await tx.promocion.findMany({
          where: { companyId, archivada: false },
          select: { id: true, titulo: true, activo: true, vigenciaHasta: true },
          orderBy: { createdAt: 'desc' },
          take: limite,
        })
        return f.map((x) => ({ id: x.id, titulo: x.titulo, estado: estadoDeBeneficio(tipo, x.activo), hasta: x.vigenciaHasta, href: `/admin/promociones/${x.id}/editar` }))
      }
      case 'relampago': {
        const f = await tx.marketingCampaign.findMany({
          where: { companyId },
          select: { id: true, titulo: true, estado: true },
          orderBy: { createdAt: 'desc' },
          take: limite,
        })
        return f.map((x) => ({ id: x.id, titulo: x.titulo, estado: estadoDeBeneficio(tipo, x.estado), hasta: null, href: `/admin/marketing/${x.id}/editar` }))
      }
      case 'vip': {
        const f = await tx.ofertaPrivada.findMany({
          where: { companyId },
          select: { id: true, titulo: true, estado: true, vigenciaHasta: true },
          orderBy: { createdAt: 'desc' },
          take: limite,
        })
        return f.map((x) => ({ id: x.id, titulo: x.titulo, estado: estadoDeBeneficio(tipo, x.estado), hasta: x.vigenciaHasta, href: `/admin/ofertas/${x.id}` }))
      }
      case 'catalogo': {
        const f = await tx.deal.findMany({
          where: { companyId, status: { not: 'ARCHIVED' } },
          select: { id: true, title: true, status: true, endsAt: true },
          orderBy: { createdAt: 'desc' },
          take: limite,
        })
        return f.map((x) => ({ id: x.id, titulo: x.title, estado: estadoDeBeneficio(tipo, x.status), hasta: x.endsAt, href: `/admin/deals/${x.id}` }))
      }
    }
  } catch (e) {
    console.error('[admin-beneficios] listar', tipo, e)
    return null
  }
}
