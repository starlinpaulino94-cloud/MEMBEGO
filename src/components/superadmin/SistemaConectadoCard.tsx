'use client'

import { useActionState, useRef, useState } from 'react'
import { formatDate, formatDateTime } from '@/lib/format'
import { plural, soloPlural } from '@/lib/plural'
import { Activity, Loader2, RefreshCw, Stethoscope } from 'lucide-react'
import {
  sondearWebhookAction,
  reintentarPendientesAction,
  type SondaState,
  type ReintentoState,
} from '@/modules/integraciones/panelActions'
import type { ResumenSistema } from '@/modules/integraciones/panel'
import { anclaSistema } from '@/modules/integraciones/diagnostico'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { StatusBanner } from '@/components/ui/status-banner'

/**
 * Tarjeta de un sistema satélite: estado de su cola, sonda del webhook y
 * reenvío forzado.
 *
 * Es cliente y no servidor porque el resultado de la sonda tiene que aparecer
 * SIN recargar y sin perderse: es el dato que se le reenvía al equipo del otro
 * sistema, y hacerlo por navegación lo borraría al primer clic.
 */

const SONDA_INIT: SondaState = {}
const REINTENTO_INIT: ReintentoState = {}

const VARIANTE = {
  ok: 'success',
  aviso: 'warning',
  falla: 'destructive',
} as const

/** El mismo semáforo, en texto, para la línea de la última prueba guardada. */
const TONO_SONDA = {
  ok: 'text-success',
  aviso: 'text-warning',
  falla: 'text-destructive',
} as const

/**
 * Cómo se lee cada estado del ciclo de vida. `activo: Boolean` solo sabía decir
 * «Inactivo», que servía igual para un sistema en construcción que para uno
 * caído — y son dos llamadas de teléfono distintas.
 */
const ESTADO = {
  DRAFT: { texto: 'Borrador', variante: 'secondary' },
  ACTIVE: { texto: 'Activo', variante: 'default' },
  SUSPENDED: { texto: 'Suspendido', variante: 'destructive' },
  RETIRED: { texto: 'Retirado', variante: 'outline' },
} as const

