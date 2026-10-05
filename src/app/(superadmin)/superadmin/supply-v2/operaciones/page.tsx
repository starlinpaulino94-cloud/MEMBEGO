import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { Cifra, Edad, Estado, EstadoConfigChip, Momento, Severidad, Tabla } from '@/components/supply-v2/operaciones/piezas'
import { ConciliarAPeticion, EvaluarAlertas, Interruptor, ReconocerAlerta } from '@/components/supply-v2/operaciones/acciones'
import { resumenOperativo } from '@/modules/supply-v2/operations/salud'
import { alertasEnPanel } from '@/modules/supply-v2/operations/alertas'
import { estadoDeCapacidades } from '@/modules/supply-v2/operations/flags'
import { conteoInboxPorEstado, conteoOutboxPorEstado, difuntosDeLaCola } from '@/modules/supply-v2/operations/panel-queries'
import { RUTA_OPERACIONES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Operaciones · Supply 2.0' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 4 · CENTRO DE OPERACIONES (§3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PREGUNTA QUE ESTA PÁGINA CONTESTA
 *
 * ¿Qué está pasando, sin abrir PostgreSQL?
 *
 * No es un tablero comercial: no hay GMV ni margen. Hay nueve preguntas
 * operativas —¿hay integraciones caídas? ¿incidentes abiertos? ¿outbox
 * atrasado? ¿difuntos? ¿discrepancias? ¿trabajos fallando? ¿falta
 * configuración? ¿se puede seguir aceptando pagos? ¿qué pasó con esta
 * compra?— y cada una se contesta con un dato de la base.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NINGÚN «SANO» POR EXISTIR
 *
 * Cada estado sale de una cifra comparada con un umbral que alguien decidió y
 * que se puede mover sin tocar código. Si la base no responde, se dice; no se
 * pintan ceros, porque un cero inventado se lee como «todo en orden» justo
 * cuando nada lo está.
 */
export default async function OperacionesPage() {
  await requireRole('SUPERADMIN')

  const [resumen, alertas, capacidades, outboxPorEstado, inboxPorEstado, difuntosCola] = await Promise.all([
    resumenOperativo(),
    alertasEnPanel(),
    estadoDeCapacidades(),
    conteoOutboxPorEstado(),
    conteoInboxPorEstado(),
    difuntosDeLaCola(5),
  ])
  const c = resumen.cifras

  return (
    <div className="space-y-5">
      <PageHeader
        title="Centro de Operaciones"
        description="Si Supply 2.0 está sano, qué está atascado y qué pasó con una operación concreta. Cada cifra sale de la base."
        eyebrow="Supply 2.0 · Slice 9"
        nav={<NavSupplyV2 activa="" />}
        action={
          <div className="flex items-center gap-2">
            <Estado valor={resumen.estado} testid="estado-sistema" />
            <EvaluarAlertas />
          </div>
        }
      />

      {!resumen.baseViva && (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardContent className="py-3 text-sm">
            <strong>La base de datos no responde.</strong> Las cifras de abajo no se pudieron medir: lo que se ve no es
            «todo en cero», es «no se sabe».
          </CardContent>
        </Card>
      )}

      {/* ── Búsqueda operativa: lo primero, porque es lo que más se usa ── */}
      <Card>
        <CardContent className="py-3">
          <form action={`${RUTA_OPERACIONES}/buscar`} className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="q" className="text-xs uppercase tracking-wide text-muted-foreground">
                Buscar una operación
              </label>
              <Input
                id="q"
                name="q"
                placeholder="MBG-SO-000123 · sv2-… · TX-… · evt_… · o un id"
                data-testid="buscar-operacion"
              />
            </div>
            <Button type="submit" data-testid="btn-buscar">
              Buscar
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ── Estado del sistema ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Estado del sistema</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {resumen.componentes.map((comp) => (
            <div
              key={comp.clave}
              data-testid={`componente-${comp.clave}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-1.5 last:border-0"
            >
              <Estado valor={comp.estado} testid={`estado-${comp.clave}`} />
              <span className="font-medium">{comp.etiqueta}</span>
              <span className="min-w-0 flex-1 text-sm text-muted-foreground">{comp.detalle}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Las cifras ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Cifra etiqueta="Incidentes abiertos" valor={c.incidentesAbiertos} href={`${RUTA_OPERACIONES}/incidentes`} alerta={c.incidentesAbiertos > 0} testid="cifra-incidentes" />
        <Cifra etiqueta="Severidad alta" valor={c.incidentesAltos} href={`${RUTA_OPERACIONES}/incidentes?severity=HIGH`} alerta={c.incidentesAltos > 0} testid="cifra-incidentes-altos" />
        <Cifra etiqueta="Discrepancias" valor={c.discrepancias} href={`${RUTA_OPERACIONES}/conciliaciones?outcome=MISMATCH`} alerta={c.discrepancias > 0} testid="cifra-discrepancias" />
        <Cifra etiqueta="Outbox pendiente" valor={c.outboxPendiente} href={`${RUTA_OPERACIONES}/outbox?status=PENDING`} alerta={c.outboxPendiente > 0} testid="cifra-outbox" />
        <Cifra
          etiqueta="Más viejo"
          valor={c.outboxMasViejoMin == null ? '—' : `${c.outboxMasViejoMin} min`}
          alerta={c.outboxMasViejoMin != null && c.outboxMasViejoMin >= resumen.umbrales.outboxPendienteAviso}
          testid="cifra-outbox-viejo"
        />
        <Cifra etiqueta="Efectos sin salida" valor={c.outboxMuertos} href={`${RUTA_OPERACIONES}/difuntos`} alerta={c.outboxMuertos > 0} testid="cifra-outbox-muertos" />
        <Cifra etiqueta="Eventos fallidos" valor={c.eventosFallidos} href={`${RUTA_OPERACIONES}/inbox?status=FAILED`} alerta={c.eventosFallidos > 0} testid="cifra-eventos-fallidos" />
        <Cifra etiqueta="Eventos sin salida" valor={c.eventosMuertos} href={`${RUTA_OPERACIONES}/inbox?status=DEAD_LETTER`} alerta={c.eventosMuertos > 0} testid="cifra-eventos-muertos" />
        <Cifra etiqueta="Trabajos difuntos" valor={c.difuntosDeCola} href={`${RUTA_OPERACIONES}/difuntos`} alerta={c.difuntosDeCola > 0} testid="cifra-difuntos" />
        <Cifra etiqueta="Entregados (24 h)" valor={c.efectosEntregados} testid="cifra-entregados" />
      </div>

      {/* ── Alertas ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Alertas <span className="text-sm font-normal text-muted-foreground">· una por condición, no una por fila</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alertas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-alertas">
              Ninguna condición activa ahora mismo.
            </p>
          ) : (
            <Tabla cabeceras={['Severidad', 'Condición', 'Qué pasa', 'Desde', 'Estado', '']}>
              {alertas.map((a) => (
                <tr key={a.key} data-testid={`alerta-${a.key}`}>
                  <td className="px-2 py-1.5">
                    <Severidad valor={a.severity} />
                  </td>
                  <td className="px-2 py-1.5 font-medium">{a.etiqueta}</td>
                  <td className="px-2 py-1.5 text-sm text-muted-foreground">{a.summary}</td>
                  <td className="px-2 py-1.5">
                    <Momento valor={a.firstSeenAt} />
                  </td>
                  <td className="px-2 py-1.5 text-xs" data-testid={`alerta-estado-${a.key}`}>
                    {a.status === 'ACKNOWLEDGED' ? `Reconocida${a.acknowledgedPor ? ` · ${a.acknowledgedPor}` : ''}` : 'Activa'}
                  </td>
                  <td className="px-2 py-1.5">{a.status === 'ACTIVE' ? <ReconocerAlerta clave={a.key} /> : null}</td>
                </tr>
              ))}
            </Tabla>
          )}
        </CardContent>
      </Card>

      {/* ── Integraciones: banderas e interruptores ──────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Integraciones y capacidades</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            La <strong>bandera</strong> es la decisión del despliegue y cambiarla pide un despliegue. El{' '}
            <strong>interruptor</strong> es la decisión de ahora y surte efecto en segundos. Para funcionar hacen falta
            las dos; para apagar, basta una.
          </p>
          {capacidades.map((cap) => (
            <div key={cap.clave} data-testid={`capacidad-${cap.clave}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-3 last:border-0 last:pb-0">
              <Estado valor={cap.activa ? 'HEALTHY' : 'NOT_CONFIGURED'} testid={`capacidad-estado-${cap.clave}`} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{cap.etiqueta}</p>
                <p className="text-xs text-muted-foreground">
                  Bandera: {cap.bandera ? 'encendida' : 'apagada'} · Interruptor:{' '}
                  {cap.interruptor === null ? 'sin tocar' : cap.interruptor ? 'encendido' : 'APAGADO'}
                  {cap.motivo ? ` · «${cap.motivo}»` : ''}
                  {cap.cambiadoPor ? ` · ${cap.cambiadoPor}` : ''}
                </p>
              </div>
              <Interruptor clave={cap.clave} etiqueta={cap.etiqueta} activa={cap.activa} corta={cap.corta} conserva={cap.conserva} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Configuración crítica ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Configuración crítica <span className="text-sm font-normal text-muted-foreground">· estados, nunca valores</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabla cabeceras={['Estado', 'Pieza', 'Qué pasa si falta']}>
            {resumen.configuracion.piezas.map((p) => (
              <tr key={p.clave} data-testid={`config-${p.clave}`}>
                <td className="px-2 py-1.5">
                  <EstadoConfigChip valor={p.estado} testid={`config-estado-${p.clave}`} />
                </td>
                <td className="px-2 py-1.5 font-medium">{p.etiqueta}</td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground">{p.remedio}</td>
              </tr>
            ))}
          </Tabla>
        </CardContent>
      </Card>

      {/* ── Atajos a las secciones ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Secciones</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: `${RUTA_OPERACIONES}/incidentes`, label: 'Incidentes financieros', texto: 'Lo que no cuadra, con dueño y severidad.' },
            { href: `${RUTA_OPERACIONES}/conciliaciones`, label: 'Conciliaciones', texto: 'Qué dijo cada lado y cuánto se diferencia.' },
            { href: `${RUTA_OPERACIONES}/inbox`, label: 'Eventos externos', texto: 'Lo que la pasarela mandó y qué hicimos con él.' },
            { href: `${RUTA_OPERACIONES}/outbox`, label: 'Outbox', texto: 'Efectos apuntados, en curso, entregados o muertos.' },
            { href: `${RUTA_OPERACIONES}/difuntos`, label: 'Sin salida', texto: 'Efectos y trabajos que agotaron sus intentos.' },
            { href: `${RUTA_OPERACIONES}/conciliaciones?outcome=MISMATCH`, label: 'Solo discrepancias', texto: 'Lo que no cuadra, sin lo que sí.' },
          ].map((s) => (
            <Link key={s.href} href={s.href} className="rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
              <p className="font-medium">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.texto}</p>
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* ── Trabajos de la cola: la infraestructura de siempre ───────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Cola de trabajos <span className="text-sm font-normal text-muted-foreground">· la de siempre, no otra</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Estos son los difuntos de <code>trabajos_muertos</code>, con sus acciones de reencolar y descartar en el
            panel de integraciones, que ya existían. Aquí se muestran para no tener que acordarse de mirar en dos
            sitios.{' '}
            <Link href="/superadmin/integraciones" className="underline">
              Ir al panel de la cola
            </Link>
            .
          </p>
          {difuntosCola.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-difuntos-cola">
              Ningún trabajo difunto pendiente.
            </p>
          ) : (
            <Tabla cabeceras={['Tipo', 'Intentos', 'Error', 'Cuándo']}>
              {difuntosCola.map((d) => (
                <tr key={d.id} data-testid={`difunto-cola-${d.id}`}>
                  <td className="px-2 py-1.5 font-medium">{d.tipo}</td>
                  <td className="px-2 py-1.5 tabular-nums">{d.intentos}</td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{d.error ?? '—'}</td>
                  <td className="px-2 py-1.5">
                    <Momento valor={d.createdAt} />
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
        </CardContent>
      </Card>

      {/* ── Conciliación manual ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Conciliación manual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Mira lo que la pasarela dijo contra lo que Membego tiene escrito, y abre incidente si no cuadra.{' '}
            <strong>No corrige nada.</strong> Hace falta un criterio: sin él no se lanza un barrido desde el panel.
          </p>
          <ConciliarAPeticion />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground" data-testid="pie-umbrales">
        Umbrales vigentes: outbox avisa a los {resumen.umbrales.outboxPendienteAviso} min y es crítico a los{' '}
        {resumen.umbrales.outboxPendienteCritico} min · incidentes altos desde {resumen.umbrales.incidentesAltosAviso} ·
        difuntos desde {resumen.umbrales.difuntosAviso}. Inbox: {Object.entries(inboxPorEstado).map(([k, v]) => `${k} ${v}`).join(' · ') || 'sin eventos'} ·
        Outbox: {Object.entries(outboxPorEstado).map(([k, v]) => `${k} ${v}`).join(' · ') || 'sin efectos'}.
        Medido <Momento valor={resumen.medidoEn} />. <Edad minutos={0} />
      </p>
    </div>
  )
}
