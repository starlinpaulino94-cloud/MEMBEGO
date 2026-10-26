import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { logErrorBd } from '@/lib/prisma-errors'
import { VerificacionIdentidad } from '@/components/cliente/identidad/VerificacionIdentidad'
import { leerPanelDeIdentidad, type PanelDeIdentidad } from '@/modules/identidad/identidadPuerta'
import { RUTA_PORTAL_PROVEEDOR } from '@/modules/supply-v2/core/catalogo'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Verificación de identidad · Proveedor Membego' }

/**
 * VERIFICACIÓN DE IDENTIDAD de quien trabaja en el portal del proveedor (Fase 5).
 *
 * Membego puede pedirle a la persona que aceptó el contrato del proveedor que verifique su identidad antes de pagarle (es una
 * regla que el equipo enciende, y está apagada de serie). Esta es la misma pantalla que ve un cliente, con el mismo texto y
 * las mismas garantías, pero dentro del portal: la persona la hace por su cuenta, el resultado es de Membego y de ella, y el
 * proveedor (la empresa) no ve nada de lo que se guarda ni de cómo salió. Es SU verificación, no la de la empresa: la sesión
 * dice quién es y no hay forma de ver la de otra persona.
 */
export default async function IdentidadDelPortalPage({ searchParams }: { searchParams: Promise<{ identidad?: string }> }) {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect(RUTA_PORTAL_PROVEEDOR)
  const { identidad } = await searchParams

  let panel: PanelDeIdentidad | null = null
  try {
    panel = await leerPanelDeIdentidad(proveedor.id, { reconciliar: true })
  } catch (e) {
    logErrorBd('supply-identidad', e, { userId: proveedor.id })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Verificación de identidad"
        description="Confirma que eres tú, cuando Membego te lo pida para pagarle a tu empresa."
        eyebrow={
          <Link href={RUTA_PORTAL_PROVEEDOR} className="hover:underline">
            Proveedor Membego
          </Link>
        }
      />
      <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
        Membego puede pedirte esta verificación antes de pagarle a tu empresa, porque aceptaste su contrato. Es tu decisión: si no la haces, ese pago queda a la
        espera, y nada más cambia en tu portal.
      </p>
      {!panel ? (
        <p className="text-muted-foreground">No pudimos cargar tu verificación. Intenta de nuevo más tarde.</p>
      ) : !panel.visible ? (
        <p className="text-muted-foreground">La verificación de identidad no está disponible por ahora.</p>
      ) : (
        <VerificacionIdentidad panel={panel} retorno={identidad === 'retorno'} />
      )}
    </div>
  )
}
