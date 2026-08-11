import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import { Check, Infinity as InfinityIcon, Plus, Pencil, Package, LayoutTemplate } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatMoney } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { DeletePlanButton } from '@/components/admin/DeletePlanButton'
import { PlanPausarBoton } from '@/components/admin/PlanPausarBoton'
import { BienvenidaConfigForm } from '@/components/admin/BienvenidaConfigForm'
import { CompartirOfertaButton } from '@/components/admin/CompartirOfertaButton'

export const dynamic = 'force-dynamic'

export default async function PlanesPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  const prefs = await getRegionalPrefs(companyId)

  // Para compartir la sección de planes del perfil público de la empresa.
  const empresa = companyId
    ? await prisma.company
        .findUnique({ where: { id: companyId }, select: { name: true, slug: true } })
        .catch(() => null)
    : null

  let planes: {
    id: string; nombre: string; precio: unknown; esIlimitado: boolean;
    lavadosIncluidos: number; activo: boolean; descripcion: string | null;
    beneficios: string[]; companyId: string; vigenciaDias: number;
    condiciones: string | null; color: string | null; orden: number;
    company: { name: string }; _count: { memberships: number }
  }[] = []

  // O-13: configuración del beneficio de bienvenida (solo vista por empresa;
  // el superadmin gestiona empresas desde su propio panel).
  let bienvenida: { activa: boolean; tipo: string; valor: number | null } | null = null
  if (companyId) {
    try {
      const company = await conEmpresaOTodas(
        companyId,
        'planes: sin empresa activa es el superadmin, que cruza empresas a propósito',
        (tx) => tx.company.findUnique({
          where: { id: companyId },
          select: { bienvenidaActiva: true, bienvenidaTipo: true, bienvenidaValor: true },
        })
      )
      if (company) {
        bienvenida = {
          activa: company.bienvenidaActiva,
          tipo: company.bienvenidaTipo,
          valor: company.bienvenidaValor == null ? null : Number(company.bienvenidaValor),
        }
      }
    } catch (e) {
      console.error('[admin-planes] bienvenida', e)
    }
  }

  try {
    planes = await conEmpresaOTodas(
      companyId,
      'planes: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => tx.plan.findMany({
        where: companyId ? { companyId } : {},
        select: {
          id: true, nombre: true, precio: true, esIlimitado: true,
          lavadosIncluidos: true, activo: true, descripcion: true,
          beneficios: true, companyId: true, vigenciaDias: true,
          condiciones: true, color: true, orden: true,
          company: { select: { name: true } },
          _count: { select: { memberships: true } },
        },
        orderBy: [{ companyId: 'asc' }, { orden: 'asc' }, { precio: 'asc' }],
      })
    )
  } catch (e) {
    console.error('[admin-planes]', e)
  }

  return (
    <div className="space-y-6">
      {/* §46 · Planes y Membresías se confundían porque sus cabeceras decían
          casi lo mismo. Un plan es el PRODUCTO que la empresa vende; una
          membresía es la instancia que un cliente compró. La descripción lo
          dice explícitamente y cada una enlaza a la otra. */}
      <PageHeader
        eyebrow="Producto"
        title="Planes"
        description="Lo que vendes. Define precio, usos y beneficios; los clientes los compran y se convierten en membresías."
        action={
          <div className="flex items-center gap-2">
            {empresa && (
              <CompartirOfertaButton
                variant="full"
                label="Compartir planes"
                path={`/empresas/${empresa.slug}#membresias`}
                titulo={`Planes de ${empresa.name}`}
                texto={`Conoce los planes de membresía de ${empresa.name} en MembeGo.`}
              />
            )}
            <Link href="/admin/planes/plantillas">
              <Button variant="outline">
                <LayoutTemplate className="mr-2 h-4 w-4" />
                Plantillas
              </Button>
            </Link>
            <Link href="/admin/planes/nuevo">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo plan
              </Button>
            </Link>
          </div>
        }
      />

      {bienvenida && <BienvenidaConfigForm bienvenida={bienvenida} />}

      {planes.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">Aún no tienes planes</p>
            <p className="text-sm">
              Crea tu primer plan (ej. Silver, Gold, Premium) para que los
              clientes puedan afiliarse.
            </p>
            <Link
              href="/admin/planes/plantillas"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              Empieza desde una plantilla →
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          {planes.map((plan) => (
            <Card
              key={plan.id}
              className={`overflow-hidden pt-0 ${plan.activo ? '' : 'opacity-60'}`}
            >
              {/* Franja de color del plan */}
              <div
                className="h-1.5 w-full"
                style={{ backgroundColor: plan.color ?? '#0ea5e9' }}
              />
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: plan.color ?? '#0ea5e9' }}
                    />
                    {plan.nombre}
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    {plan.esIlimitado && (
                      <Badge className="bg-warning/15 text-warning">
                        <InfinityIcon className="mr-1 h-3 w-3" /> Ilimitado
                      </Badge>
                    )}
                    {!plan.activo && <Badge variant="secondary">Inactivo</Badge>}
                  </div>
                </div>
                {companyId === undefined && (
                  <p className="text-sm text-muted-foreground">{plan.company.name}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-2xl font-bold">
                  {formatMoney(Number(plan.precio), prefs)}
                  <span className="text-sm font-normal text-muted-foreground">/mes</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {plan.esIlimitado
                    ? 'Usos ilimitados'
                    : `${plan.lavadosIncluidos} usos`}{' '}
                  · Vigencia {plan.vigenciaDias} días
                </p>
                <ul className="space-y-1.5">
                  {plan.beneficios.map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {b}
                    </li>
                  ))}
                </ul>
                {plan.condiciones && (
                  <p className="text-xs text-muted-foreground">{plan.condiciones}</p>
                )}
                <div className="flex items-center justify-between border-t border-border/60 pt-3">
                  <p className="text-xs text-muted-foreground">
                    {plan._count.memberships} membresías
                  </p>
                  <div className="flex items-center gap-1">
                    <PlanPausarBoton
                      planId={plan.id}
                      activo={plan.activo}
                      nombre={plan.nombre}
                    />
                    <Link href={`/admin/planes/${plan.id}/editar`}>
                      <Button size="icon" variant="ghost" title="Editar" aria-label="Editar">
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </Link>
                    <DeletePlanButton
                      planId={plan.id}
                      memberships={plan._count.memberships}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
