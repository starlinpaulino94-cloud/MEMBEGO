import { conEmpresaOTodas } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRuletaPremiosAdmin } from '@/modules/engagement/ruleta'
import { COSTO_RULETA } from '@/lib/gamificacion'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { RuletaAdmin, type PremioRow } from '@/components/gamificacion/RuletaAdmin'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ruleta de premios' }

export default async function AdminGamificacionPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user)
  if (!companyId) {
    return <SinEmpresaActiva seccion="la ruleta de premios" />
  }

  // `getRuletaPremiosAdmin` abre su propia transacción: fuera del envoltorio,
  // que anidarlas agota el pool con el pooler por delante.
  const [premiosRaw, promociones] = await Promise.all([
    getRuletaPremiosAdmin(companyId),
    conEmpresaOTodas(
      companyId,
      'gamificacion: sin empresa activa es el superadmin',
      (tx) =>
        tx.promocion.findMany({
          where: { companyId, activo: true, archivada: false },
          select: { id: true, titulo: true },
          orderBy: { titulo: 'asc' },
        })
    ),
  ])

  const premios: PremioRow[] = premiosRaw.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    tipo: p.tipo,
    promocionId: p.promocionId,
    promocion: p.promocion,
    probabilidad: p.probabilidad,
    color: p.color,
    activo: p.activo,
    orden: p.orden,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ruleta de premios"
        description={`Tus clientes gastan ${COSTO_RULETA} puntos por giro y pueden ganar los premios que configures aquí. Los puntos se ganan usando beneficios e invitando amigos.`}
      />
      <RuletaAdmin premios={premios} promociones={promociones} />
    </div>
  )
}
