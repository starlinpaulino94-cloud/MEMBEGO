import type { ReactNode } from 'react'
import { cn } from '../cn'

/**
 * Lo que `Campo` le entrega al control para que error y ayuda queden ENLAZADOS a él. Se reparte con `{...control}`: el
 * control no sabe nada del campo, y el campo no sabe qué control es (Input, Select, Textarea, un grupo de opciones).
 */
export interface CampoControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

interface CampoProps {
  /** Obligatorio y estable: une `<label htmlFor>`, la ayuda y el error. No se genera solo (un id distinto en servidor y cliente rompe la hidratación). */
  id: string
  etiqueta: ReactNode
  /**
   * Se marca lo OPCIONAL, no lo obligatorio (docs/auditoria-admin/04 §3, regla 2). Un asterisco en cada campo obligatorio
   * obliga a leerlos todos; «(opcional)» solo aparece donde hace falta.
   */
  opcional?: boolean
  /** Texto de ayuda bajo el control. Se enlaza con `aria-describedby`. */
  ayuda?: ReactNode
  /**
   * Mensaje de error de ESTE campo. Aparece bajo el control, con `role="alert"` (se anuncia al aparecer) y marca el control
   * con `aria-invalid` y `aria-describedby`. Un error que solo sale en un `toast`, lejos del campo, no lo encuentra quien
   * usa un lector de pantalla (04 · F-01: 0 de 22 formularios medidos lo enlazaban).
   */
  error?: ReactNode
  /**
   * `campo` (por defecto): un control con su `<label>`. `grupo`: varios controles bajo una pregunta (opciones, días de la
   * semana); usa `<fieldset>` y `<legend>` y NO entrega `id` útil al hijo.
   */
  como?: 'campo' | 'grupo'
  className?: string
  children: (control: CampoControlProps) => ReactNode
}

/**
 * Un campo de formulario es UNA pieza: etiqueta siempre visible + control + ayuda + error (04 §3, regla 1).
 *
 *   <Campo id="titulo" etiqueta="Título" error={errores.titulo}>
 *     {(control) => <Input name="titulo" {...control} />}
 *   </Campo>
 *
 * Es de servidor: sin estado ni efectos. La validación la hace quien lo usa (la acción devuelve `{campo: mensaje}`).
 */
export function Campo({ id, etiqueta, opcional, ayuda, error, como = 'campo', className, children }: CampoProps) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined
  const idError = error ? `${id}-error` : undefined
  const describedby = [idAyuda, idError].filter(Boolean).join(' ') || undefined
  const control: CampoControlProps = {
    id,
    'aria-describedby': describedby,
    'aria-invalid': error ? true : undefined,
  }
  const marcaOpcional = opcional ? <span className="ml-1.5 font-normal text-muted-foreground">(opcional)</span> : null
  const mensajes = (
    <>
      {ayuda && (
        <p id={idAyuda} className="text-caption text-muted-foreground">
          {ayuda}
        </p>
      )}
      {error && (
        <p id={idError} role="alert" className="text-caption font-medium text-destructive">
          {error}
        </p>
      )}
    </>
  )

  if (como === 'grupo') {
    return (
      <fieldset
        data-slot="campo"
        data-invalido={error ? 'true' : undefined}
        aria-describedby={describedby}
        className={cn('grid min-w-0 gap-1.5 border-0 p-0', className)}
      >
        <legend className="p-0 text-small font-medium text-foreground">
          {etiqueta}
          {marcaOpcional}
        </legend>
        {children(control)}
        {mensajes}
      </fieldset>
    )
  }

  return (
    <div data-slot="campo" data-invalido={error ? 'true' : undefined} className={cn('grid min-w-0 gap-1.5', className)}>
      <label htmlFor={id} className="text-small font-medium text-foreground">
        {etiqueta}
        {marcaOpcional}
      </label>
      {children(control)}
      {mensajes}
    </div>
  )
}
