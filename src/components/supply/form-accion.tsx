'use client'

import { useActionState, useId } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { EstadoAccion } from '@/modules/supply/actions-util'

/**
 * MEMBEGO SUPPLY · formulario genérico sobre una server action.
 *
 * Las pantallas de finanzas tienen decenas de formularios pequeños (aplicar
 * un depósito, disputar una cuenta, aprobar una liquidación…) con la misma
 * anatomía: campos ocultos, dos o tres campos visibles, un botón, un mensaje.
 * Escribir un componente por cada uno multiplica el mismo `useActionState`
 * treinta veces; este los describe con datos.
 *
 * La acción llega como prop desde el server component (React 19 serializa la
 * referencia): el cliente nunca elige qué acción ejecutar, solo con qué datos.
 *
 * `confirmar` pide un «¿seguro?» del navegador antes de enviar. Se usa en lo
 * que no se deshace con otro clic (cancelar, anular, pagar).
 */

export interface CampoAccion {
  name: string
  label: string
  tipo?: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'checkbox'
  opciones?: { value: string; label: string }[]
  required?: boolean
  placeholder?: string
  defaultValue?: string
  min?: number
  max?: number
  step?: string
  maxLength?: number
  /** Nota bajo el campo. */
  ayuda?: string
}

export interface FormAccionProps {
  accion: (prev: EstadoAccion, fd: FormData) => Promise<EstadoAccion>
  ocultos?: Record<string, string>
  campos?: CampoAccion[]
  etiqueta: string
  etiquetaPendiente?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  /** Texto del `confirm()` del navegador. Sin él, envía directo. */
  confirmar?: string
  /** En línea: campos y botón en una fila (para celdas de tabla). */
  compacto?: boolean
  nota?: string
  /** Recargar la página al terminar bien (cuando la pantalla depende del dato). */
  recargar?: boolean
  className?: string
}

export function FormAccion({
  accion,
  ocultos = {},
  campos = [],
  etiqueta,
  etiquetaPendiente,
  variant = 'default',
  size = 'sm',
  confirmar,
  compacto = false,
  nota,
  recargar = false,
  className,
}: FormAccionProps) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(
    async (prev, fd) => {
      const res = await accion(prev, fd)
      if (res.success && recargar && typeof window !== 'undefined') {
        setTimeout(() => window.location.reload(), 600)
      }
      return res
    },
    {}
  )
  const idBase = useId()

  const cols = campos.length >= 4 ? 'sm:grid-cols-4' : campos.length === 3 ? 'sm:grid-cols-3' : campos.length === 2 ? 'sm:grid-cols-2' : ''

  return (
    <form
      action={enviar}
      onSubmit={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault()
      }}
      className={className ?? (compacto ? 'flex flex-wrap items-end gap-2' : 'space-y-3')}
    >
      {Object.entries(ocultos).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      {campos.length > 0 && (
        <div className={compacto ? 'flex flex-wrap items-end gap-2' : `grid gap-3 ${cols}`}>
          {campos.map((c) => (
            <Campo key={c.name} campo={c} id={`${idBase}-${c.name}`} compacto={compacto} />
          ))}
        </div>
      )}

      <div className={compacto ? 'flex items-center gap-2' : 'flex flex-wrap items-center gap-3'}>
        <Button type="submit" size={size} variant={variant} disabled={pendiente}>
          {pendiente ? (etiquetaPendiente ?? 'Aplicando…') : etiqueta}
        </Button>
        {nota && !compacto && <span className="text-caption text-muted-foreground">{nota}</span>}
      </div>

      {estado.error && <p className="text-caption text-destructive">{estado.error}</p>}
      {estado.success && <p className="text-caption text-success">{estado.success}</p>}
    </form>
  )
}

function Campo({ campo: c, id, compacto }: { campo: CampoAccion; id: string; compacto: boolean }) {
  const tipo = c.tipo ?? 'text'
  const claseSelect = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'
  const contenedor = compacto ? 'min-w-[8rem]' : ''

  if (tipo === 'checkbox') {
    return (
      <label htmlFor={id} className={`flex items-center gap-2 text-sm ${contenedor}`}>
        <input id={id} type="checkbox" name={c.name} defaultChecked={c.defaultValue === 'on'} className="size-4" />
        {c.label}
      </label>
    )
  }

  return (
    <div className={contenedor}>
      <Label htmlFor={id}>{c.label}</Label>
      {tipo === 'select' ? (
        <select id={id} name={c.name} defaultValue={c.defaultValue} required={c.required} className={claseSelect}>
          {(c.opciones ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : tipo === 'textarea' ? (
        <Textarea id={id} name={c.name} rows={2} required={c.required} placeholder={c.placeholder} maxLength={c.maxLength} defaultValue={c.defaultValue} />
      ) : (
        <Input
          id={id}
          name={c.name}
          type={tipo}
          required={c.required}
          placeholder={c.placeholder}
          min={c.min}
          max={c.max}
          step={c.step ?? (tipo === 'number' ? '0.01' : undefined)}
          maxLength={c.maxLength}
          defaultValue={c.defaultValue}
        />
      )}
      {c.ayuda && <p className="mt-1 text-caption text-muted-foreground">{c.ayuda}</p>}
    </div>
  )
}
