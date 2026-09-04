import { requireRole } from '@/lib/auth/guards'
import { plural } from '@/lib/plural'
import { getPanelIntegraciones } from '@/modules/integraciones/panel'
import { anclaSistema } from '@/modules/integraciones/diagnostico'
import { saludDeLaCola, trabajosMuertosPendientes } from '@/modules/jobs/muertos'
import { SistemaConectadoCard } from '@/components/superadmin/SistemaConectadoCard'
import { ColaTrabajosCard } from '@/components/superadmin/ColaTrabajosCard'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { EmptyState } from '@/components/ui/empty-state'
import { Activity, CircleCheck, Inbox, Plug, TriangleAlert } from 'lucide-react'
import { StatCard } from '@/components/ui/stat-card'

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
  const [sistemas, salud, difuntos] = await Promise.all([
    getPanelIntegraciones(),
    saludDeLaCola(),
    trabajosMuertosPendientes(),
  ])

  /**
   * UN SISTEMA RETIRADO NO ES UN SISTEMA CONECTADO.
   *
   * `RETIRED` significa que ese satélite ya no está en servicio, pero la fila
   * se conserva: su historial de eventos es auditoría y su `slug` no debe
   * reutilizarse. El problema era enseñarlo en la MISMA lista que los vivos,
   * con los mismos botones —«Probar el webhook», «Reenviar ahora»— que contra
   * un satélite retirado no pueden hacer otra cosa que fallar.
   *
   * El efecto medido: dos tarjetas de Car Wash, una apuntando a una URL de
   * ejemplo, y nadie sabía cuál era la de verdad.
   *
   * Se separan. Los retirados siguen siendo visibles —esconderlos sería
   * mentir sobre lo que hay en la base— pero como una línea, no como una
   * tarjeta operable.
   */
  const vivos = sistemas.filter((s) => s.estado !== 'RETIRED')
  const retirados = sistemas.filter((s) => s.estado === 'RETIRED')

  const atascados = vivos.filter((s) => s.pendientes > 0)

  /**
   * LOS CUATRO NÚMEROS DE ARRIBA, Y DE DÓNDE SALE CADA UNO.
   *
   * Todos de `saludDeLaCola()` y de los totales por sistema que ya trae
   * `getPanelIntegraciones()`: cero consultas nuevas y cero estimaciones.
   *
   * La TASA DE ENTREGA se calcula sobre eventos realmente despachados
   * (enviados + fallidos). Cuando no se ha despachado ninguno se muestra «—» y
   * no «100 %»: sin denominador no hay porcentaje, y un 100 % sobre cero
   * eventos es la clase de número que tranquiliza sin motivo.
   */
  const enviados = sistemas.reduce((n, x) => n + x.enviados, 0)
  const fallidos = sistemas.reduce((n, x) => n + x.fallidos, 0)
  const despachados = enviados + fallidos
  const tasaEntrega =
    despachados > 0 ? `${((enviados / despachados) * 100).toFixed(1)}%` : '—'
  const activos = vivos.filter((x) => x.estado === 'ACTIVE').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integraciones"
        description="Sistemas satélite conectados a MembeGo y estado de la cola de eventos."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Tasa de entrega"
          value={tasaEntrega}
          sub={
            despachados > 0
              ? `Sobre ${despachados} eventos despachados`
              : 'Todavía no se ha despachado ninguno'
          }
          icon={CircleCheck}
          accent={fallidos > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Eventos en cola"
          value={salud.webhooksPendientes}
          sub="Esperando su reintento"
          icon={Inbox}
          accent={salud.webhooksPendientes > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Eventos agotados"
          value={salud.webhooksMuertos}
          sub="Sin más reintentos: hay que mirarlos"
          icon={TriangleAlert}
          accent={salud.webhooksMuertos > 0 ? 'danger' : 'success'}
        />
        <StatCard
          label="Sistemas conectados"
          value={vivos.length}
          sub={plural(activos, 'activo', 'activos')}
          icon={Activity}
          accent="brand"
        />
      </div>

      {/* Fase 2 de Connect: la salud de TODO el procesamiento asíncrono en un
          vistazo, y los trabajos que QStash agotó — antes desaparecían sin que
          ninguna pantalla lo supiera. */}
      <ColaTrabajosCard salud={salud} difuntos={difuntos} />

      {atascados.length > 0 && (
        <StatusBanner
          variant="warning"
          title={`${plural(atascados.length, 'sistema no está recibiendo', 'sistemas no están recibiendo')} sus eventos`}
        >
          {/* CUÁLES. El aviso decía «2 sistemas» y ahí se acababa: con varios
              satélites conectados había que bajar leyendo tarjetas una por una
              hasta dar con los que fallan. */}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {atascados.map((s) => (
              <a
                key={s.id}
                href={`#${anclaSistema(s.slug)}`}
                className="font-medium underline underline-offset-2"
              >
                {s.nombre} ({plural(s.pendientes, 'pendiente', 'pendientes')})
              </a>
            ))}
          </span>
          <span className="mt-2 block">
            Los eventos no se pierden: quedan en cola y se reintentan una vez al día, hasta 8
            veces. Usa «Probar el webhook» para ver qué responde el otro sistema y a quién le toca
            arreglarlo.
          </span>
        </StatusBanner>
      )}

      {vivos.length === 0 ? (
        <EmptyState
          icon={<Plug className="h-6 w-6" aria-hidden />}
          title="No hay sistemas conectados"
          description="Los sistemas satélite se registran en la tabla sistemas_conectados. Ver docs/INTEGRACIONES.md."
        />
      ) : (
        <div className="space-y-4">
          {vivos.map((s) => (
            <SistemaConectadoCard key={s.id} sistema={s} />
          ))}
        </div>
      )}

      {retirados.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-small font-medium text-foreground">
            {plural(retirados.length, 'sistema retirado', 'sistemas retirados')}
          </p>
          <p className="mt-1 text-caption text-muted-foreground">
            Fuera de servicio. Su fila se conserva por el historial y para que su identificador no
            se reutilice, pero ya no recibe eventos.
          </p>
          <ul className="mt-3 space-y-1">
            {retirados.map((s) => (
              <li key={s.id} className="text-small text-muted-foreground">
                {s.nombre} <span className="font-mono text-caption">({s.slug})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-caption text-muted-foreground">
        La prueba envía un evento <span className="font-mono">membego.ping</span>, que no forma
        parte del catálogo real: un satélite bien implementado lo ignora y responde 200, así que
        probar nunca ensucia sus datos.
      </p>
    </div>
  )
}
