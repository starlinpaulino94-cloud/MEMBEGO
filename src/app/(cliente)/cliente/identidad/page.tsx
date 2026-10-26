import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { logErrorBd } from '@/lib/prisma-errors'
import { VerificacionIdentidad } from '@/components/cliente/identidad/VerificacionIdentidad'
import { leerPanelDeIdentidad, type PanelDeIdentidad } from '@/modules/identidad/identidadPuerta'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Verificación de identidad' }

/**
 * VERIFICACIÓN DE IDENTIDAD de la persona (Fase 3): su estado, cómo funciona, qué hacemos
 * con sus datos, el consentimiento, empezar, el resultado, reintentar y reportar problemas.
 *
 * Es de la PERSONA, no de un negocio: la sesión dice quién es (`dbUserId`) y no hay forma
 * de pedir la de otra. Si la verificación está apagada y la persona no tiene nada guardado,
 * la sección no se anuncia. Al volver del proveedor (`?identidad=retorno`) la pantalla
 * pregunta el estado sin esperar. El servidor decide todo; la pantalla pinta.
 */
export default async function IdentidadPage({ searchParams }: { searchParams: Promise<{ identidad?: string }> }) {
  const user = await requireRole('CLIENTE')
  const { identidad } = await searchParams

  let panel: PanelDeIdentidad | null = null
  if (user.metadata.dbUserId) {
    try {
      panel = await leerPanelDeIdentidad(user.metadata.dbUserId, { reconciliar: true })
    } catch (e) {
      logErrorBd('cliente-identidad', e, { userId: user.metadata.dbUserId })
    }
  }

  return (
    <div className="space-y-5 animate-fade-up">
      <section className="flex items-center gap-2">
        <Link
          href="/cliente/ajustes"
          aria-label="Volver a Configuración"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors duration-fast hover:bg-retail-mist hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="text-h2 text-foreground">Verificación de identidad</h1>
          <p className="text-small text-muted-foreground">Confirma que eres tú, cuando quieras.</p>
        </div>
      </section>

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
