import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import {
  Megaphone,
  Sparkles,
  Gift,
  Plus,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { empresaDelPanel } from '@/modules/admin/queries'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ofertas' }

/**
 * Hub de Ofertas (Auditoría · Fase D).
 *
 * Punto de entrada ÚNICO para todo lo que un negocio "ofrece". Antes había
 * tres módulos sueltos en el menú (Promociones, Banners, Regalos VIP) y el
 * dueño no sabía dónde crear cada cosa. Este hub unifica el punto de partida
 * y el lenguaje: se elige el TIPO de oferta y se enruta al flujo real. Los
 * modelos de datos siguen siendo independientes (no se fusionan tablas); lo
 * que se unifica es la puerta de entrada.
 */
type TipoOferta = {
  key: 'publica' | 'relampago' | 'vip'
  titulo: string
  descripcion: string
  icon: LucideIcon
  crearHref: string
  crearLabel: string
  gestionarHref: string
}

const TIPOS: TipoOferta[] = [
  {
    key: 'publica',
    titulo: 'Promoción pública',
    descripcion:
      'Descuento o beneficio visible para todos tus clientes y seguidores. Se publica en tu perfil y en el inicio de la app.',
    icon: Megaphone,
    crearHref: '/admin/promociones/nuevo',
    crearLabel: 'Nueva promoción',
    gestionarHref: '/admin/promociones',
  },
  {
    key: 'relampago',
    titulo: 'Oferta relámpago',
    descripcion:
      'Happy Hour u oferta con tiempo límite que aparece viva en el inicio de tus clientes para generar urgencia.',
    icon: Sparkles,
    crearHref: '/admin/marketing/nueva',
    crearLabel: 'Nuevo banner',
    gestionarHref: '/admin/marketing',
  },
  {
    key: 'vip',
    titulo: 'Regalo VIP',
    descripcion:
      'Beneficio privado para una lista cerrada de clientes. No se publica: solo tu lista puede reclamarlo por enlace.',
    icon: Gift,
    crearHref: '/admin/ofertas/nueva',
    crearLabel: 'Nuevo regalo VIP',
    gestionarHref: '/admin/ofertas/vip',
  },
]

export default async function OfertasHubPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = empresaDelPanel(user)

  if (!companyId) {
    return <SinEmpresaActiva seccion="tus ofertas" />
  }

  // Conteos por tipo (total por empresa). Fail-open: si una query falla, se
  // muestra 0 y el hub sigue siendo navegable.
  const [publicas, relampago, vip] = await conEmpresaOTodas(
    companyId,
    'ofertas: sin empresa activa es el superadmin, que cruza empresas a propósito',
    (tx) => Promise.all([
      tx.promocion.count({ where: { companyId, archivada: false } }).catch(() => 0),
      tx.marketingCampaign.count({ where: { companyId } }).catch(() => 0),
      tx.ofertaPrivada.count({ where: { companyId } }).catch(() => 0),
    ])
  )
  const conteo: Record<TipoOferta['key'], number> = { publica: publicas, relampago, vip }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Ofertas"
        description="Todo lo que ofreces a tus clientes en un solo lugar. Elige el tipo y créalo; cada tipo tiene su propio panel de gestión."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {TIPOS.map((t) => {
          const Icon = t.icon
          const n = conteo[t.key]
          return (
            <div
              key={t.key}
              className="flex flex-col rounded-2xl border border-border/70 bg-card p-5 shadow-card"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-semibold text-foreground">{t.titulo}</h2>
                  <p className="text-xs text-muted-foreground">
                    {n === 0 ? 'Ninguna creada' : `${n} en total`}
                  </p>
                </div>
              </div>

              <p className="mt-3 flex-1 text-sm text-muted-foreground">{t.descripcion}</p>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Link
                  href={t.crearHref}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                >
                  <Plus className="h-4 w-4" /> {t.crearLabel}
                </Link>
                <Link
                  href={t.gestionarHref}
                  className="inline-flex items-center gap-1 rounded-xl border border-border/70 px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
                >
                  Ver todas <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
