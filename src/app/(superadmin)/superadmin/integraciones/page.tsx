import { requireRole } from '@/lib/auth/guards'
import { getPanelIntegraciones } from '@/modules/integraciones/panel'
import { SistemaConectadoCard } from '@/components/superadmin/SistemaConectadoCard'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { EmptyState } from '@/components/ui/empty-state'
import { Plug } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Integraciones' }

/**
 * Panel de sistemas satélite conectados (ver docs/INTEGRACIONES.md).
 *
 * POR QUÉ ES UNA PÁGINA Y NO SOLO EL CRON: cuando el webhook de un satélite
 * empieza a fallar, la cola crece en silencio y solo se nota consultando la
 * base a mano. Peor: el error guardado es un código HTTP pelado, que no dice
 * si el problema es del dominio, de la ruta o del secreto. Esta pantalla toca
 * la URL desde el servidor, enseña la respuesta cruda y permite reenviar sin
 * esperar al cron diario — que es lo único que faltaba para cerrar el ciclo
 * de «ellos arreglan, nosotros comprobamos» en minutos y no en días.
 */
export default async function IntegracionesPage() {
  await requireRole('SUPERADMIN')
  const sistemas = await getPanelIntegraciones()

  const atascados = sistemas.filter((s) => s.pendientes > 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integraciones"
        description="Sistemas satélite conectados a MembeGo y estado de la cola de eventos."
      />

      {atascados.length > 0 && (
        <StatusBanner
          variant="warning"
          title={`${atascados.length === 1 ? 'Un sistema no está recibiendo' : `${atascados.length} sistemas no están recibiendo`} sus eventos`}
        >
          Los eventos no se pierden: quedan en cola y se reintentan una vez al día, hasta 8 veces.
          Usa «Probar el webhook» para ver qué responde el otro sistema y a quién le toca
          arreglarlo.
        </StatusBanner>
      )}

      {sistemas.length === 0 ? (
        <EmptyState
          icon={<Plug className="h-6 w-6" aria-hidden />}
          title="No hay sistemas conectados"
          description="Los sistemas satélite se registran en la tabla sistemas_conectados. Ver docs/INTEGRACIONES.md."
        />
      ) : (
        <div className="space-y-4">
          {sistemas.map((s) => (
            <SistemaConectadoCard key={s.id} sistema={s} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        La prueba envía un evento <span className="font-mono">membego.ping</span>, que no forma
        parte del catálogo real: un satélite bien implementado lo ignora y responde 200, así que
        probar nunca ensucia sus datos.
      </p>
    </div>
  )
}
