'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  cambiarInterruptorAction,
  conciliarAPeticionAction,
  evaluarAlertasAction,
  investigarIncidenteAction,
  reconocerAlertaAction,
  reintentarEfectoAction,
  reintentarEventoAction,
  resolverIncidenteAction,
  type EstadoOperacion,
} from '@/modules/supply-v2/actions-operaciones'
import { RESOLUCIONES } from '@/modules/supply-v2/operations/conciliacion-dominio'
import { PAYMENT_INCIDENT_RESOLUTION_LABELS } from '@/modules/supply-v2/core/catalogo'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 4 · LO QUE SE PUEDE PULSAR.
 *
 * Cada formulario llama a su server action, y la action exige su permiso. Lo
 * que se ve aquí no autoriza nada: si alguien manda el formulario sin permiso
 * —y una server action se puede invocar desde fuera de la página—, el servidor
 * lo rechaza igual.
 *
 * Nada de edición directa de filas: no hay un «guardar» sobre el outbox ni
 * sobre un evento. Las únicas acciones son las que el dominio sabe hacer con
 * su candado y su bitácora.
 */

type Accion = (prev: EstadoOperacion, fd: FormData) => Promise<EstadoOperacion>

/**
 * Llamar a la acción y AVISAR DESDE EL CIERRE, no desde un efecto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FALLO QUE ESTO ARREGLA (lo encontró el recorrido D)
 *
 * Esto estaba hecho con `useActionState` y un `useEffect` que sacaba el aviso
 * al cambiar el estado. Funciona mientras el componente siga montado —y hay
 * acciones cuyo PROPIO `revalidatePath` lo desmonta—: al reintentar un efecto
 * sin salida, el efecto deja de ser difunto, desaparece de la tabla, y con él
 * el formulario que tenía que avisar. Resultado: el reintento se hacía de
 * verdad —en base quedaba `PENDING`, intentos 0— y el operador no veía NADA.
 * Pulsar un botón, ver desaparecer la fila y no recibir confirmación es, de
 * madrugada, indistinguible de un fallo silencioso: se vuelve a pulsar.
 *
 * Esperando la promesa aquí, el aviso sale desde el cierre de este `async`, que
 * sobrevive al desmontaje porque la cola de avisos es global. El `setState` de
 * después puede no hacer nada, y da igual: ya no es de él de quien depende que
 * el operador se entere.
 */
function useAccion(accion: Accion) {
  const [pendiente, setPendiente] = useState(false)
  async function enviar(fd: FormData) {
    setPendiente(true)
    try {
      const r = await accion({}, fd)
      if (r.success) toast.success(r.success)
      if (r.error) toast.error(r.error)
    } catch {
      toast.error('No se pudo completar la acción. Vuelve a cargar el panel y comprueba el estado antes de repetirla.')
    } finally {
      setPendiente(false)
    }
  }
  return [enviar, pendiente] as const
}

/** §10 · el interruptor. Apagar pide motivo; encender, no. */
export function Interruptor({
  clave,
  etiqueta,
  activa,
  corta,
  conserva,
}: {
  clave: string
  etiqueta: string
  activa: boolean
  corta: readonly string[]
  conserva: readonly string[]
}) {
  const [enviar, pendiente] = useAccion(cambiarInterruptorAction)
  const [abierto, setAbierto] = useState(false)

  if (activa) {
    return (
      <div className="flex flex-col gap-2">
        {!abierto ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAbierto(true)}
            data-testid={`apagar-${clave}`}
          >
            Apagar
          </Button>
        ) : (
          <form action={enviar} className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2">
            <input type="hidden" name="clave" value={clave} />
            <input type="hidden" name="encender" value="no" />
            <p className="text-xs">
              Se corta: <strong>{corta.join(', ')}</strong>. Sigue funcionando: {conserva.join(', ')}.
            </p>
            <Label htmlFor={`motivo-${clave}`} className="text-xs">
              Por qué se apaga (obligatorio)
            </Label>
            <Input
              id={`motivo-${clave}`}
              name="motivo"
              required
              minLength={3}
              maxLength={300}
              placeholder="La pasarela está mandando avisos duplicados"
              data-testid={`motivo-${clave}`}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="destructive" disabled={pendiente} data-testid={`confirmar-apagar-${clave}`}>
                {pendiente ? 'Apagando…' : `Apagar ${etiqueta}`}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </div>
    )
  }

  return (
    <form action={enviar}>
      <input type="hidden" name="clave" value={clave} />
      <input type="hidden" name="encender" value="si" />
      <Button type="submit" size="sm" disabled={pendiente} data-testid={`encender-${clave}`}>
        {pendiente ? 'Encendiendo…' : 'Encender'}
      </Button>
    </form>
  )
}

