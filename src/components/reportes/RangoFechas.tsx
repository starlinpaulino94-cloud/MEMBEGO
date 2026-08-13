import Link from 'next/link'
import Form from 'next/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PRESETS, type Rango } from '@/modules/reportes/rango'

/**
 * Selector de periodo de un reporte.
 *
 * Estaba escrito dentro de `/admin/reportes` y a punto de necesitarse en otras
 * tres pantallas. Copiarlo habría multiplicado el detalle que sí importa: los
 * presets son ENLACES y no botones de un formulario, así que el periodo viaja
 * en la URL y se puede compartir, guardar en favoritos y —lo que de verdad
 * hacía falta— pasarle a la exportación y a la impresión el mismo corte que
 * está viendo la persona. Un export que exporta otro periodo que la pantalla
 * es la forma más silenciosa de dar un dato equivocado.
 *
 * `extra` son los parámetros que NO son el periodo (búsqueda, orden, si se
 * incluyen las de práctica). Viajan escondidos en el formulario y pegados a
 * los enlaces para que elegir «mes pasado» no borre lo demás.
 */
export function RangoFechas({
  rango,
  accion,
  extra,
}: {
  rango: Rango
  /** Ruta a la que apuntan los presets y el formulario. */
  accion: string
  extra?: URLSearchParams
}) {
  const conExtra = (sp: URLSearchParams) => {
    for (const [k, v] of extra ?? []) sp.set(k, v)
    return sp.toString()
  }

  return (
    <div className="print:hidden flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => {
          const activo = rango.preset === p.clave
          return (
            <Link
              key={p.clave}
              href={`${accion}?${conExtra(new URLSearchParams({ rango: p.clave }))}`}
              className={`inline-flex min-h-10 items-center rounded-lg px-3 text-small font-semibold transition-colors ${
                activo
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              aria-current={activo ? 'page' : undefined}
            >
              {p.label}
            </Link>
          )
        })}
      </div>

      <Form action={accion} className="ml-auto flex flex-wrap items-end gap-2">
        {/* Los filtros que no son el periodo sobreviven al submit. */}
        {[...(extra ?? [])].map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="text-caption">
          Desde
          <Input type="date" name="desde" defaultValue={rango.desdeDia} className="mt-1" />
        </label>
        <label className="text-caption">
          Hasta
          <Input type="date" name="hasta" defaultValue={rango.hastaDia} className="mt-1" />
        </label>
        <Button type="submit" variant="secondary">
          Aplicar
        </Button>
      </Form>
    </div>
  )
}
