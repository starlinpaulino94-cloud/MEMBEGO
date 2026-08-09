export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check, Infinity as InfinityIcon, Plus, Pencil } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DeletePlanButton } from '@/components/admin/DeletePlanButton'
import { PlanPausarBoton } from '@/components/admin/PlanPausarBoton'

export default async function SuperadminPlanesPage() {
  await requireRole('SUPERADMIN')

  let planes: {
    id: string; nombre: string; precio: unknown; esIlimitado: boolean;
    lavadosIncluidos: number; activo: boolean; descripcion: string | null;
    beneficios: string[]; companyId: string;
    company: { name: string }; _count: { memberships: number }
  }[] = []
  let companies: { id: string; name: string }[] = []

  try {
    const [p, c] = await Promise.all([
      prisma.plan.findMany({
        select: {
          id: true, nombre: true, precio: true, esIlimitado: true,
          lavadosIncluidos: true, activo: true, descripcion: true,
          beneficios: true, companyId: true,
          company: { select: { name: true } },
          _count: { select: { memberships: true } },
        },
        orderBy: [{ companyId: 'asc' }, { precio: 'asc' }],
      }),
      prisma.company.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ])
    planes = p
    companies = c
  } catch (e) {
    console.error('[superadmin-planes]', e)
  }

  const byCompany = companies.map((c) => ({
    ...c,
    planes: planes.filter((p) => p.companyId === c.id),
  }))

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-foreground">Planes / Promociones</h1>
          <p className="text-muted-foreground">Gestión global de planes por empresa.</p>
        </div>
        <Button asChild>
          <Link href="/superadmin/planes/nuevo">
            <Plus className="mr-2 h-4 w-4" />
            Nuevo plan
          </Link>
        </Button>
      </div>

      {byCompany.map((company) => (
        <section key={company.id} className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground border-b pb-2">{company.name}</h2>
          {company.planes.length === 0 && (
            <p className="text-small text-muted-foreground">Sin planes configurados.</p>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            {company.planes.map((plan) => (
              <Card key={plan.id} className={!plan.activo ? 'opacity-60' : ''}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{plan.nombre}</CardTitle>
                    <div className="flex gap-1">
                      {plan.esIlimitado && (
                        <Badge className="bg-warning/15 text-warning-foreground text-caption">
                          <InfinityIcon className="mr-1 h-3 w-3" />Ilimitado
                        </Badge>
                      )}
                      {!plan.activo && (
                        <Badge variant="secondary" className="text-caption">Inactivo</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-h2 tabular-nums text-foreground">
                    RD${new Intl.NumberFormat('es-DO').format(Number(plan.precio))}
                    <span className="text-small font-normal text-muted-foreground">/mes</span>
                  </p>
                  {!plan.esIlimitado && (
                    <p className="text-caption text-muted-foreground">{plan.lavadosIncluidos} usos incluidos</p>
                  )}
                  {plan.descripcion && (
                    <p className="text-small text-muted-foreground">{plan.descripcion}</p>
                  )}
                  <ul className="space-y-1">
                    {plan.beneficios.map((b) => (
                      <li key={b} className="flex items-start gap-2 text-small text-muted-foreground">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-caption text-muted-foreground">{plan._count.memberships} membresías</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/superadmin/planes/${plan.id}/editar`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                      <PlanPausarBoton planId={plan.id} activo={plan.activo} nombre={plan.nombre} />
                      <DeletePlanButton planId={plan.id} memberships={plan._count.memberships} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
