import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import { ArrowLeft } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getTiposVehiculo, getServicios, getBahias } from '@/modules/carwash/catalogo'
import { CatalogoPanel } from '@/components/carwash/CatalogoPanel'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Catálogo · Car Wash' }

/**
 * Configuración del catálogo del oficio (App Car Wash · Fase 1): tipos de
 * vehículo, servicios con tarifa por tipo, y bahías.
 *
 * Tolerante a que la migración 20260762 no esté aplicada: en ese caso muestra
 * el aviso en vez de una pantalla rota.
 */
export default async function CatalogoCarWashPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user) ?? user.metadata.companyId ?? null
  if (!companyId) return <SinEmpresaActiva seccion="el catálogo de la pista" />

  // Los tres `getX` abren su PROPIA transacción con su contexto de empresa, así
  // que van fuera del envoltorio: anidarlos pediría una segunda conexión desde
  // dentro de una transacción abierta, que con el pooler es como se agota el
  // pool. Solo se envuelve la consulta que de verdad usa Prisma aquí.
  const datos = await Promise.all([
    getTiposVehiculo(companyId),
    getServicios(companyId),
    getBahias(companyId),
    conEmpresaOTodas(
      companyId,
      'app · carwash · catalogo: sin empresa activa es el superadmin',
      (tx) =>
        tx.sucursal.findMany({
          where: { companyId },
          orderBy: { nombre: 'asc' },
          select: { id: true, nombre: true },
        })
    ),
  ]).catch(() => null)

  return (
    <div className="space-y-6">
      <Link
        href="/admin/app/carwash"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Car Wash
      </Link>

      <PageHeader
        title="Catálogo de la pista"
        description="Qué vendes, a qué precio según el vehículo, y en qué puestos se trabaja."
      />

      {datos === null ? (
        <p className="rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm text-foreground">
          No se pudo cargar el catálogo. Si acabas de instalar esta versión, corre la
          migración <b>20260762_carwash_fase1</b> en la base de datos.
        </p>
      ) : (
        <CatalogoPanel
          tipos={datos[0]}
          servicios={datos[1]}
          bahias={datos[2]}
          sucursales={datos[3]}
        />
      )}
    </div>
  )
}
