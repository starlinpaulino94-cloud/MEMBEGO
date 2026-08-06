import { requireRole } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { AgregarVehiculoWizard, type TipoVehiculoOpcion } from '@/components/cliente/AgregarVehiculoWizard'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Registra tu vehículo',
  description: 'Agrega tu vehículo para ver los planes y precios de tu categoría',
}

/**
 * Onboarding v2 · REGISTRO DE VEHÍCULO del cliente logueado (Fase 5).
 *
 * El destino de `START_VEHICLE_ONBOARDING`: aquí aterriza quien intentó una
 * acción que exige vehículo (p. ej. ver planes de car wash) sin tenerlo.
 * `?next=` devuelve al cliente exactamente a donde iba.
 */
export default async function NuevoVehiculoPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const user = await requireRole('CLIENTE')
  const { next: nextRaw } = await searchParams
  // Solo rutas internas (evita open redirect), con destino por defecto útil.
  const next =
    nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/cliente/planes'

  const companyId = user.metadata.companyId
  if (!companyId) {
    return (
      <main className="container max-w-lg py-8">
        <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
      </main>
    )
  }

  const tiposVehiculo: TipoVehiculoOpcion[] = await conEmpresa(companyId, (tx) =>
    tx.tipoVehiculo.findMany({
      where: { companyId, activo: true },
      select: { id: true, nombre: true, descripcion: true, iconoUrl: true },
      orderBy: { orden: 'asc' },
    })
  ).catch(() => [])

  if (tiposVehiculo.length === 0) {
    // Sin categorías configuradas no hay asistente que ofrecer: aviso honesto
    // en vez de un paso imposible de completar.
    return (
      <main className="container max-w-lg py-8">
        <p className="text-muted-foreground">
          El negocio aún no configuró sus categorías de vehículo. Inténtalo más tarde.
        </p>
      </main>
    )
  }

  return (
    <main className="container max-w-lg py-8">
      <AgregarVehiculoWizard tiposVehiculo={tiposVehiculo} next={next} />
    </main>
  )
}
