import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  Pencil,
  Car,
  UtensilsCrossed,
  MapPin,
  Mail,
  Phone,
  Globe,
  Calendar,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { formatDate } from '@/lib/format'
import { getEmpresaDashboard } from '@/modules/empresas/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmpresaDashboard } from '@/components/superadmin/EmpresaDashboard'
import { SembrarDemoExcursiones } from '@/components/superadmin/SembrarDemoExcursiones'
import { sinEmpresa } from '@/lib/tenant'
import { capacidadesDeEmpresa } from '@/modules/capacidades/catalogo'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) {
  return formatDate(d, null, { day: '2-digit', month: 'long', year: 'numeric' })
}

export default async function EmpresaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('SUPERADMIN')
  const { id } = await params

  const data = await getEmpresaDashboard(id)
  if (!data) notFound()

  const { company, stats, actividadReciente, topPlanes, membresiasPorEstado } = data

  // La siembra de demostración solo se ofrece si la empresa está marcada como
  // demo Y tiene la capacidad: proponer un botón que el servidor va a rechazar
  // es peor que no ofrecerlo.
  const ficha = await sinEmpresa('el superadmin abre la ficha de cualquier empresa', (tx) =>
    tx.company.findUnique({
      where: { id },
      select: { esDemo: true, capacidades: true, type: true, tipoNegocioCodigo: true },
    })
  )
  const ofreceDemoExcursiones =
    !!ficha?.esDemo && capacidadesDeEmpresa(ficha).activas.has('EXCURSIONES')
  const Icon = company.type === 'carwash' ? Car : UtensilsCrossed
  const iconBg = company.type === 'carwash' ? 'bg-info/10' : 'bg-warning/15'
  const iconColor = company.type === 'carwash' ? 'text-primary' : 'text-warning'

  return (
    <div className="space-y-6 animate-fade-up">
      <Link
        href="/superadmin/empresas"
        className="inline-flex items-center gap-1.5 text-small text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a empresas
      </Link>

      {/* Company header */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {company.logoUrl ? (
                // Logo subido por el usuario, de dominio arbitrario.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={company.logoUrl}
                  alt={company.name}
                  className="h-14 w-14 rounded-2xl object-cover"
                />
              ) : (
                <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${iconBg}`}>
                  <Icon className={`h-7 w-7 ${iconColor}`} />
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-foreground">{company.name}</h1>
                  <Badge
                    className={
                      company.isActive
                        ? 'bg-success/15 text-success'
                        : 'bg-muted text-muted-foreground'
                    }
                  >
                    {company.isActive ? 'Activa' : 'Suspendida'}
                  </Badge>
                </div>
                {company.description && (
                  <p className="mt-0.5 text-small text-muted-foreground">{company.description}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
                  {company.ciudad && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {company.ciudad}
                      {company.direccion && ` — ${company.direccion}`}
                    </span>
                  )}
                  {company.email && (
                    <a href={`mailto:${company.email}`} className="flex items-center gap-1 hover:text-foreground">
                      <Mail className="h-3 w-3" /> {company.email}
                    </a>
                  )}
                  {company.telefono && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {company.telefono}
                    </span>
                  )}
                  {company.website && (
                    <a
                      href={company.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 hover:text-foreground"
                    >
                      <Globe className="h-3 w-3" /> Sitio web
                    </a>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Desde {fmtDate(company.createdAt)}
                  </span>
                </div>
              </div>
            </div>
            <Link href={`/superadmin/empresas/${company.id}/editar`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" /> Editar
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {ofreceDemoExcursiones ? <SembrarDemoExcursiones companyId={company.id} /> : null}

      <EmpresaDashboard
        companyId={company.id}
        stats={stats}
        actividadReciente={actividadReciente.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
        }))}
        topPlanes={topPlanes}
        membresiasPorEstado={membresiasPorEstado}
      />
    </div>
  )
}
