'use client'

import { useActionState, useEffect, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, FileCheck2, Headset, Loader2, LockKeyhole, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBanner } from '@/components/ui/status-banner'
import { StatusChip } from '@/components/ui/status-chip'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'
import { cn } from '@membego/ui/cn'
import {
  borrarDatosDeIdentidadAction,
  cambiarDivulgacionAction,
  iniciarVerificacionAction,
  reportarProblemaAction,
  type IdentidadActionState,
} from '@/modules/identidad/clienteActions'
import type { PanelDeIdentidad } from '@/modules/identidad/identidadPuerta'
import type { ConsentimientoDePanel, TonoDeVista } from '@/modules/identidad/vistaCore'

const inicial: IdentidadActionState = {}

const TONO_CHIP: Record<TonoDeVista, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  exito: 'success',
  aviso: 'warning',
  peligro: 'danger',
  info: 'info',
  neutro: 'neutral',
}
const TONO_BANNER: Record<TonoDeVista, 'success' | 'warning' | 'info' | 'destructive'> = {
  exito: 'success',
  aviso: 'warning',
  peligro: 'destructive',
  info: 'info',
  neutro: 'info',
}

/** Cuántas veces, como mucho, se vuelve a preguntar el estado sola la pantalla (cada 6 s: ~5 min). */
const SONDEOS_MAXIMOS = 50

/**
 * LA VERIFICACIÓN DE IDENTIDAD, en la pantalla de la persona (web).
 *
 * No decide nada: recibe del servidor la vista armada (`panel.vista`: el estado, qué botón
 * ofrecer, qué decir y con qué tono) y la pinta. Cada estado se dice con texto además de
 * con color. El servidor además repite todas las reglas: una pantalla manipulada no puede
 * saltarse un consentimiento ni marcarse verificada.
 *
 * Mientras algo está por resolverse (`vista.sondear`) la pantalla vuelve a preguntar sola
 * cada pocos segundos; al volver del proveedor (`retorno`) también.
 */
export function VerificacionIdentidad({ panel, retorno }: { panel: PanelDeIdentidad; retorno: boolean }) {
  const router = useRouter()
  const { vista } = panel
  const [reportando, setReportando] = useState(false)

  useEffect(() => {
    if (!vista.sondear && !retorno) return
    let n = 0
    const id = setInterval(() => {
      if (++n > SONDEOS_MAXIMOS) clearInterval(id)
      else router.refresh()
    }, 6_000)
    return () => clearInterval(id)
  }, [vista.sondear, retorno, router])

  const empieza = vista.accion === 'verificar' || vista.accion === 'continuar' || vista.accion === 'reintentar'

  return (
    <div className="space-y-5">
      {retorno && vista.estado !== 'verificada' && (
        <StatusBanner variant="info" title="Volviste de la verificación">
          Estamos comprobando el resultado. Esta pantalla se actualiza sola.
        </StatusBanner>
      )}

      <Card className="border-border/60 shadow-card">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-h4">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
            Verificación de identidad
            <StatusChip tone={TONO_CHIP[vista.tono]} className="ml-auto">
              {vista.etiqueta}
            </StatusChip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div aria-live="polite">
            <h2 className="text-h3 text-foreground">{vista.titulo}</h2>
            <p className="mt-1 text-small leading-relaxed text-muted-foreground">{vista.descripcion}</p>
          </div>

          {vista.aviso && (
            <StatusBanner variant={TONO_BANNER[vista.aviso.tono]} title={vista.aviso.texto} />
          )}

          {empieza && <FormularioDeInicio panel={panel} />}

          {vista.accion === 'contactar' && (
            <Button type="button" variant="outline" onClick={() => setReportando(true)}>
              <Headset className="mr-2 h-4 w-4" aria-hidden />
              {vista.textoAccion ?? 'Contar mi problema'}
            </Button>
          )}

          {vista.sondear && (
            <p className="flex items-center gap-2 text-small text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Comprobando el estado…
            </p>
          )}
        </CardContent>
      </Card>

      {vista.mostrarDivulgacion && <Divulgacion consentimiento={panel.consentimientos.find((c) => c.tipo === 'IDENTIDAD_DIVULGACION_EMPRESAS')} />}

      <Informacion panel={panel} abierta={vista.accion === 'verificar'} />

      {(vista.puedeReportar || reportando || panel.incidenciasAbiertas.length > 0) && (
        <Problema panel={panel} abierto={reportando} alAbrir={() => setReportando(true)} />
      )}

      {vista.puedeBorrar && <BorrarDatos />}
    </div>
  )
}

// ── Empezar: consentimientos + botón ────────────────────────────────────────

