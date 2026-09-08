import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sin empresa activa' }

export default async function SinEmpresaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const esSuperadmin = user.metadata.role === 'SUPERADMIN'

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader
        title="Sin empresa activa"
        description="Tu sesión no tiene una empresa de trabajo asignada."
      />
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        <p className="flex items-start gap-2">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          {esSuperadmin
            ? 'Selecciona una empresa en el panel de plataforma para operar sobre ella. El panel de empresa nunca muestra datos globales.'
            : 'Pide a un administrador que vincule tu cuenta a una empresa. Por seguridad, sin empresa activa no se muestra ningún dato.'}
        </p>
      </div>
      <Button asChild>
        <Link href={esSuperadmin ? '/superadmin/empresas' : '/login'}>
          {esSuperadmin ? 'Ir a empresas' : 'Volver al acceso'}
        </Link>
      </Button>
    </div>
  )
}
