import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getCategoriesPublic } from '@/modules/marketplace/cached'
import { getNavOcultoClienteCached } from '@/modules/cliente/navDisponible'
import { getClientePerfil } from '@/modules/cliente/queries'

export const dynamic = 'force-dynamic'

const ITEMS_MENU = [
  { id: 'empresas', href: '/cliente/empresas', label: 'Empresas y negocios cercanos', icon: 'Store' },
  { id: 'membresias', href: '/mis-membresias', label: 'Membresías activas y disponibles', icon: 'WalletCards' },
  { id: 'promociones', href: '/cliente/promociones', label: 'Catálogo de beneficios y descuentos', icon: 'Percent' },
  { id: 'citas', href: '/cliente/citas', label: 'Mis citas y reservaciones', icon: 'CalendarDays' },
  { id: 'excursiones', href: '/cliente/mis-excursiones', label: 'Mis excursiones y boletos', icon: 'Ticket' },
  { id: 'historial', href: '/cliente/historial', label: 'Historial de visitas y canjes', icon: 'ReceiptText' },
  { id: 'pagos', href: '/cliente/pagos', label: 'Mis pagos y facturación', icon: 'WalletCards' },
  { id: 'ayuda', href: '/cliente/ayuda', label: 'Servicio de atención al cliente y soporte', icon: 'LifeBuoy' },
  { id: 'ajustes', href: '/cliente/ajustes', label: 'Configuración de la cuenta', icon: 'Settings' },
]

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(request: Request) {
  const user = await getApiClientUser(request)

  try {
    const [categorias, ocultas, perfil] = await Promise.all([
      getCategoriesPublic().catch(() => []),
      user?.metadata.clienteId
        ? getNavOcultoClienteCached(user.metadata.clienteId, user.metadata.companyId).catch(
            () => [] as string[]
          )
        : Promise.resolve([] as string[]),
      user?.metadata.clienteId
        ? getClientePerfil(user.metadata.clienteId).catch(() => null)
        : Promise.resolve(null),
    ])

    const ocultoSet = new Set(ocultas)
    const items = ITEMS_MENU.filter((item) => !ocultoSet.has(item.href))
    const nombre = perfil?.nombre?.split(' ')[0] || user?.email?.split('@')[0] || null

    return NextResponse.json({
      usuario: user
        ? {
            email: user.email,
            nombre,
            clienteId: user.metadata.clienteId,
            companyId: user.metadata.companyId,
          }
        : null,
      categorias: categorias.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        icon: c.icon,
      })),
      items,
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/menu] Error cargando datos de menú:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar menú' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
