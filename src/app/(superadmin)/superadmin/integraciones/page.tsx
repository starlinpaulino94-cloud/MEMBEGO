import { requireRole } from '@/lib/auth/guards'
import { plural } from '@/lib/plural'
import { getPanelIntegraciones } from '@/modules/integraciones/panel'
import { anclaSistema } from '@/modules/integraciones/diagnostico'
import { saludDeLaCola, trabajosMuertosPendientes } from '@/modules/jobs/muertos'
import { SistemaConectadoCard } from '@/components/superadmin/SistemaConectadoCard'
import { ColaTrabajosCard } from '@/components/superadmin/ColaTrabajosCard'
import { TabsIntegracionesPlataforma } from '@/components/superadmin/TabsIntegracionesPlataforma'
import { PageHeader } from '@/components/ui/page-header'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusChip } from '@/components/ui/status-chip'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Activity,
  ChevronRight,
  CircleCheck,
  Inbox,
  Plug,
  TriangleAlert,
} from 'lucide-react'
import { StatCard } from '@/components/ui/stat-card'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Salud de las integraciones' }

/**
 * Salud de los sistemas satélite conectados y de la cola (ver
 * docs/INTEGRACIONES.md; rediseño «hub»: pestaña Salud).
 *
 * POR QUÉ ES UNA PÁGINA Y NO SOLO EL CRON: cuando el webhook de un satélite
 * empieza a fallar, la cola crece en silencio y solo se nota consultando la
 * base a mano. Peor: el error guardado es un código HTTP pelado, que no dice
 * si el problema es del dominio, de la ruta o del secreto. Esta pantalla toca
 * la URL desde el servidor, enseña la respuesta cruda y permite reenviar sin
 * esperar al cron diario — que es lo único que faltaba para cerrar el ciclo
 * de «ellos arreglan, nosotros comprobamos» en minutos y no en días.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO SE PINTA
 *
 * El diseño de referencia lleva «tasa de disponibilidad 99.9 %», «latencia
 * media 42 ms» y una barra de 30 días por proveedor. MembeGo no mide nada de
 * eso. Los cuatro números de arriba son los que la cola sí sabe; el semáforo
 * de la cabecera sale de ellos y no de una constante.
 */
export default async function IntegracionesPage() {
  await requireRole('SUPERADMIN')
  const [sistemas, salud, difuntos] = await Promise.all([
    getPanelIntegraciones(),
    saludDeLaCola(),
    trabajosMuertosPendientes(),
  ])

  const atascados = sistemas.filter((s) => s.pendientes > 0)

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
  const activos = sistemas.filter((x) => x.estado === 'ACTIVE').length

  // El semáforo de la cabecera: hay algo que mirar si un sistema no recibe sus
  // eventos o si la cola agotó reintentos. Nada más entra en la cuenta.
  const conIncidencias = atascados.length > 0 || salud.webhooksMuertos > 0
  const pendientesDeAtencion = atascados.length + salud.webhooksMuertos

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salud de las integraciones"
        description="Estado operativo de los sistemas satélite conectados y de la cola de eventos."
        action={
          <StatusChip tone={conIncidencias ? 'warning' : 'success'} pulso={!conIncidencias}>
            {conIncidencias ? 'Con incidencias' : 'Sistema operativo'}
          </StatusChip>
        }
        nav={
          <TabsIntegracionesPlataforma
            activa="salud"
            badges={pendientesDeAtencion > 0 ? { salud: pendientesDeAtencion } : undefined}
          />
        }
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
          value={sistemas.length}
          sub={`${activos} activos`}
          icon={Activity}
          accent="brand"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* LO QUE PIDE ATENCIÓN, primero y con nombre. El aviso decía «2
              sistemas» y ahí se acababa: con varios satélites conectados había
              que bajar leyendo tarjetas una por una hasta dar con los que
              fallan. Cada entrada lleva a su tarjeta. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-h3">Conexiones que requieren atención</CardTitle>
            </CardHeader>
            <CardContent>
              {atascados.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                    <CircleCheck className="h-6 w-6 text-success" aria-hidden />
                  </span>
                  <p className="text-h4 font-semibold">Todos los sistemas reciben sus eventos</p>
                  <p className="max-w-md text-caption text-muted-foreground">
                    No hay ningún satélite con eventos pendientes de entrega en este momento.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
                  {atascados.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${anclaSistema(s.slug)}`}
                        className="flex items-center gap-3 px-4 py-3 outline-none transition-colors duration-fast hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                          <Plug className="h-5 w-5 text-muted-foreground" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{s.nombre}</span>
                          <span className="block text-caption text-muted-foreground">
                            {plural(s.pendientes, 'evento pendiente', 'eventos pendientes')} de
                            entrega
                          </span>
                        </span>
                        <StatusChip tone="warning">No recibe</StatusChip>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {atascados.length > 0 && (
                <p className="mt-3 text-caption text-muted-foreground">
                  Los eventos no se pierden: quedan en cola y se reintentan una vez al día, hasta 8
                  veces. Usa «Probar el webhook» para ver qué responde el otro sistema y a quién le
                  toca arreglarlo.
                </p>
              )}
            </CardContent>
          </Card>

          <SectionHeader
            title="Sistemas conectados"
            description="Cada satélite con su cola, la sonda de su webhook y el reenvío forzado."
          />
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
        </div>

        {/* Fase 2 de Connect: la salud de TODO el procesamiento asíncrono en un
            vistazo, y los trabajos que QStash agotó — antes desaparecían sin
            que ninguna pantalla lo supiera. */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <ColaTrabajosCard salud={salud} difuntos={difuntos} />
        </div>
      </div>

      <p className="text-caption text-muted-foreground">
        La prueba envía un evento <span className="font-mono">membego.ping</span>, que no forma
        parte del catálogo real: un satélite bien implementado lo ignora y responde 200, así que
        probar nunca ensucia sus datos.
      </p>
    </div>
  )
}
