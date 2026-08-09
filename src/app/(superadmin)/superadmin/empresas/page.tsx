import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { listEmpresas } from '@/modules/empresas/queries'
import { EmpresasCRM } from '@/components/superadmin/EmpresasCRM'
import { buttonVariants } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default async function SuperadminEmpresas() {
  await requireRole('SUPERADMIN')

  let raw: Awaited<ReturnType<typeof listEmpresas>> = []
  try {
    raw = await listEmpresas()
  } catch (e) {
    console.error('[superadmin-empresas]', e)
  }

  const empresas = raw.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    type: c.type,
    description: c.description,
    logoUrl: c.logoUrl,
    email: c.email,
    telefono: c.telefono,
    direccion: c.direccion,
    ciudad: c.ciudad,
    categoria: c.categoria,
    website: c.website,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    clientes: c._count.clientes,
    users: c._count.users,
    sucursales: c._count.sucursales,
    plans: c._count.plans,
    promociones: c._count.promociones,
    membresiaActivas: c._membresiaActivas,
    ingresos: c._ingresos,
    ultimaActividad: c._ultimaActividad?.toISOString() ?? null,
  }))

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-h1 text-foreground">Empresas</h1>
          <p className="text-small text-muted-foreground">
            CRM de empresas registradas en la plataforma
          </p>
        </div>
        <Link href="/superadmin/empresas/nueva" className={buttonVariants()}>
          <Plus className="mr-2 h-4 w-4" /> Nueva empresa
        </Link>
      </div>
      <EmpresasCRM empresas={empresas} />
    </div>
  )
}
