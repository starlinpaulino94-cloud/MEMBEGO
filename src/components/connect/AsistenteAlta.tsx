'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowLeft, Check, ExternalLink, Loader2, X } from 'lucide-react'
import {
  responderPasoAction,
  retrocederAction,
  terminarAltaAction,
  validarAltaAction,
  type AltaState,
} from '@/modules/connect/altaActions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { StatusBanner } from '@/components/ui/status-banner'
import { Switch } from '@/components/ui/switch'
import { AltaWhatsapp } from '@/components/connect/AltaWhatsapp'
import { AltaMetaWhatsapp } from '@/components/connect/AltaMetaWhatsapp'
import type { OpcionPaso } from '@/modules/connect/alta'

/**
 * EL ASISTENTE DE ALTA (Connect · Fase 12, rediseño «hub»).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO GUARDA EL PROGRESO EN EL NAVEGADOR
 *
 * Todo lo que se ve aquí llega ya decidido del servidor: en qué paso estamos,
 * cuánto queda, a dónde se puede volver. Este componente no lleva la cuenta de
 * nada, y esa es la razón por la que el paso de autorización funciona: cuando
 * el usuario vuelve de Google, vuelve en una petición NUEVA —puede ser otra
 * pestaña, u otro día— y aquí no hay ningún estado que se haya perdido.
 *
 * Un asistente que llevara el paso en `useState` se rompería exactamente ahí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA SOLA TARJETA CON FORMA DE DIÁLOGO
 *
 * Cabecera con el nombre y la salida, los pasos en horizontal —hechos con
 * marca, el actual con anillo, los que faltan en gris—, el contenido del paso
 * y un pie con «Atrás» y «Salir». Parece una ventana flotante pero es una
 * página, por la razón de arriba: una ventana no sobrevive la vuelta de
 * Google.
 *
 * Los pasos se pintan TODOS, con su nombre, y no «Paso 2 de 5»: saber que
 * después de «Autorizar» viene «Elegir calendario» es lo que quita el miedo a
 * pulsar un botón que se lleva a alguien fuera de Membego.
 */

const INIT: AltaState = {}

export interface PasoVista {
  id: string
  titulo: string
  descripcion: string
  tipo: string
  componente?: string
}

export interface AsistenteProps {
  slug: string
  nombre: string
  /** TODOS los pasos del guion, en orden, para pintar la barra de progreso. */
  pasos: { id: string; titulo: string }[]
  paso: PasoVista | null
  numero: number
  total: number
  completa: boolean
  /** Solo para pasos de elección. */
  opciones: OpcionPaso[]
  /** Si las opciones no se pudieron cargar, por qué. */
  errorOpciones: string | null
  /** El paso anterior al que se puede volver, si lo hay. */
  volverA: PasoVista | null
  /** Módulo desde el que se llegó (validado en el servidor), o null. */
  volverAlModulo: string | null
  /** Su nombre legible, para el enlace de vuelta. */
  nombreDelModulo: string
  urlAutorizacion: string
  /**
   * Configuración pública del alta incrustada de Meta. Null cuando este
   * despliegue no la tiene: entonces el guion es el del token manual y este
   * componente nunca llega a pedirla.
   */
  meta: { appId: string; configId: string; versionGraph: string } | null
}

type EstadoPaso = 'hecho' | 'actual' | 'pendiente'

/**
 * LA BARRA DE PASOS. El estado de cada uno se DERIVA del número que manda el
 * servidor: los anteriores están hechos, el que coincide es el actual, los
 * demás faltan. Con el alta completa, todos hechos. No hay una segunda lista
 * de «hechos» que pueda discrepar de la del servidor.
 */