function FormularioDeInicio({ panel }: { panel: PanelDeIdentidad }) {
  const { vista } = panel
  const [estado, enviar, pendiente] = useActionState(iniciarVerificacionAction, inicial)
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>({})
  // Con la dirección ya recibida, la persona se va a la verificación: el botón se queda ocupado hasta que cambie de página.
  const yendose = Boolean(estado.url)

  // Las casillas que se piden: las obligatorias que faltan y la opcional de los negocios.
  const pedir = vista.requiereConsentimientos ? panel.consentimientos.filter((c) => !c.vigente) : []
  const faltanObligatorias = pedir.some((c) => c.obligatorio && !marcadas[c.tipo])

  useEffect(() => {
    if (estado.error) toast.error(estado.error)
    if (estado.url) window.location.assign(estado.url)
  }, [estado])

  const ocupado = pendiente || yendose
  return (
    <form action={enviar} className="space-y-4">
      {pedir.map((c) => (
        <Consentimiento key={c.tipo} c={c} marcada={!!marcadas[c.tipo]} alCambiar={(v) => setMarcadas((m) => ({ ...m, [c.tipo]: v }))} />
      ))}
      {pedir.length > 0 && (
        <p className="text-caption text-muted-foreground">
          <a href={panel.urlCondiciones} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
            Cómo tratamos tus datos de verificación
          </a>
        </p>
      )}
      <Button type="submit" disabled={faltanObligatorias || ocupado} className="w-full sm:w-auto">
        {ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
        {yendose ? 'Abriendo la verificación…' : vista.textoAccion}
      </Button>
      <p className="text-caption text-muted-foreground">
        Te llevaremos a {panel.proveedor}, nuestro proveedor de verificación, y volverás aquí al terminar.
      </p>
    </form>
  )
}

/** Una casilla de consentimiento: el texto exacto que se registra y la versión que se vio. La fila entera es clicable (≥44px). */
function Consentimiento({ c, marcada, alCambiar }: { c: ConsentimientoDePanel; marcada: boolean; alCambiar: (v: boolean) => void }) {
  const id = useId()
  const idDetalle = `${id}-detalle`
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border bg-card p-4 transition-colors',
        marcada ? 'border-primary/50 bg-primary/5' : 'border-border/60 hover:border-primary/30'
      )}
    >
      <input type="hidden" name={`version:${c.tipo}`} value={c.textoVersion} />
      <input
        id={id}
        name={`acepta:${c.tipo}`}
        type="checkbox"
        checked={marcada}
        onChange={(e) => alCambiar(e.target.checked)}
        aria-describedby={c.detalle ? idDetalle : undefined}
        className="mt-0.5 h-5 w-5 shrink-0 cursor-[inherit] accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <span className="min-w-0 text-sm">
        <span className="block font-semibold text-foreground">
          {c.titulo}
          {!c.obligatorio && <span className="ml-2 text-caption font-normal text-muted-foreground">(opcional)</span>}
        </span>
        {c.detalle ? (
          <span id={idDetalle} className="mt-1 block leading-relaxed text-muted-foreground">
            {c.detalle}
          </span>
        ) : null}
      </span>
    </label>
  )
}

// ── Qué ven los negocios ────────────────────────────────────────────────────

