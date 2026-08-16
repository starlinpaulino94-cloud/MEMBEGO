'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './button'
import { ConfirmDialog } from './confirm-dialog'

/**
 * BOTÓN QUE PREGUNTA ANTES DE HACER — sobre una acción de servidor con
 * formulario.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE (y por qué `DeleteButton` no bastaba)
 *
 * El design system ya traía `DeleteButton`, que hace exactamente esta danza:
 * botón → `ConfirmDialog` → estado de carga → toast. Pero es de UNA sola forma
 * —llamada directa a la acción con `useTransition`— y de UNA sola intención:
 * borrar. Todo lo que no fuera un borrado por llamada directa se quedaba fuera,
 * y como quedaba fuera, ocho sitios escribieron su propia copia:
 *
 *   · aprobar un pago            · desactivar una membresía
 *   · cancelar una membresía     · archivar una promoción
 *   · desinstalar una estrategia · ejecutar las automatizaciones
 *   · comprar una promoción      · (y las dos del panel de plataforma)
 *
 * Las ocho repetían las mismas quince líneas: un `useRef` al formulario, un
 * `useState` para el diálogo, un `useActionState`, un `useEffect` con los dos
 * toasts, y el paso fino de `setOpen(false)` + `requestSubmit()`. Repetir eso
 * no es solo verbosidad: es que las diferencias entre copias eran ACCIDENTALES.
 * Unas deshabilitaban el botón mientras la acción corría y otras no —así que en
 * unas se podía disparar dos veces—, y unas marcaban la acción como peligrosa y
 * otras no para acciones igual de destructivas.
 *
 * Aquí se decide una vez.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CUÁL DE LOS DOS USAR
 *
 *   · `DeleteButton`     — borrar algo, llamada directa. Sigue siendo el
 *                          adecuado para eso.
 *   · `BotonConfirmado`  — cualquier otra acción de servidor que va por
 *                          `<form action>`. Es la que se debe preferir cuando
 *                          hay campos que enviar: el formulario funciona
 *                          aunque el JavaScript no haya cargado todavía.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIN `confirmacion`, ES UN BOTÓN DE ENVÍO NORMAL
 *
 * Y eso es deliberado: preguntar SIEMPRE convierte el aviso en un paso que se
 * despacha con Enter sin leerlo, y entonces tampoco protege el que sí importa.
 * Que la confirmación sea la ausencia o presencia de un objeto —y no un
 * booleano `pedirConfirmacion`— hace que quien la quiera tenga que escribir el
 * texto de la pregunta, que es justo la parte que hace falta pensar.
 */

/** Lo mínimo que este componente necesita saber del estado de una acción. */
export interface EstadoAccion {
  error?: string
  /** Cualquier cosa con verdad: unas acciones devuelven `true`, otras el texto. */
  success?: unknown
}

export interface Confirmacion {
  titulo: string
  descripcion?: string
  /** Texto del botón que confirma. «Confirmar» a secas dice poco. */
  textoConfirmar?: string
  textoCancelar?: string
  /** Marca el diálogo en rojo. Para lo que no se deshace con otro clic. */
  peligrosa?: boolean
}