/** §12 · reconocer una alerta, con nota obligatoria. */
export function ReconocerAlerta({ clave }: { clave: string }) {
  const [enviar, pendiente] = useAccion(reconocerAlertaAction)
  const [abierto, setAbierto] = useState(false)

  if (!abierto) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setAbierto(true)} data-testid={`reconocer-${clave}`}>
        Reconocer
      </Button>
    )
  }
  return (
    <form action={enviar} className="flex flex-col gap-2">
      <input type="hidden" name="key" value={clave} />
      {/* Va en una celda de tabla, así que el nombre accesible es `aria-label`
          y no una etiqueta visible: un `placeholder` no es un nombre —se borra
          al escribir y un lector de pantalla no lo anuncia—. */}
      <Input
        name="nota"
        required
        minLength={3}
        maxLength={500}
        aria-label={`Qué se está haciendo con la alerta ${clave}`}
        placeholder="Qué se está haciendo"
        data-testid={`nota-${clave}`}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pendiente} data-testid={`confirmar-reconocer-${clave}`}>
          {pendiente ? 'Guardando…' : 'Reconocer'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

export function EvaluarAlertas() {
  const [enviar, pendiente] = useAccion(evaluarAlertasAction)
  return (
    <form action={enviar}>
      <Button type="submit" variant="outline" size="sm" disabled={pendiente} data-testid="evaluar-alertas">
        {pendiente ? 'Evaluando…' : 'Reevaluar ahora'}
      </Button>
    </form>
  )
}

/** §22 · conciliación manual. Sin criterio no se lanza nada. */
export function ConciliarAPeticion({ orderId, transaccion }: { orderId?: string; transaccion?: string }) {
  const [enviar, pendiente] = useAccion(conciliarAPeticionAction)
  return (
    <form action={enviar} className="flex flex-wrap items-end gap-2">
      {orderId ? <input type="hidden" name="orderId" value={orderId} /> : null}
      {transaccion ? <input type="hidden" name="externalTransactionId" value={transaccion} /> : null}
      {!orderId && !transaccion ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="conciliar-tx" className="text-xs">
            Transacción de la pasarela
          </Label>
          <Input id="conciliar-tx" name="externalTransactionId" placeholder="TX-…" data-testid="conciliar-transaccion" />
        </div>
      ) : null}
      <Button type="submit" size="sm" disabled={pendiente} data-testid="conciliar-ahora">
        {pendiente ? 'Conciliando…' : 'Conciliar ahora'}
      </Button>
    </form>
  )
}

