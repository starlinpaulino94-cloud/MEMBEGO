import Link from 'next/link'
import { FlaskConical, Plus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { getAppUrl } from '@/lib/site'
import { getEmpresasDemo, contarDatosDemo } from '@/modules/demo'
import { DemoPanel, type EmpresaDemoUI } from '@/components/superadmin/DemoPanel'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default async function SuperadminDemoPage() {
  await requireRole('SUPERADMIN')

  const empresas = await getEmpresasDemo(getAppUrl())
  // El inventario de cada una en paralelo: se enseña ANTES de que alguien
  // apriete "Reiniciar", no después.
  const conDatos: EmpresaDemoUI[] = await Promise.all(
    empresas.map(async (e) => ({
      id: e.id,
      name: e.name,
      slug: e.slug,
      clientes: e.clientes,
      enlaceRegistro: e.enlaceRegistro,
      inventario: await contarDatosDemo(e.id),
    }))
  )

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-overline">Plataforma</p>
          <h1 className="text-h1 mt-1 flex items-center gap-2 text-foreground">
            <FlaskConical className="h-6 w-6 text-amber-500" />
            Empresas de demostración
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Empresas para entrenar al personal. Por dentro funcionan exactamente igual que una
            real —registro de clientes, membresías, QR, pista, caja, reportes— porque si se
            comportaran distinto, el entrenamiento enseñaría un sistema que no es el que van a
            usar. Hacia afuera no existen: no cobran con tarjeta, no envían correos, no aparecen
            en el directorio público y sus números no cuentan en las estadísticas.
          </p>
        </div>
        <Button asChild>
          <Link href="/superadmin/demo/nueva">
            <Plus className="mr-2 h-4 w-4" /> Nueva empresa de práctica
          </Link>
        </Button>
      </div>

      <DemoPanel empresas={conDatos} />
    </div>
  )
}
