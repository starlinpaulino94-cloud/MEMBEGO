import Link from 'next/link'
import { Cake, Clock, UserX, ShieldCheck, LayoutTemplate } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { EjecutarAutomatizaciones } from '@/components/admin/EjecutarAutomatizaciones'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { StatusBanner } from '@/components/ui/status-banner'

export const dynamic = 'force-dynamic'

const REGLAS: {
  icon: LucideIcon
  chip: string
  titulo: string
  cuando: string
  accion: string
}[] = [
  {
    icon: Cake,
    chip: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
    titulo: 'Cumpleaños',
    cuando: 'El día del cumpleaños del cliente',
    accion: 'Le envía una felicitación invitándolo a revisar tus promociones (una vez al año).',
  },
  {
    icon: Clock,
    chip: 'bg-warning/15 text-warning',
    titulo: 'Membresía por vencer',
    cuando: 'Cuando faltan 7 días o menos para el vencimiento',
    accion: 'Le recuerda renovar para no perder sus beneficios (una vez por vencimiento).',
  },
  {
    icon: UserX,
    chip: 'bg-muted text-foreground',
    titulo: 'Cliente inactivo',
    cuando: 'Cuando un cliente con membresía activa lleva 30 días sin visitas',
    accion: 'Le envía un incentivo para volver (máximo una vez al mes).',
  },
]

export default async function AutomatizacionesPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId

  if (!companyId) {
    return <SinEmpresaActiva seccion="tus automatizaciones" />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automatizaciones"
        description="Avisos automáticos a tus clientes según su actividad. Son idempotentes: nunca se envían dos veces."
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/automatizaciones/plantillas">
                <LayoutTemplate className="mr-2 h-4 w-4" />
                Plantillas
              </Link>
            </Button>
            <EjecutarAutomatizaciones />
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {REGLAS.map((r) => (
          <Card key={r.titulo}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className={`rounded-lg p-2 ${r.chip}`}>
                  <r.icon className="h-4 w-4" />
                </span>
                {r.titulo}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Cuándo:</span>{' '}
                {r.cuando}
              </p>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Qué hace:</span>{' '}
                {r.accion}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <StatusBanner
        variant="success"
        icon={ShieldCheck}
        title="También corren solas todos los días"
      >
        Las reglas se ejecutan automáticamente una vez al día. El botón
        &quot;Ejecutar ahora&quot; solo adelanta el envío de los avisos pendientes.
      </StatusBanner>
    </div>
  )
}
