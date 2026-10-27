'use client'

import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CATEGORIAS_SUGERIDAS, type TipoItem } from '@/modules/excursiones/catalogo/formulario'
import type { SeccionProps } from './tipos'

const TIPOS: { valor: TipoItem; texto: string; resaltado: boolean }[] = [
  { valor: 'ACTIVIDAD', texto: 'Tour / actividad', resaltado: false },
  { valor: 'PASE_DIA', texto: 'Pase de día (sin horario)', resaltado: true },
  { valor: 'COMBO', texto: 'Combo / paquete', resaltado: true },
]

/**
 * INFORMACIÓN GENERAL: el tipo de ítem (actividad, pase de día o combo), el nombre, la descripción, la categoría y la capacidad.
 * Lo que solo aplica a un combo se ofrece justo debajo del tipo, por eso entra como `combo`.
 */
export function SeccionGeneral({
  v,
  poner,
  errores,
  tipoItem,
  alCambiarTipo,
  combo,
}: SeccionProps & { tipoItem: TipoItem; alCambiarTipo: (t: TipoItem) => void; combo: ReactNode }) {
  const esPase = tipoItem === 'PASE_DIA'
  return (
    <div className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-bold text-foreground sm:text-lg">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden />
          Información general
        </h3>

        <Campo id="exc-tipo" como="grupo" etiqueta="Tipo de ítem" className="sm:items-end">
          {() => (
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-muted/60 p-1">
              {TIPOS.map((t) => {
                const activo = tipoItem === t.valor
                return (
                  <button
                    key={t.valor}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => alCambiarTipo(t.valor)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      activo ? (t.resaltado ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card text-foreground shadow-sm') : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t.texto}
                  </button>
                )
              })}
            </div>
          )}
        </Campo>
      </div>

      <input type="hidden" name="tipoItem" value={tipoItem} />

      {tipoItem === 'COMBO' ? combo : null}

      <Campo id="exc-nombre" etiqueta="Nombre de la excursión" error={errores.nombre}>
        {(control) => (
          <Input
            name="nombre"
            value={v.nombre}
            onChange={(e) => poner({ nombre: e.target.value })}
            placeholder="Ej.: Isla Saona Premium & Piscinas Naturales"
            className="h-11 text-sm font-medium sm:text-base"
            required
            {...control}
          />
        )}
      </Campo>

      <Campo id="exc-desc" etiqueta="Descripción" opcional>
        {(control) => (
          <Textarea
            name="descripcion"
            value={v.descripcion}
            onChange={(e) => poner({ descripcion: e.target.value })}
            placeholder="Describe la experiencia, actividades, paradas y lo que hace único a este tour."
            rows={3}
            className="resize-y text-sm"
            {...control}
          />
        )}
      </Campo>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Campo id="exc-categoria" etiqueta="Categoría" opcional>
            {(control) => (
              <Input
                name="categoria"
                value={v.categoria}
                onChange={(e) => poner({ categoria: e.target.value })}
                placeholder="Ej.: Playa, Aventura, Buggies…"
                className="h-10 text-sm"
                {...control}
              />
            )}
          </Campo>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIAS_SUGERIDAS.slice(0, 4).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => poner({ categoria: cat })}
                className="rounded-lg border border-border/80 bg-muted/50 px-2 py-0.5 text-caption font-medium text-muted-foreground transition hover:border-primary/50 hover:text-primary"
              >
                + {cat}
              </button>
            ))}
          </div>
        </div>

        <Campo
          id="exc-capacidad"
          etiqueta={esPase ? 'Cupo máximo por día' : 'Capacidad total por salida'}
          opcional
          ayuda={esPase ? 'Límite máximo diario de pasajeros que pueden reservar para la misma fecha.' : 'Número máximo de pasajeros por turno.'}
          error={errores.capacidad}
        >
          {(control) => (
            <Input
              name="capacidad"
              type="number"
              min="1"
              value={v.capacidad}
              onChange={(e) => poner({ capacidad: e.target.value })}
              placeholder={esPase ? 'Ej.: 100 cupos/día' : 'Ej.: 30 cupos'}
              className="h-10 text-sm font-medium"
              {...control}
            />
          )}
        </Campo>
      </div>
    </div>
  )
}
