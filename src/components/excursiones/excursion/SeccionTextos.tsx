'use client'

import { Info, MapPin } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { SeccionProps } from './tipos'

/** UBICACIÓN Y PUNTO DE SALIDA: dónde queda y dónde se encuentra la gente. */
export function SeccionUbicacion({ v, poner }: SeccionProps) {
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <h3 className="flex items-center gap-2 text-base font-bold text-foreground sm:text-lg">
        <MapPin className="h-5 w-5 text-primary" aria-hidden />
        Ubicación y punto de salida
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="exc-ubicacion" etiqueta="Ciudad o región" opcional>
          {(control) => (
            <Input name="ubicacion" value={v.ubicacion} onChange={(e) => poner({ ubicacion: e.target.value })} placeholder="Ej.: Bayahíbe, La Romana" className="h-11 text-sm" {...control} />
          )}
        </Campo>
        <Campo id="exc-punto" etiqueta="Punto exacto de encuentro" opcional>
          {(control) => (
            <Input
              name="puntoSalida"
              value={v.puntoSalida}
              onChange={(e) => poner({ puntoSalida: e.target.value })}
              placeholder="Ej.: Muelle Principal de Bayahíbe, frente al faro"
              className="h-11 text-sm"
              {...control}
            />
          )}
        </Campo>
      </div>
    </div>
  )
}

/** INCLUSIONES Y POLÍTICAS: qué incluye, qué no, y las recomendaciones. */
export function SeccionIncluye({ v, poner }: SeccionProps) {
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <h3 className="flex items-center gap-2 text-base font-bold text-foreground sm:text-lg">
        <Info className="h-5 w-5 text-primary" aria-hidden />
        Inclusiones y políticas
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="exc-incluye" etiqueta="¿Qué incluye?" opcional>
          {(control) => (
            <Textarea
              name="incluye"
              value={v.incluye}
              onChange={(e) => poner({ incluye: e.target.value })}
              placeholder="Transporte en lancha, almuerzo buffet, bebidas abiertas, chalecos, guía certificado…"
              rows={3}
              className="resize-y text-sm"
              {...control}
            />
          )}
        </Campo>
        <Campo id="exc-noincluye" etiqueta="¿Qué NO incluye?" opcional>
          {(control) => (
            <Textarea
              name="noIncluye"
              value={v.noIncluye}
              onChange={(e) => poner({ noIncluye: e.target.value })}
              placeholder="Propinas, fotos profesionales, compras personales…"
              rows={3}
              className="resize-y text-sm"
              {...control}
            />
          )}
        </Campo>
      </div>
      <Campo id="exc-politicas" etiqueta="Políticas y recomendaciones" opcional>
        {(control) => (
          <Textarea
            name="politicas"
            value={v.politicas}
            onChange={(e) => poner({ politicas: e.target.value })}
            placeholder="Llevar protector solar, toalla, traje de baño. Cancelaciones con 24h de anticipación…"
            rows={3}
            className="resize-y text-sm"
            {...control}
          />
        )}
      </Campo>
    </div>
  )
}
