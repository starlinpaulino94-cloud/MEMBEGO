import Link from 'next/link'
import Form from 'next/form'
import Image from 'next/image'
import {
  Building2,
  Users,
  CheckCircle2,
  Clock,
  ArrowRight,
  Wallet,
  Activity,
  LifeBuoy,
  EyeOff,
  MoonStar,
  FlaskConical,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { StatCard } from '@/components/ui/stat-card'
import { AlertTile } from '@/components/ui/alert-tile'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format'
import { ACCION_LABEL, ENTIDAD_LABEL } from '@/modules/auditoria/queries'
import {
  DIAS_SILENCIO,
  PERIODOS,
  PERIODO_LABEL,
  getPanelPlataforma,
  leerPeriodo,
  type EmpresaPanel,
  type Metrica,
} from '@/modules/superadmin/panel'

export const dynamic = 'force-dynamic'

/** Hora de la actividad. Los defaults del formateador del sistema son los de la
 *  plataforma, que es de quien es este panel. */
function fmtHora(d: Date) {
  return formatDate(d, null, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

/**
 * «hace 2 h» / «hace 23 días». Nunca una fecha suelta: lo que importa aquí no es
 * CUÁNDO fue sino CUÁNTO hace, que es lo que delata a una empresa apagada.
 *
 * Recibe los milisegundos ya medidos, no una fecha: el «ahora» lo fija el módulo
 * de datos una sola vez. Llamar a `Date.now()` aquí sería leer el reloj durante
 * el render —impuro, y el linter lo rechaza— y además daría un instante distinto
 * por cada tarjeta.
 */
function desdeHace(ms: number | null): string {
  if (ms === null) return 'sin actividad'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return 'hace un momento'
  const horas = Math.floor(min / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(horas / 24)
  return `hace ${dias} día${dias === 1 ? '' : 's'}`
}

const money = (n: number) =>
  new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(n)

/**
 * Comparación contra el mismo tramo anterior.
 *
 * Cuando antes no hubo NADA no se pinta un porcentaje: no existe el «infinito
 * por ciento» y un «+100 %» al pasar de 0 a 3 sería una escala inventada. En ese
 * caso se dice que no hay con qué comparar, que es la verdad.
 */
function comparacion(m: Metrica, formato: (n: number) => string = String): string {
  if (m.variacion === null) return m.anterior === 0 ? 'sin periodo previo' : ''
  const signo = m.variacion >= 0 ? '+' : ''
  return `${signo}${m.variacion} % · antes ${formato(m.anterior)}`
}

/** La misma tarjeta para las reales y las de práctica: las distingue el apartado
 *  donde salen y su etiqueta, no un aspecto distinto. */
function TarjetaEmpresa({ c }: { c: EmpresaPanel }) {
  return (
    <Card className="card-interactive border-border/60 shadow-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {c.logoUrl ? (
              <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-border/60">
                <Image src={c.logoUrl} alt="" fill className="object-cover" />
              </span>
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-brand text-overline text-white">
                {c.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <CardTitle className="truncate text-base">{c.name}</CardTitle>
          </div>
          {/* ESTAR ACTIVA Y ESTAR PUBLICADA SON DOS COSAS. Antes compartían un
              solo hueco y la insignia «Inactiva» tapaba si además estaba
              publicada o no, que es lo que hay que arreglar en cada caso. */}
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {c.esDemo && <Badge variant="warning">Demo</Badge>}
            {!c.isActive && <Badge variant="destructive">Inactiva</Badge>}
            {!c.esDemo && (
              <Badge variant={c.isPublished ? 'success' : 'warning'}>
                {c.isPublished ? 'Publicada' : 'Sin publicar'}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* «Planes» salía de aquí: lo repetían las tarjetas de arriba y no
            distinguía una empresa de otra. Lo que sí distingue —y avisa de la
            que se está apagando— es cuánto hace que pasó algo. */}
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { label: 'Clientes', value: String(c.clientes), alerta: false },
            { label: 'Activas', value: String(c.activas), alerta: false },
            { label: 'Actividad', value: desdeHace(c.desdeUltimaActividad), alerta: c.enSilencio },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-muted/40 py-3">
              <p
                className={`tabular-nums ${
                  s.label === 'Actividad'
                    ? `text-small font-semibold ${s.alerta ? 'text-warning' : 'text-foreground'}`
                    : 'text-h2 text-foreground'
                }`}
              >
                {s.value}
              </p>
              <p className="text-caption text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {c.pendientes > 0 && (
          <Link
            href="/superadmin/operaciones"
            className="mt-3 flex items-center justify-end gap-1 text-caption font-medium text-warning hover:underline"
          >
            {c.pendientes} pago{c.pendientes !== 1 ? 's' : ''} pendiente
            {c.pendientes !== 1 ? 's' : ''} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </CardContent>
    </Card>
  )
}

export default async function SuperadminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>
}) {
  await requireRole('SUPERADMIN')
  const periodo = leerPeriodo((await searchParams).dias)
  const d = await getPanelPlataforma(periodo)

  return (
    <div className="space-y-8 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-overline">Plataforma</p>
          <h1 className="text-h1 mt-1 text-foreground">Centro de control</h1>
        </div>
        {/* Selector de periodo. `next/form` = sin JavaScript de cliente: el
            panel entero sigue siendo un componente de servidor. */}
        <Form action="/superadmin/dashboard" className="flex items-center gap-2">
          <label htmlFor="dias" className="sr-only">
            Periodo
          </label>
          <select
            id="dias"
            name="dias"
            defaultValue={String(periodo)}
            className="h-9 rounded-xl border border-input bg-background px-3 text-sm"
          >
            {PERIODOS.map((p) => (
              <option key={p} value={p}>
                {PERIODO_LABEL[p]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-9 rounded-xl border border-input bg-card px-3 text-sm font-medium hover:bg-muted"
          >
            Ver
          </button>
        </Form>
      </div>

      {/*
        EN MÓVIL, LO ACCIONABLE PRIMERO. Las métricas informan; la salud pide
        trabajo. En pantalla ancha caben las dos cosas a la vista y el orden de
        lectura natural es de arriba abajo, así que se conserva; apiladas en un
        teléfono, poner cuatro cifras por delante deja los avisos a un scroll de
        distancia. `order-*` cambia el orden visual sin tocar el del DOM, que es
        el que siguen el teclado y los lectores de pantalla.
      */}
      <div className="flex flex-col gap-8">
        <section className="order-2 lg:order-1">
          <h2 className="sr-only">Métricas de la plataforma</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard
              label="Empresas"
              value={d.totalEmpresas}
              icon={Building2}
              accent="brand"
              href="/superadmin/empresas"
              hrefLabel="ver todas las empresas"
              sub={d.demos.length > 0 ? `+${d.demos.length} de práctica` : undefined}
            />
            <StatCard
              label="Clientes totales"
              value={d.totalClientes}
              icon={Users}
              accent="brand"
              href="/superadmin/usuarios"
              hrefLabel="ver los usuarios"
              sub={`+${d.nuevos.valor} en el periodo · ${comparacion(d.nuevos)}`}
            />
            <StatCard
              label="Membresías activas"
              value={d.totalActivas}
              icon={CheckCircle2}
              accent="success"
              href="/superadmin/membresias"
              hrefLabel="ver las membresías"
            />
            {/* El dinero faltaba por completo: un centro de control de una
                plataforma sin lo cobrado no contesta la primera pregunta que se
                hace quien la opera. Misma definición que usan el Resumen de la
                empresa y Reportes (`modules/pagos/cobrado.ts`). */}
            <StatCard
              label="Cobrado"
              value={money(d.cobrado.valor)}
              icon={Wallet}
              accent="brand"
              href="/superadmin/reportes"
              hrefLabel="ver los reportes"
              sub={comparacion(d.cobrado, money) || PERIODO_LABEL[periodo]}
            />
          </div>
        </section>

        <section className="order-1 lg:order-2">
          <h2 className="text-h4 mb-3 text-foreground">Salud de la plataforma</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <AlertTile
              label="Pagos por validar"
              value={d.porValidar}
              href="/superadmin/operaciones"
              icon={Clock}
              tono="warning"
            />
            <AlertTile
              label="Empresas sin publicar"
              value={d.sinPublicar}
              href="/superadmin/empresas"
              icon={EyeOff}
              tono="info"
            />
            <AlertTile
              label="Empresas en silencio"
              value={d.enSilencio}
              href="/superadmin/empresas"
              icon={MoonStar}
              tono="warning"
              sufijo={`sin actividad en ${DIAS_SILENCIO} días`}
            />
            <AlertTile
              label="Tickets abiertos"
              value={d.ticketsAbiertos}
              href="/superadmin/tickets"
              icon={LifeBuoy}
              tono="danger"
            />
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-h4 text-foreground">Empresas</h2>
            <Link
              href="/superadmin/empresas"
              className="inline-flex items-center gap-1 text-small font-medium text-primary hover:underline"
            >
              Administrar <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {d.empresas.map((c) => (
              <TarjetaEmpresa key={c.id} c={c} />
            ))}
          </div>

          {/* Las de práctica siguen a la vista: una empresa demo que no se ve es
              una que alguien deja encendida y olvida. Pero sin encabezado con
              enlace propio cuando es una sola — era más cabecera que contenido. */}
          {d.demos.length > 0 && (
            <div className="mt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-h4 flex items-center gap-2 text-foreground">
                  <FlaskConical aria-hidden className="h-4 w-4 text-warning" />
                  De demostración
                </h2>
                <Link
                  href="/superadmin/demo"
                  className="inline-flex items-center gap-1 text-small font-medium text-primary hover:underline"
                >
                  Administrar <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <p className="mb-3 text-caption text-muted-foreground">
                Para entrenar al personal. Sus clientes, cobros y números no cuentan en ninguna
                cifra de esta pantalla.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {d.demos.map((c) => (
                  <TarjetaEmpresa key={c.id} c={c} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-h4 text-foreground">Actividad reciente</h2>
            <Link
              href="/superadmin/auditoria"
              className="inline-flex items-center gap-1 text-small font-medium text-primary hover:underline"
            >
              Ver todo <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <Card className="border-border/60 shadow-card">
            <CardContent className="pt-5">
              {d.actividad.length === 0 ? (
                <p className="py-6 text-center text-small text-muted-foreground">
                  La actividad de todas las empresas aparecerá aquí.
                </p>
              ) : (
                <ul className="divide-y divide-border/50">
                  {d.actividad.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Activity aria-hidden className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">
                          {/* El mapa CANÓNICO de la bitácora, no una copia local
                              a la que le faltaban entradas: por eso esta lista
                              enseñaba «CUENTA_ELIMINADA» en crudo. */}
                          {ACCION_LABEL[a.accion] ?? a.accion}
                        </p>
                        <p className="truncate text-caption text-muted-foreground">
                          {/* `entidadTipo` ya se consultaba y no se pintaba: la
                              lista decía QUÉ pasó pero no A QUÉ. */}
                          {[
                            a.entidadTipo ? (ENTIDAD_LABEL[a.entidadTipo] ?? a.entidadTipo) : null,
                            a.empresa ?? 'Plataforma',
                            a.autor,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <span className="shrink-0 text-caption text-muted-foreground/70">
                        {fmtHora(a.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
