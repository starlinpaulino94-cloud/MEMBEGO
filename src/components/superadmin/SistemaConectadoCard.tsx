'use client'

import { useActionState } from 'react'
import { Activity, Loader2, RefreshCw, Stethoscope } from 'lucide-react'
import {
  sondearWebhookAction,
  reintentarPendientesAction,
  type SondaState,
  type ReintentoState,
} from '@/modules/integraciones/panelActions'
import type { ResumenSistema } from '@/modules/integraciones/panel'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

  const r = sonda.resultado

  return (
    <Card>
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
              Abierto a <strong className="text-foreground">toda empresa compatible</strong>; {sistema.habilitadas}{' '}
              {sistema.habilitadas === 1 ? 'tiene' : 'tienen'} habilitación explícita.
            </>
          ) : (
            <>
              Solo por habilitación:{' '}
              <strong className="text-foreground">{sistema.habilitadas}</strong>{' '}
              {sistema.habilitadas === 1 ? 'empresa habilitada' : 'empresas habilitadas'}.
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
                {sistema.esperandoDesde.toLocaleDateString('es-DO')}
              </>
            )}
            . Al llegar a 8 intentos los eventos quedan agotados; se pueden devolver a la cola con
            el botón de abajo.
          </StatusBanner>
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
            <form action={reintentar}>
              <input type="hidden" name="sistemaId" value={sistema.id} />
              <input type="hidden" name="revivir" value="1" />
              <Button type="submit" variant="ghost" disabled={reintentando}>
                <Activity className="mr-2 h-4 w-4" />
                Devolver los agotados a la cola
              </Button>
            </form>
          )}
        </div>

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
                    <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background/60 p-2 text-[11px] text-muted-foreground">
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
