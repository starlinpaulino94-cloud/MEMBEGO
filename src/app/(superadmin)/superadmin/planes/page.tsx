export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check, Infinity as InfinityIcon, Plus, Pencil } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DeletePlanButton } from '@/components/admin/DeletePlanButton'
import { PlanPausarBoton } from '@/components/admin/PlanPausarBoton'
import { formatMoney, type RegionalPrefs } from '@/lib/format'
import { sufijoPeriodo, textoVigencia } from '@/modules/planes/periodo'
import { plural } from '@/lib/plural'

export default async function SuperadminPlanesPage() {
  await requireRole('SUPERADMIN')

  let planes: {
    id: string; nombre: string; precio: unknown; esIlimitado: boolean;
    lavadosIncluidos: number; activo: boolean; descripcion: string | null;
    beneficios: string[]; companyId: string; vigenciaDias: number;
    company: { name: string };
    _count: { memberships: number; membershipsSolicitadas: number }
  }[] = []
  let companies: {
    id: string; name: string
    moneda: string | null; idioma: string | null; zonaHoraria: string | null
  }[] = []

  try {
    const [p, c] = await sinEmpresa(
      'planes globales: el superadmin los administra en todas las empresas',
      (tx) => Promise.all([
        tx.plan.findMany({
          select: {
            id: true, nombre: true, precio: true, esIlimitado: true,
            lavadosIncluidos: true, activo: true, descripcion: true,
            beneficios: true, companyId: true, vigenciaDias: true,
            company: { select: { name: true } },
            // Las DOS formas de estar en uso. `membershipsSolicitadas` son los
            // cambios de plan pendientes: también impiden borrar, y antes no se
            // contaban — el botón se veía habilitado y fallaba al pulsarlo.
            _count: { select: { memberships: true, membershipsSolicitadas: true } },
          },
          orderBy: [{ companyId: 'asc' }, { precio: 'asc' }],
        }),
        tx.company.findMany({
          where: { isActive: true },
          orderBy: { name: 'asc' },
          // La moneda viaja CON la empresa, en la misma consulta. Pedirla
          // aparte por empresa (`getRegionalPrefs`) abriría una transacción por
          // cada una para leer tres columnas que ya estaban a mano.
          select: { id: true, name: true, moneda: true, idioma: true, zonaHoraria: true },
        }),
      ])
    )
    planes = p
    companies = c
  } catch (e) {
    console.error('[superadmin-planes]', e)
  }

  const byCompany = companies.map((c) => ({
    ...c,
    planes: planes.filter((p) => p.companyId === c.id),
  }))

  /**
   * Las empresas SIN planes, apartadas.
   *
   * Cada una ocupaba un encabezado y una línea para decir que no tenía nada.
   * Con cuarenta empresas, la pantalla que sirve para revisar precios se
   * convertía en una lista de ausencias por la que hay que hacer scroll. Se
   * dicen todas juntas al final: sigue siendo información —una empresa activa
   * sin planes no puede vender— pero deja de ocupar el sitio de lo que sí hay.
   */
  const conPlanes = byCompany.filter((c) => c.planes.length > 0)
  const sinPlanes = byCompany.filter((c) => c.planes.length === 0)

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

      {conPlanes.map((company) => {
        // Cada empresa formatea su dinero con SU moneda. Esta pantalla es la
        // única que cruza empresas, así que es justo donde el «RD$» escrito a
        // mano se convertía en una cifra de otra divisa mal etiquetada.
        const prefs: RegionalPrefs = {
          moneda: company.moneda,
          idioma: company.idioma,
          zonaHoraria: company.zonaHoraria,
        }
        return (
          <section key={company.id} className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground border-b pb-2">{company.name}</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {company.planes.map((plan) => (
                <Card key={plan.id} className={!plan.activo ? 'opacity-60' : ''}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{plan.nombre}</CardTitle>
                      <div className="flex gap-1">
                        {plan.esIlimitado && (
                          <Badge className="bg-warning/15 text-warning text-caption">
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
                      {formatMoney(Number(plan.precio), prefs)}
                      {/*
                        EL SUFIJO SALE DE LA VIGENCIA, no de una suposición.
                        Estaba escrito «/mes» a mano, siempre: un plan anual
                        salía como «RD$1,600/mes». Y la vigencia real no se
                        enseñaba en ningún sitio, así que no había forma de
                        notar la contradicción — de ahí la línea de abajo.
                      */}
                      <span className="text-small font-normal text-muted-foreground">
                        {sufijoPeriodo(plan.vigenciaDias)}
                      </span>
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {plan.esIlimitado
                        ? 'Usos ilimitados'
                        : plural(plan.lavadosIncluidos, 'uso incluido', 'usos incluidos')}
                      {' · '}
                      {textoVigencia(plan.vigenciaDias)}
                    </p>
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
                      <p className="text-caption text-muted-foreground">
                        {plural(plan._count.memberships, 'membresía', 'membresías')}
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/superadmin/planes/${plan.id}/editar`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                        <PlanPausarBoton planId={plan.id} activo={plan.activo} nombre={plan.nombre} />
                        <DeletePlanButton
                          planId={plan.id}
                          memberships={plan._count.memberships}
                          solicitudes={plan._count.membershipsSolicitadas}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )
      })}

      {sinPlanes.length > 0 && (
        <p className="border-t border-border/50 pt-4 text-small text-muted-foreground">
          <span className="font-medium text-foreground">
            {plural(sinPlanes.length, 'empresa sin planes', 'empresas sin planes')}:
          </span>{' '}
          {sinPlanes.map((c) => c.name).join(', ')}.{' '}
          <Link href="/superadmin/planes/nuevo" className="text-primary hover:underline">
            Crear uno
          </Link>
        </p>
      )}

      {conPlanes.length === 0 && sinPlanes.length === 0 && (
        <p className="text-small text-muted-foreground">No hay empresas activas.</p>
      )}
    </div>
  )
}