/** §17 · investigar y resolver. El servicio del bloque 3, sin tocarlo. */
export function AccionesDeIncidente({
  incidentId,
  status,
  totalDeLaCompra,
  tieneOrden,
}: {
  incidentId: string
  status: string
  totalDeLaCompra: string | null
  tieneOrden: boolean
}) {
  const [investigar, pendInv] = useAccion(investigarIncidenteAction)
  const [resolver, pendRes] = useAccion(resolverIncidenteAction)
  const [resolucion, setResolucion] = useState<string>(RESOLUCIONES.ACCEPT_INTERNAL)

  if (status === 'RESOLVED') {
    return <p className="text-sm text-muted-foreground">Este incidente ya está resuelto.</p>
  }

  const pideMonto = resolucion === RESOLUCIONES.ACCEPT_EXTERNAL

  return (
    <div className="flex flex-col gap-4">
      {status === 'OPEN' && (
        <form action={investigar}>
          <input type="hidden" name="incidentId" value={incidentId} />
          <Button type="submit" variant="outline" size="sm" disabled={pendInv} data-testid="investigar-incidente">
            {pendInv ? 'Marcando…' : 'Marcar en investigación'}
          </Button>
        </form>
      )}

      <form action={resolver} className="flex flex-col gap-3 rounded-lg border p-3">
        <input type="hidden" name="incidentId" value={incidentId} />
        <div className="flex flex-col gap-1">
          <Label htmlFor="resolucion" className="text-xs">
            Cómo se resuelve
          </Label>
          <select
            id="resolucion"
            name="resolucion"
            value={resolucion}
            onChange={(e) => setResolucion(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
            data-testid="select-resolucion"
          >
            {Object.values(RESOLUCIONES).map((r) => (
              <option key={r} value={r}>
                {PAYMENT_INCIDENT_RESOLUTION_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        {pideMonto && (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">
              Aceptar la evidencia externa <strong>confirma el pago por el servicio oficial</strong>: emite los derechos,
              reconoce la economía y apunta el aviso al cliente. Hay que escribir el importe que se autoriza
              {totalDeLaCompra ? ` (el total de la compra es ${totalDeLaCompra})` : ''}.
              {!tieneOrden && ' Este incidente no apunta a ninguna compra, así que esta opción fallará.'}
            </p>
            <Label htmlFor="montoExterno" className="text-xs">
              Importe autorizado
            </Label>
            <Input
              id="montoExterno"
              name="montoExterno"
              inputMode="decimal"
              placeholder={totalDeLaCompra ?? '0.00'}
              data-testid="monto-autorizado"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Label htmlFor="nota" className="text-xs">
            Qué se comprobó (obligatorio)
          </Label>
          <Textarea id="nota" name="nota" required minLength={3} maxLength={2000} rows={3} data-testid="nota-resolucion" />
        </div>

        <Button type="submit" size="sm" disabled={pendRes} data-testid="resolver-incidente">
          {pendRes ? 'Resolviendo…' : 'Resolver'}
        </Button>
      </form>
    </div>
  )
}


/** §18 · reintentar un efecto sin salida. El servicio es el del bloque 1. */
export function ReintentarEfecto({ outboxId }: { outboxId: string }) {
  const [enviar, pendiente] = useAccion(reintentarEfectoAction)
  return (
    <form action={enviar}>
      <input type="hidden" name="outboxId" value={outboxId} />
      <Button type="submit" size="sm" variant="outline" disabled={pendiente} data-testid={`reintentar-${outboxId}`}>
        {pendiente ? 'Reintentando…' : 'Reintentar'}
      </Button>
    </form>
  )
}

/**
 * §4D · reintentar un evento externo fallido o sin salida.
 *
 * Solo aparece en las filas que se pueden reintentar: un `PROCESSED` o un
 * `IGNORED` ya están resueltos y el servicio los rechaza, así que ofrecer el
 * botón sería prometer algo que el dominio no va a hacer.
 */
export function ReintentarEvento({ eventoId }: { eventoId: string }) {
  const [enviar, pendiente] = useAccion(reintentarEventoAction)
  return (
    <form action={enviar}>
      <input type="hidden" name="eventoId" value={eventoId} />
      <Button type="submit" size="sm" variant="outline" disabled={pendiente} data-testid={`reintentar-evento-${eventoId}`}>
        {pendiente ? 'Reencolando…' : 'Reintentar'}
      </Button>
    </form>
  )
}