export interface BotonConfirmadoProps<E extends EstadoAccion> {
  /**
   * La acción de servidor, en la forma que espera `useActionState`.
   *
   * `Awaited<E>` y no `E` porque es lo que `useActionState` exige: el estado
   * que recibe la acción es el ya resuelto, no la promesa.
   */
  accion: (estadoPrevio: Awaited<E>, formData: FormData) => Promise<E> | E
  /** Estado inicial. Casi siempre `{}`. */
  estadoInicial: Awaited<E>
  /** Campos ocultos del formulario: `{ membershipId: '…' }`. */
  campos?: Record<string, string>
  /** Contenido del botón. El icono de carga lo pone este componente. */
  children: React.ReactNode
  /** Sin esto, el botón envía directamente. Ver la nota de arriba. */
  confirmacion?: Confirmacion
  /** Qué decir al salir bien. Sin él no se muestra ningún toast de éxito. */
  mensajeExito?: string
  /**
   * Para cuando el mensaje depende del resultado («se enviaron 3 avisos»).
   * Si se pasa, sustituye a `mensajeExito`.
   */
  alExito?: (estado: Awaited<E>) => void
  /**
   * Para cuando el fallo trae algo que hacer, no solo algo que decir: el caso
   * que lo motiva es «ya tienes una compra de esta promoción», cuyo error
   * incluye el id al que hay que llevar a la persona.
   *
   * El toast de error se muestra IGUAL: esto se suma, no sustituye. Una acción
   * que falla en silencio es lo peor que puede pasar aquí.
   */
  alFallar?: (estado: Awaited<E>) => void
  /**
   * Se toman del propio `Button` en vez de repetir la lista: escrita a mano se
   * queda vieja en cuanto alguien añade una variante, y el error aparece en el
   * sitio equivocado.
   */
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  className?: string
  /** Obligatorio si el botón es solo un icono. */
  ariaLabel?: string
  title?: string
  /** Motivo por el que no se puede pulsar ahora mismo. */
  deshabilitado?: boolean
}

export function BotonConfirmado<E extends EstadoAccion>({
  accion,
  estadoInicial,
  campos,
  children,
  confirmacion,
  mensajeExito,
  alExito,
  alFallar,
  variant = 'default',
  size = 'default',
  className,
  ariaLabel,
  title,
  deshabilitado = false,
}: BotonConfirmadoProps<E>) {
  const [estado, enviar, pendiente] = useActionState(accion, estadoInicial)
  const formRef = useRef<HTMLFormElement>(null)
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    if (estado.error) {
      toast.error(estado.error)
      alFallar?.(estado)
    }
    if (!estado.success) return
    if (alExito) alExito(estado)
    else if (mensajeExito) toast.success(mensajeExito)
    // Las tres devoluciones de llamada y `mensajeExito` se omiten a propósito:
    // si vinieran en las
    // dependencias, una función escrita en línea —que es lo normal— cambiaría
    // de identidad en cada render y el toast saldría dos veces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado])

  return (
    <>
      <form ref={formRef} action={enviar}>
        {Object.entries(campos ?? {}).map(([nombre, valor]) => (
          <input key={nombre} type="hidden" name={nombre} value={valor} />
        ))}
        <Button
          // Sin confirmación es un envío normal y el formulario funciona sin
          // JavaScript. Con ella hace falta interceptar, y ahí sí se necesita
          // que el botón no envíe por su cuenta.
          type={confirmacion ? 'button' : 'submit'}
          variant={variant}
          size={size}
          className={className}
          aria-label={ariaLabel}
          title={title ?? ariaLabel}
          // Deshabilitar mientras corre no es cosmético: sin esto, dos clics
          // seguidos disparan la acción dos veces. Varias de las copias que
          // este componente sustituye no lo hacían.
          disabled={deshabilitado || pendiente}
          onClick={confirmacion ? () => setAbierto(true) : undefined}
        >
          {pendiente && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {children}
        </Button>
      </form>

      {confirmacion && (
        <ConfirmDialog
          open={abierto}
          title={confirmacion.titulo}
          description={confirmacion.descripcion}
          confirmText={confirmacion.textoConfirmar}
          cancelText={confirmacion.textoCancelar}
          isDangerous={confirmacion.peligrosa}
          isLoading={pendiente}
          onConfirm={() => {
            // Cerrar ANTES de enviar. `requestSubmit()` dispara el `submit` de
            // forma síncrona, así que si se cerrara después el diálogo se
            // quedaría abierto encima de la acción ya en marcha. Aquí no hay
            // `onSubmit` que interceptar —el formulario es de este componente—,
            // que es lo que hace seguro este orden.
            setAbierto(false)
            formRef.current?.requestSubmit()
          }}
          onCancel={() => setAbierto(false)}
        />
      )}
    </>
  )
}