function Divulgacion({ consentimiento }: { consentimiento?: ConsentimientoDePanel }) {
  const router = useRouter()
  const [estado, enviar, pendiente] = useActionState(cambiarDivulgacionAction, inicial)
  useEffect(() => {
    if (estado.error) toast.error(estado.error)
    if (estado.success) router.refresh()
    // Solo reacciona el estado de la acción.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado])
  if (!consentimiento) return null
  const permitido = consentimiento.vigente
  return (
    <Card className="border-border/60 shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-h4">
          <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          Qué ven los negocios
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={enviar} className="space-y-3">
          <input type="hidden" name="accion" value={permitido ? 'retirar' : 'aceptar'} />
          <input type="hidden" name="version" value={consentimiento.textoVersion} />
          <p className="text-small leading-relaxed text-muted-foreground">
            {permitido
              ? 'Los negocios donde eres cliente ven que estás verificado y desde cuándo. Nunca ven tu cédula ni tu selfie.'
              : 'Los negocios donde eres cliente no ven nada de tu verificación. Si quieres, pueden ver solo que estás verificado y desde cuándo; nunca tu cédula ni tu selfie.'}
          </p>
          <Button type="submit" variant="outline" disabled={pendiente}>
            {pendiente && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {permitido ? 'Dejar de mostrarlo' : 'Permitir que lo vean'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Cómo funciona y privacidad ──────────────────────────────────────────────

function Informacion({ panel, abierta }: { panel: PanelDeIdentidad; abierta: boolean }) {
  return (
    <Card className="border-border/60 shadow-card">
      <CardContent className="space-y-3 pt-6">
        <details open={abierta} className="group rounded-xl border border-border/60 px-4 py-3">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-h4 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <FileCheck2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            Cómo funciona
          </summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-small leading-relaxed text-muted-foreground">
            {panel.pasos.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </details>
        <details open={abierta} className="group rounded-xl border border-border/60 px-4 py-3">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-h4 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <LockKeyhole className="h-4 w-4 text-muted-foreground" aria-hidden />
            Tu privacidad
          </summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-small leading-relaxed text-muted-foreground">
            {panel.privacidad.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-3 text-caption text-muted-foreground">
            <a href={panel.urlCondiciones} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
              Leer la política de privacidad completa
            </a>
          </p>
        </details>
      </CardContent>
    </Card>
  )
}

// ── Incidencias ─────────────────────────────────────────────────────────────

function Problema({ panel, abierto, alAbrir }: { panel: PanelDeIdentidad; abierto: boolean; alAbrir: () => void }) {
  return (
    <Card className="border-border/60 shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-h4">
          <Headset className="h-4 w-4 text-muted-foreground" aria-hidden />
          ¿Algo no va bien?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {panel.incidenciasAbiertas.length > 0 && (
          <ul className="space-y-2">
            {panel.incidenciasAbiertas.map((i) => (
              <li key={i.id} className="rounded-xl border border-border/60 p-3 text-small">
                <span className="font-medium text-foreground">{i.etiqueta}</span>
                <span className="block text-caption text-muted-foreground">Reporte abierto desde el {i.desde}. Lo estamos revisando.</span>
              </li>
            ))}
          </ul>
        )}
        {!abierto ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={alAbrir}>
              Contar mi problema
            </Button>
            <p className="text-caption text-muted-foreground">
              O escríbenos a{' '}
              <a className="underline underline-offset-4 hover:text-foreground" href={`mailto:${panel.soporte.email}`}>
                {panel.soporte.email}
              </a>{' '}
              o por WhatsApp al {panel.soporte.whatsapp}.
            </p>
          </div>
        ) : (
          // Se vuelve a montar al entrar un reporte nuevo: así el texto se vacía solo.
          <FormularioDeProblema key={panel.incidenciasAbiertas.length} panel={panel} />
        )}
      </CardContent>
    </Card>
  )
}

function FormularioDeProblema({ panel }: { panel: PanelDeIdentidad }) {
  const router = useRouter()
  const [estado, enviar, pendiente] = useActionState(reportarProblemaAction, inicial)
  const [texto, setTexto] = useState('')
  useEffect(() => {
    if (estado.error) toast.error(estado.error)
    if (estado.success) {
      toast.success('Recibimos tu reporte. Lo revisaremos y te escribiremos.')
      router.refresh()
    }
    // Solo reacciona el estado de la acción.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado])
  const idTipo = useId()
  const idMensaje = useId()
  return (
    <form action={enviar} className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={idTipo} className="text-small font-medium text-foreground">
          ¿Qué pasa?
        </label>
        <select
          id={idTipo}
          name="tipo"
          required
          defaultValue=""
          className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-small text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="" disabled>
            Elige una opción
          </option>
          {panel.tiposDeIncidencia.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.etiqueta}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={idMensaje} className="text-small font-medium text-foreground">
          Cuéntanos más
        </label>
        <textarea
          id={idMensaje}
          name="mensaje"
          required
          maxLength={panel.maxMensajeIncidencia}
          rows={4}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-describedby={`${idMensaje}-ayuda`}
          className="min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-small text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p id={`${idMensaje}-ayuda`} className="text-caption text-muted-foreground">
          {panel.avisoDeIncidencia} ({texto.length}/{panel.maxMensajeIncidencia})
        </p>
      </div>
      {panel.intentoId && <input type="hidden" name="intentoId" value={panel.intentoId} />}
      <Button type="submit" disabled={pendiente || texto.trim().length === 0}>
        {pendiente && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
        Enviar reporte
      </Button>
    </form>
  )
}

// ── Borrar mis datos ────────────────────────────────────────────────────────

function BorrarDatos() {
  const router = useRouter()
  return (
    <Card className="border-border/60 shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-h4">
          <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          Borrar mis datos de verificación
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-small leading-relaxed text-muted-foreground">
          Borramos tu resultado de verificación y le pedimos a nuestro proveedor que elimine cualquier dato tuyo. Es definitivo: si más adelante quieres estar verificado, tendrás que hacerlo de nuevo.
        </p>
        <BotonConfirmado
          accion={borrarDatosDeIdentidadAction}
          estadoInicial={inicial}
          variant="outline"
          size="sm"
          alExito={() => {
            toast.success('Borramos tus datos de verificación.')
            router.refresh()
          }}
          confirmacion={{
            titulo: '¿Borrar tus datos de verificación?',
            descripcion: 'Perderás tu verificación y no se puede deshacer. Podrás verificarte de nuevo cuando quieras.',
            textoConfirmar: 'Sí, borrar',
            textoCancelar: 'Conservarlos',
            peligrosa: true,
          }}
        >
          Borrar mis datos
        </BotonConfirmado>
      </CardContent>
    </Card>
  )
}