function Pasos({
  pasos,
  numero,
  completa,
}: {
  pasos: { id: string; titulo: string }[]
  numero: number
  completa: boolean
}) {
  if (pasos.length === 0) return null

  const estadoDe = (i: number): EstadoPaso =>
    completa || i < numero - 1 ? 'hecho' : i === numero - 1 ? 'actual' : 'pendiente'

  // La línea une el centro del primer círculo con el del último. Con n pasos
  // repartidos a partes iguales, cada centro cae en (i + 0.5) / n del ancho.
  const n = pasos.length
  const margen = n > 0 ? 50 / n : 0
  const hechos = completa ? n - 1 : Math.max(0, Math.min(n - 1, numero - 1))
  const avance = n > 1 ? (hechos / (n - 1)) * 100 : 0

  return (
    <div className="relative">
      {n > 1 && (
        <>
          <div
            aria-hidden
            className="absolute top-4 h-0.5 -translate-y-1/2 bg-border"
            style={{ left: `${margen}%`, right: `${margen}%` }}
          />
          <div
            aria-hidden
            className="absolute top-4 h-0.5 -translate-y-1/2 bg-primary transition-all duration-base"
            style={{ left: `${margen}%`, width: `${((100 - 2 * margen) * avance) / 100}%` }}
          />
        </>
      )}
      <ol className="relative flex items-start" aria-label="Pasos del alta">
        {pasos.map((p, i) => {
          const estado = estadoDe(i)
          return (
            <li
              key={p.id}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center"
              aria-current={estado === 'actual' ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-caption font-bold transition-colors duration-fast',
                  estado === 'hecho' && 'border-primary bg-primary text-primary-foreground',
                  estado === 'actual' && 'border-primary bg-card text-primary ring-4 ring-primary/15',
                  estado === 'pendiente' && 'border-border bg-card text-muted-foreground'
                )}
              >
                {estado === 'hecho' ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  'line-clamp-2 px-1 text-caption font-medium',
                  estado === 'pendiente' ? 'text-muted-foreground' : 'text-primary'
                )}
              >
                {p.titulo}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Cabecera + pasos + contenido + pie: el marco común de todos los estados. */
function Marco({
  nombre,
  salirA,
  pasos,
  numero,
  completa,
  pie,
  children,
}: {
  nombre: string
  salirA: string
  pasos: { id: string; titulo: string }[]
  numero: number
  completa: boolean
  pie?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-4">
          <h1 className="text-h3 font-bold">Conectar {nombre}</h1>
          <Link
            href={salirA}
            aria-label="Salir sin terminar"
            title="Salir sin terminar"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" aria-hidden />
          </Link>
        </div>

        <Pasos pasos={pasos} numero={numero} completa={completa} />

        <div className="space-y-4">{children}</div>

        {pie && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
            {pie}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AsistenteAlta(props: AsistenteProps) {
  const [respuesta, responder, guardando] = useActionState(responderPasoAction, INIT)
  const [validacion, validar, validando] = useActionState(validarAltaAction, INIT)
  const [cierre, terminar, terminando] = useActionState(terminarAltaAction, INIT)
  const [, retroceder, retrocediendo] = useActionState(retrocederAction, INIT)

  const { slug, nombre, paso, numero, total, pasos, completa } = props
  const salirA = props.volverAlModulo ?? `/admin/integraciones/${slug}`
  const marco = { nombre, salirA, pasos, numero, completa }

  // ── Terminado ──────────────────────────────────────────────────────────────
  if (cierre.success) {
    return (
      <Marco {...marco} completa>
        <div className="space-y-4 py-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
            <Check className="h-7 w-7 text-success" aria-hidden />
          </span>
          <div>
            <p className="text-h3 font-bold">{nombre} está conectado</p>
            <p className="mt-1 text-muted-foreground">{cierre.success}</p>
          </div>
          {/* Quien llegó desde Citas vuelve a Citas: terminar un alta y
              aterrizar en otra sección es hacerle repetir el camino. */}
          <div className="flex flex-wrap justify-center gap-2">
            {props.volverAlModulo && (
              <Button asChild>
                <Link href={props.volverAlModulo}>Volver a {props.nombreDelModulo}</Link>
              </Button>
            )}
            <Button variant={props.volverAlModulo ? 'outline' : 'default'} asChild>
              <Link href={`/admin/integraciones/${slug}`}>Ver la integración</Link>
            </Button>
          </div>
        </div>
      </Marco>
    )
  }

  // ── No queda nada por contestar: solo falta cerrar ─────────────────────────
  if (completa || !paso) {
    return (
      <Marco
        {...marco}
        completa
        pie={
          <>
            <span />
            <Button variant="ghost" size="sm" asChild>
              <Link href={salirA}>Salir sin terminar</Link>
            </Button>
          </>
        }
      >
        <h2 className="text-h3 font-bold">Todo listo</h2>
        <p className="text-sm text-muted-foreground">
          Contestaste todos los pasos. Al guardar, {nombre} empieza a funcionar.
        </p>
        {cierre.error && (
          <StatusBanner variant="destructive" title="No se pudo terminar">
            {cierre.error}
          </StatusBanner>
        )}
        <form action={terminar}>
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" disabled={terminando}>
            {terminando ? 'Guardando…' : 'Guardar y conectar'}
          </Button>
        </form>
      </Marco>
    )
  }

  return (
    <Marco
      {...marco}
      pie={
        <>
          {props.volverA ? (
            <form action={retroceder}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="pasoId" value={props.volverA.id} />
              {/* Volver = OLVIDAR la respuesta de aquel paso. Deducido el paso
                  actual de lo cumplido, borrar una respuesta ES retroceder. */}
              <Button type="submit" variant="outline" size="sm" disabled={retrocediendo}>
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
                Atrás
              </Button>
            </form>
          ) : (
            <span />
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link href={salirA}>Salir sin terminar</Link>
          </Button>
        </>
      }
    >
      <div>
        <p className="text-caption font-medium text-muted-foreground">
          Paso {numero} de {total}
        </p>
        <h2 className="mt-1 text-h3 font-bold">{paso.titulo}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{paso.descripcion}</p>
      </div>

      {respuesta.error && (
        <StatusBanner variant="destructive" title="No se pudo guardar">
          {respuesta.error}
        </StatusBanner>
      )}

      {/* ── INFORMATIVO ──────────────────────────────────────────────────── */}
      {paso.tipo === 'INFORMATIVO' && (
        <form action={responder} className="flex flex-wrap gap-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="pasoId" value={paso.id} />
          <input type="hidden" name="valor" value="true" />
          <Button type="submit" disabled={guardando}>
            {guardando ? 'Un momento…' : 'Entendido, continuar'}
          </Button>
        </form>
      )}

      {/* ── AUTORIZACIÓN ─────────────────────────────────────────────────── */}
      {paso.tipo === 'AUTORIZACION' && (
        <div className="space-y-3">
          <p className="text-caption text-muted-foreground">
            Te llevamos fuera de Membego. Al terminar vuelves aquí, en este mismo paso.
            Membego no ve ni guarda tu contraseña.
          </p>
          <Button asChild>
            <a href={props.urlAutorizacion}>
              <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
              Autorizar con {nombre}
            </a>
          </Button>
        </div>
      )}

      {/* ── ELECCIÓN ─────────────────────────────────────────────────────── */}
      {paso.tipo === 'ELECCION' && (
        <>
          {props.errorOpciones ? (
            <StatusBanner variant="warning" title="No pudimos cargar las opciones">
              {props.errorOpciones}
            </StatusBanner>
          ) : props.opciones.length === 0 ? (
            <StatusBanner variant="warning" title="No hay nada que elegir">
              Tu cuenta no tiene ninguna opción disponible para este paso.
            </StatusBanner>
          ) : (
            <form action={responder} className="space-y-3">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="pasoId" value={paso.id} />
              <fieldset className="space-y-2">
                <legend className="sr-only">{paso.titulo}</legend>
                {props.opciones.map((o, i) => (
                  <label
                    key={o.valor}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-fast',
                      o.deshabilitada
                        ? 'cursor-not-allowed border-border/40 opacity-60'
                        : 'border-border/60 hover:border-primary/40 hover:bg-muted/30'
                    )}
                  >
                    <input
                      type="radio"
                      name="valor"
                      value={o.valor}
                      disabled={o.deshabilitada}
                      defaultChecked={!o.deshabilitada && i === 0}
                      className="mt-1 h-4 w-4"
                    />
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-medium">{o.etiqueta}</span>
                      {(o.nota || o.motivo) && (
                        <span className="block text-caption text-muted-foreground">
                          {o.motivo ?? o.nota}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </fieldset>
              <Button type="submit" disabled={guardando}>
                {guardando ? 'Guardando…' : 'Continuar'}
              </Button>
            </form>
          )}
        </>
      )}

      {/* ── FORMULARIO ───────────────────────────────────────────────────── */}
      {paso.tipo === 'FORMULARIO' && (
        <form action={responder} className="space-y-4">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="pasoId" value={paso.id} />
          <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 px-3 py-2.5">
            <Label htmlFor="sync" className="cursor-pointer">
              Llevar las citas confirmadas
              <span className="mt-0.5 block font-normal text-caption text-muted-foreground">
                Cada cita que confirmes aparecerá en el calendario elegido.
              </span>
            </Label>
            <Switch id="sync" name="opcion.sincronizarConfirmadas" defaultChecked />
          </div>
          <Button type="submit" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Continuar'}
          </Button>
        </form>
      )}

      {/* ── COMPONENTE ───────────────────────────────────────────────────── */}
      {/* La válvula de escape del framework, y a propósito es fea de usar: se
          nombra un componente a mano y eso se ve en la revisión. Existe para
          lo que ningún tipo genérico puede cubrir — hoy, el paso donde un
          secreto va directo a la credencial sellada sin pasar por el estado
          del alta; mañana, el diálogo del alta incrustada de Meta. */}
      {paso.tipo === 'COMPONENTE' && paso.componente === 'AltaWhatsapp' && <AltaWhatsapp />}
      {paso.tipo === 'COMPONENTE' && paso.componente === 'AltaMetaWhatsapp' && props.meta && (
        <AltaMetaWhatsapp
          appId={props.meta.appId}
          configId={props.meta.configId}
          versionGraph={props.meta.versionGraph}
        />
      )}
      {paso.tipo === 'COMPONENTE' &&
        !['AltaWhatsapp', 'AltaMetaWhatsapp'].includes(paso.componente ?? '') && (
          <StatusBanner variant="warning" title="Este paso todavía no está disponible">
            Estamos terminando esta parte. Escríbenos y lo conectamos contigo.
          </StatusBanner>
        )}

      {/* ── VALIDACIÓN ───────────────────────────────────────────────────── */}
      {paso.tipo === 'VALIDACION' &&
        (validando ? (
          // Mientras se comprueba, la pantalla lo dice en grande: es el único
          // momento del alta en el que hay que ESPERAR, y una lista quieta con
          // un botón apagado se lee como que se colgó.
          <div className="flex flex-col items-center gap-3 py-8 text-center" role="status">
            <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-muted">
              <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
            </span>
            <p className="text-h3 font-bold">Validando conexión…</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Estamos comprobando los permisos y la comunicación con {nombre}. Puede tardar unos
              segundos.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {validacion.comprobaciones && validacion.comprobaciones.length > 0 && (
              <ul className="space-y-2">
                {validacion.comprobaciones.map((c) => (
                  <li key={c.clave} className="flex items-start gap-2 text-sm">
                    {c.ok ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                    ) : (
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block">{c.titulo}</span>
                      {!c.ok && c.detalle && (
                        <span className="block text-caption text-muted-foreground">
                          {c.detalle}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {validacion.error && (
              <StatusBanner variant="destructive" title="Hay algo que arreglar">
                {validacion.error}
              </StatusBanner>
            )}

            <form action={validar}>
              <input type="hidden" name="slug" value={slug} />
              <Button type="submit">
                {validacion.error ? 'Volver a comprobar' : 'Comprobar'}
              </Button>
            </form>
            <p className="flex items-start gap-2 text-caption text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              No creamos ningún evento de prueba en tu agenda: solo comprobamos permisos.
            </p>
          </div>
        ))}
    </Marco>
  )
}