function Numerito({ label, valor, tono }: { label: string; valor: number; tono?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tono ?? 'text-foreground'}`}>{valor}</p>
    </div>
  )
}

export function SistemaConectadoCard({ sistema }: { sistema: ResumenSistema }) {
  const [sonda, sondear, sondeando] = useActionState(sondearWebhookAction, SONDA_INIT)
  const [reintento, reintentar, reintentando] = useActionState(
    reintentarPendientesAction,
    REINTENTO_INIT
  )
  const revivirRef = useRef<HTMLFormElement>(null)
  const [confirmarRevivir, setConfirmarRevivir] = useState(false)
  /**
   * Ref y no estado: `requestSubmit()` dispara el `submit` de forma SÍNCRONA,
   * antes de que React haya aplicado un `setState` de este mismo manejador. Con
   * estado, el segundo envío volvería a leer el valor viejo y a preguntar en
   * bucle; con ref, el paso queda marcado en el acto.
   */
  const revivirConfirmado = useRef(false)

  /**
   * PREGUNTAR ANTES DE DEVOLVER LOS AGOTADOS A LA COLA.
   *
   * Es la única acción del panel que no se puede deshacer con otro clic: cada
   * evento revivido se vuelve a entregar al satélite, y si el problema no
   * estaba resuelto, lo que se consigue es volver a golpear un sistema ajeno
   * con cientos de peticiones. Estaba a un clic sin ninguna barrera, al lado de
   * dos botones inofensivos y con el mismo aspecto.
   */
  function alRevivir(e: React.FormEvent<HTMLFormElement>) {
    if (revivirConfirmado.current) {
      revivirConfirmado.current = false
      return
    }
    e.preventDefault()
    setConfirmarRevivir(true)
  }

  const r = sonda.resultado
  const s = sistema.ultimaSonda

  return (
    // El aviso de arriba enlaza aquí: con varios satélites conectados, «2
    // sistemas no están recibiendo sus eventos» obligaba a bajar leyendo
    // tarjetas hasta dar con cuáles.
    <Card id={anclaSistema(sistema.slug)} className="scroll-mt-24">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">
            {sistema.nombre}{' '}
            <span className="font-mono text-xs text-muted-foreground">({sistema.slug})</span>
          </CardTitle>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {sistema.urlWebhook ?? 'sin URL de webhook registrada'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {/* Sin ningún vertical declarado, nadie puede entrar al sistema por
              mucho que esté ACTIVE: hay que decirlo aquí y no dejar el hueco. */}
          {sistema.tiposNegocio.length > 0 ? (
            sistema.tiposNegocio.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))
          ) : (
            <Badge variant="destructive">Sin vertical</Badge>
          )}
          <Badge variant={ESTADO[sistema.estado].variante}>{ESTADO[sistema.estado].texto}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {sistema.autoHabilitar ? (
            <>
              Abierto a <strong className="text-foreground">toda empresa compatible</strong>;{' '}
              {plural(sistema.habilitadas, 'empresa tiene', 'empresas tienen')} habilitación
              explícita.
            </>
          ) : (
            <>
              Solo por habilitación:{' '}
              <strong className="text-foreground">
                {plural(sistema.habilitadas, 'empresa habilitada', 'empresas habilitadas')}
              </strong>
              .
            </>
          )}
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Numerito
            label="Pendientes"
            valor={sistema.pendientes}
            tono={sistema.pendientes > 0 ? 'text-warning' : undefined}
          />
          <Numerito label="Entregados" valor={sistema.enviados} tono="text-success" />
          <Numerito
            label="Agotados"
            valor={sistema.fallidos}
            tono={sistema.fallidos > 0 ? 'text-destructive' : undefined}
          />
          <Numerito label="Intentos (tope 8)" valor={sistema.maxIntentos} />
        </div>

        {sistema.pendientes > 0 && sistema.ultimoError && (
          <StatusBanner variant="warning" title="La cola no está saliendo">
            Último error: <span className="font-mono">{sistema.ultimoError}</span>
            {sistema.esperandoDesde && (
              <>
                {' '}· el más viejo espera desde el{' '}
                {formatDate(sistema.esperandoDesde)}
              </>
            )}
            . Al llegar a 8 intentos los eventos quedan agotados; se pueden devolver a la cola con
            el botón de abajo.
          </StatusBanner>
        )}

        {/* QUÉ hay atascado, y no solo cuánto. «37 pendientes» tiene dos causas
            que piden respuestas opuestas: un tipo de evento que el satélite no
            implementa (hablar con su equipo) o el webhook caído (arreglarlo
            ahora). Tres filas bastan para distinguirlas. */}
        {sistema.atascados.length > 0 && (
          <details className="rounded-xl border border-border/60 bg-muted/20">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">
              Ver qué está atascado
              <span className="ml-1 font-normal text-muted-foreground">
                ({sistema.atascados.length === sistema.pendientes
                  ? soloPlural(sistema.pendientes, 'el único', 'todos')
                  : `los ${sistema.atascados.length} más castigados de ${sistema.pendientes}`}
                )
              </span>
            </summary>
            <ul className="space-y-2 border-t border-border/60 px-3 py-2">
              {sistema.atascados.map((ev) => (
                <li key={ev.id} className="text-caption text-muted-foreground">
                  <span className="font-mono text-foreground">{ev.tipo}</span> ·{' '}
                  {ev.empresa} · {formatDateTime(ev.createdAt)} ·{' '}
                  {plural(ev.intentos, 'intento', 'intentos')}
                  {ev.ultimoError && (
                    <span className="mt-0.5 block break-all font-mono">{ev.ultimoError}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* La sonda anterior, traída de la bitácora: su resultado vivía solo en
            el estado de este componente y se perdía al cambiar de página, así
            que «¿esto ya fallaba ayer?» no tenía respuesta sin volver a probar
            —y volver a probar toca otra vez el sistema del tercero—. */}
        {s && (
          <p className="text-caption text-muted-foreground">
            Última prueba: {formatDateTime(s.cuando)} ·{' '}
            <span className={TONO_SONDA[s.gravedad]}>{s.titulo}</span>
            {s.status > 0 && <> · HTTP {s.status}</>}
            {s.quien && <> · {s.quien}</>}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <form action={sondear}>
            <input type="hidden" name="sistemaId" value={sistema.id} />
            <Button type="submit" variant="secondary" disabled={sondeando || !sistema.urlWebhook}>
              {sondeando ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Stethoscope className="mr-2 h-4 w-4" />
              )}
              Probar el webhook
            </Button>
          </form>

          <form action={reintentar}>
            <input type="hidden" name="sistemaId" value={sistema.id} />
            <Button type="submit" disabled={reintentando || sistema.pendientes === 0}>
              {reintentando ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Reenviar ahora
            </Button>
          </form>

          {sistema.fallidos > 0 && (
            <form ref={revivirRef} action={reintentar} onSubmit={alRevivir}>
              <input type="hidden" name="sistemaId" value={sistema.id} />
              <input type="hidden" name="revivir" value="1" />
              <Button type="submit" variant="ghost" disabled={reintentando}>
                <Activity className="mr-2 h-4 w-4" />
                Devolver los agotados a la cola
              </Button>
            </form>
          )}
        </div>

        <ConfirmDialog
          open={confirmarRevivir}
          title={`¿Devolver ${plural(sistema.fallidos, 'evento', 'eventos')} a la cola?`}
          description={
            `Se reintentará la entrega de ${plural(sistema.fallidos, 'evento agotado', 'eventos agotados')} a ` +
            `${sistema.nombre}. Si la causa del fallo sigue ahí, volverán a agotarse tras 8 intentos ` +
            `y mientras tanto ese sistema recibirá toda esa carga de golpe. Prueba el webhook antes.`
          }
          confirmText="Devolver a la cola"
          isDangerous
          isLoading={reintentando}
          onConfirm={() => {
            revivirConfirmado.current = true
            setConfirmarRevivir(false)
            revivirRef.current?.requestSubmit()
          }}
          onCancel={() => setConfirmarRevivir(false)}
        />

        {reintento.error && (
          <StatusBanner variant="destructive" title="No se pudo reenviar">
            {reintento.error}
          </StatusBanner>
        )}
        {reintento.mensaje && (
          <StatusBanner variant="info" title="Reenvío ejecutado">
            {reintento.mensaje}
          </StatusBanner>
        )}

        {sonda.error && (
          <StatusBanner variant="destructive" title="No se pudo sondear">
            {sonda.error}
          </StatusBanner>
        )}

        {r && (
          <div className="space-y-3">
            <StatusBanner variant={VARIANTE[r.diagnostico.gravedad]} title={r.diagnostico.titulo}>
              {r.diagnostico.detalle}
              <span className="mt-2 block font-medium">{r.diagnostico.siguiente}</span>
            </StatusBanner>

            {/* Los códigos y cuerpos crudos: es lo que se le reenvía al equipo
                del otro sistema para que no tenga que creernos. */}
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['GET', r.get],
                  ['POST firmado', r.post],
                ] as const
              ).map(([etiqueta, resp]) => (
                <div key={etiqueta} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {etiqueta}
                  </p>
                  <p className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">
                    {resp.status === 0 ? 'sin respuesta' : resp.status}
                  </p>
                  {(resp.error || resp.cuerpo) && (
                    <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background/60 p-2 text-caption text-muted-foreground">
                      {resp.error ?? resp.cuerpo}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
