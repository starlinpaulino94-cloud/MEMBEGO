import { Suspense } from 'react'
import { conEmpresa } from '@/lib/tenant'
import { ScannerClient } from '@/components/scanner/ScannerClient'
import { ScannerErrorBoundary } from '@/components/scanner/ScannerErrorBoundary'
import { VisitasDeHoy } from '@/components/scanner/VisitasDeHoy'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Pantalla completa del escáner (server component compartido por el panel
 * admin y el del empleado — antes eran dos páginas duplicadas).
 *
 * - `empleadoId`: si se pasa, la vista "Hoy" muestra solo las visitas
 *   registradas por ese usuario (caso empleado); sin él, las de la empresa.
 */
export async function ScannerScreen({
  companyId,
  empleadoId,
  puedeConfigurar = false,
}: {
  companyId?: string
  empleadoId?: string
  /** Fase E7: el usuario (admin) puede fijar el modo predeterminado de la empresa. */
  puedeConfigurar?: boolean
}) {
  let sucursales: { id: string; nombre: string }[] = []
  let modoDefault: 'camara' | 'lector' = 'camara'
  try {
    if (companyId) {
      const [suc, company] = await conEmpresa(companyId, (tx) =>
        Promise.all([
          tx.sucursal.findMany({
            where: { companyId, activa: true },
            orderBy: { nombre: 'asc' },
            select: { id: true, nombre: true },
          }),
          tx.company.findUnique({ where: { id: companyId }, select: { escanerModo: true } }),
        ])
      )
      sucursales = suc
      if (company?.escanerModo === 'lector') modoDefault = 'lector'
    }
  } catch (e) {
    console.error('[scanner] datos escáner error:', e)
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="text-h1 text-foreground">Escáner de visitas</h1>
        <p className="mt-1 text-small text-muted-foreground">
          Escanea el QR del cliente para registrar su visita.
        </p>
      </div>

      <ScannerErrorBoundary>
        <ScannerClient sucursales={sucursales} modoDefault={modoDefault} puedeConfigurar={puedeConfigurar} />
      </ScannerErrorBoundary>

      {companyId && (
        <Suspense fallback={<Skeleton className="h-32 w-full rounded-2xl" />}>
          <VisitasDeHoy companyId={companyId} empleadoId={empleadoId} />
        </Suspense>
      )}
    </div>
  )
}
