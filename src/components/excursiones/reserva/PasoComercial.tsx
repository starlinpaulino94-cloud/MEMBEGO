'use client'

import { BadgePercent } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import type { VendedorOpcion } from '@/modules/excursiones/reservas/formulario'
import { Paso } from './Paso'
import type { PasoProps } from './tipos'

const SELECT =
  'flex h-12 w-full truncate rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive'

const CANALES: { valor: string; texto: string }[] = [
  { valor: 'MOSTRADOR', texto: 'Mostrador / en punto' },
  { valor: 'WHATSAPP', texto: 'WhatsApp' },
  { valor: 'TELEFONO', texto: 'Llamada telefónica' },
  { valor: 'AGENCIA', texto: 'Agencia / touroperador' },
  { valor: 'HOTEL', texto: 'Hotel concierge' },
  { valor: 'WEB', texto: 'Web / portal directo' },
]

/** PASO 5 · a quién se le atribuye la venta, por qué canal llegó y si lleva descuento. */
export function PasoComercial({
  v,
  poner,
  errores,
  vendedores,
  moneda,
}: PasoProps & { vendedores: VendedorOpcion[]; moneda: string }) {
  return (
    <Paso numero={5} id="paso-comercial" titulo="Atribución comercial y descuentos">
      <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
        <Campo id="reserva-vendedor" etiqueta="Vendedor o agente" opcional>
          {(control) => (
            <select name="vendedorId" value={v.vendedorId} onChange={(e) => poner({ vendedorId: e.target.value })} className={SELECT} {...control}>
              <option value="">Venta directa (sin vendedor)</option>
              {vendedores
                .filter((x) => x.estado !== 'INACTIVO')
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre} {x.apellido} ({x.codigo}) {x.tipo ? `· ${x.tipo}` : ''}
                  </option>
                ))}
            </select>
          )}
        </Campo>

        <Campo id="reserva-canal" etiqueta="Canal de venta">
          {(control) => (
            <select name="canal" value={v.canal} onChange={(e) => poner({ canal: e.target.value })} className={SELECT} {...control}>
              {CANALES.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.texto}
                </option>
              ))}
            </select>
          )}
        </Campo>

        <Campo id="reserva-descuento" etiqueta={`Descuento comercial (${moneda})`} opcional error={errores.descuento}>
          {(control) => (
            <div className="relative w-full min-w-0">
              <BadgePercent className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input
                name="descuento"
                type="number"
                min="0"
                step="0.01"
                value={v.descuento}
                onChange={(e) => poner({ descuento: e.target.value })}
                placeholder="0.00"
                className="h-12 w-full bg-background pl-9 text-sm font-medium"
                {...control}
              />
            </div>
          )}
        </Campo>
      </div>
    </Paso>
  )
}
