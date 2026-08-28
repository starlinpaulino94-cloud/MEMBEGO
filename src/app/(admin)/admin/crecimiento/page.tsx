import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getGrowthAdminData } from '@/modules/growth/queries'
import { GROWTH_DURACIONES } from '@/modules/growth/config'
import { guardarGrowthConfigAction } from '@/modules/growth/actions'
import { resumirRegla } from '@/modules/growth/reglas'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { ArrowRight, Gift, Share2, Trophy, Users } from 'lucide-react'

export const dynamic = 'force-dynamic'

function Toggle({ name, checked, label }: { name: string; checked: boolean; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <span className="text-foreground">{label}</span>
      <span>
        <input type="hidden" name={name} value="off" />
        <input type="checkbox" name={name} value="on" defaultChecked={checked} className="h-4 w-4" />
      </span>
    </label>
  )
}

export default async function CrecimientoPage() {
  const user = await requireRole(ADMIN_ROLES)
  // Config por empresa: el superadmin usa la empresa ACTIVA del selector.
  const companyId = await resolveCompanyId(user)

  if (!companyId) {
    return <SinEmpresaActiva seccion="tu programa de crecimiento" />
  }

  const { config, rules } = await getGrowthAdminData(companyId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crecimiento"
        description="Todo lo que hace que tus clientes traigan clientes: referidos, invitaciones, premios y las reglas que los reparten."
      />

      {/* HUB (§51) · Las piezas del programa de crecimiento estaban repartidas
          en cuatro módulos sin un sitio que las presentara juntas: se podían
          configurar las reglas sin saber que existe la ruleta, o mirar los
          referidos sin ver qué los premia. Esto no cambia ninguna ruta —cada
          módulo sigue donde estaba— pero por fin hay una pantalla que enseña
          el programa completo. */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            href: '/admin/invitaciones',
            titulo: 'Invita y Gana',
            desc: 'Campañas de invitación y sus enlaces.',
            icon: Share2,
          },
          {
            href: '/admin/referidos',
            titulo: 'Referidos',
            desc: 'Quién trajo a quién y qué se pagó.',
            icon: Users,
          },
          {
            href: '/admin/gamificacion',
            titulo: 'Ruleta de premios',
            desc: 'El juego con el que se reparten.',
            icon: Trophy,
          },
          {
            href: '/admin/crecimiento/recompensas',
            titulo: 'Reglas',
            desc: `${rules.length} ${rules.length === 1 ? 'regla configurada' : 'reglas configuradas'}.`,
            icon: Gift,
          },
        ].map((m) => (
          <li key={m.href}>
            <Link
              href={m.href}
              className="card-interactive flex h-full flex-col gap-1 rounded-xl border border-border bg-card p-4"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <m.icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="mt-2 text-h4 text-foreground">{m.titulo}</span>
              <span className="text-caption">{m.desc}</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Configuración general */}
      <Card>
        <CardHeader>
          <CardTitle className="text-h4">Configuración del programa</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={guardarGrowthConfigAction} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle name="landingActiva" checked={config.landingActiva} label="Mostrar landing antes del registro" />
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="text-foreground">Duración por defecto del enlace</span>
                <select
                  name="duracionHorasDefault"
                  defaultValue={config.duracionHorasDefault}
                  className="rounded-lg border border-border bg-background px-2 py-1"
                >
                  {GROWTH_DURACIONES.map((d) => (
                    <option key={d.horas} value={d.horas}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <Toggle name="premiaClic" checked={config.premiaClic} label="Premiar apertura del enlace" />
              <Toggle name="premiaRegistro" checked={config.premiaRegistro} label="Premiar registro" />
              <Toggle name="premiaMembresia" checked={config.premiaMembresia} label="Premiar membresía" />
              <Toggle name="premiaCompra" checked={config.premiaCompra} label="Premiar compra" />
              <Toggle name="premiaRenovacion" checked={config.premiaRenovacion} label="Premiar renovación" />
            </div>
            <Button type="submit">Guardar configuración</Button>
          </form>
        </CardContent>
      </Card>

      {/* Reglas de recompensa — viven en su propia página desde la Fase 6:
          aquí solo se resumen para no repetir el trabajo en dos sitios. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-h4">Reglas de recompensa</CardTitle>
          <Button asChild variant="secondary" size="sm">
            <Link href="/admin/crecimiento/recompensas">
              Administrar <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no hay reglas. Crea la primera (por ejemplo, «Se registra → 50
              puntos») para que el programa entregue algo.
            </p>
          ) : (
            <ul className="space-y-2">
              {rules.slice(0, 4).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="mr-2 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <Gift className="h-3.5 w-3.5 text-primary" aria-hidden />
                      {r.nombre}
                    </span>
                    <span className="text-xs text-muted-foreground">{resumirRegla(r)}</span>
                  </span>
                  <Badge variant={r.activo ? 'default' : 'secondary'}>
                    {r.activo ? 'Activa' : 'Pausada'}
                  </Badge>
                </li>
              ))}
              {rules.length > 4 && (
                <li className="pt-1 text-xs text-muted-foreground">
                  y {rules.length - 4} más…
                </li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
