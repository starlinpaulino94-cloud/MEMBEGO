'use client'

import type { ReactNode } from 'react'
import { BedDouble, Building2, Clock, MapPin, Ticket } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { PasoProps } from './tipos'

/** Una etiqueta con su icono: el icono acompaña, no sustituye al texto. */
function Etiqueta({ icono, children }: { icono: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icono} {children}
    </span>
  )
}

const ICONO = 'h-3.5 w-3.5 shrink-0'

/**
 * PASO 6 · voucher de agencia, recogida en el hotel y notas. Plegable: los campos de logística siguen EN el formulario aunque
 * estén plegados (`hidden`), así que lo escrito antes de plegarlos se envía igual.
 */
export function PasoLogistica({ v, poner }: Pick<PasoProps, 'v' | 'poner'>) {
  return (
    <section
      aria-labelledby="paso-logistica"
      className="w-full min-w-0 max-w-full space-y-4 overflow-hidden rounded-2xl border border-primary/25 bg-primary/5 p-4 shadow-sm sm:p-6"
    >
      <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 id="paso-logistica" className="truncate text-base font-bold text-foreground">
              Voucher de agencia y logística de hotel
            </h3>
            <p className="truncate text-xs text-muted-foreground">Para turoperadores, hoteles o recogida en lobby</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={v.mostrarLogistica}
          aria-controls="reserva-logistica"
          onClick={() => poner({ mostrarLogistica: !v.mostrarLogistica })}
          className="h-9 min-h-[36px] w-full shrink-0 cursor-pointer bg-background text-xs sm:w-auto"
        >
          {v.mostrarLogistica ? 'Ocultar campos' : 'Completar logística'}
        </Button>
      </div>

      <div id="reserva-logistica" hidden={!v.mostrarLogistica} className="w-full min-w-0 space-y-4 border-t border-primary/15 pt-2">
        <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo id="reserva-voucher" etiqueta={<Etiqueta icono={<Ticket className={ICONO} aria-hidden />}>Voucher o localizador de agencia</Etiqueta>} opcional>
            {(control) => (
              <Input
                name="voucherAgencia"
                value={v.voucherAgencia}
                onChange={(e) => poner({ voucherAgencia: e.target.value.toUpperCase() })}
                placeholder="Ej: TO-88492-RD"
                className="h-11 w-full bg-background font-mono text-sm uppercase"
                {...control}
              />
            )}
          </Campo>
          <Campo id="reserva-hotel" etiqueta={<Etiqueta icono={<Building2 className={ICONO} aria-hidden />}>Hotel o complejo de recogida</Etiqueta>} opcional>
            {(control) => (
              <Input name="hotelRecogida" value={v.hotelRecogida} onChange={(e) => poner({ hotelRecogida: e.target.value })} placeholder="Ej: Hard Rock Hotel Punta Cana" className="h-11 w-full bg-background text-sm" {...control} />
            )}
          </Campo>
        </div>

        <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
          <Campo id="reserva-lobby" etiqueta={<Etiqueta icono={<MapPin className={ICONO} aria-hidden />}>Lobby o puerta</Etiqueta>} opcional>
            {(control) => (
              <Input name="lobbyRecogida" value={v.lobbyRecogida} onChange={(e) => poner({ lobbyRecogida: e.target.value })} placeholder="Ej: Lobby principal" className="h-11 w-full bg-background text-sm" {...control} />
            )}
          </Campo>
          <Campo id="reserva-hora-recogida" etiqueta={<Etiqueta icono={<Clock className={ICONO} aria-hidden />}>Hora de recogida</Etiqueta>} opcional>
            {(control) => (
              <Input name="horaRecogida" type="time" value={v.horaRecogida} onChange={(e) => poner({ horaRecogida: e.target.value })} className="h-11 w-full bg-background font-mono text-sm" {...control} />
            )}
          </Campo>
          <Campo id="reserva-habitacion" etiqueta={<Etiqueta icono={<BedDouble className={ICONO} aria-hidden />}>Habitación</Etiqueta>} opcional>
            {(control) => (
              <Input name="habitacion" value={v.habitacion} onChange={(e) => poner({ habitacion: e.target.value })} placeholder="Ej: 1402" className="h-11 w-full bg-background text-sm" {...control} />
            )}
          </Campo>
        </div>
      </div>

      <Campo id="reserva-notas" etiqueta="Notas de la reserva o solicitudes especiales" opcional>
        {(control) => (
          <Input name="notas" value={v.notas} onChange={(e) => poner({ notas: e.target.value })} placeholder="Alergias, idiomas, solicitudes de asientos, etc." className="h-11 w-full bg-background text-sm" {...control} />
        )}
      </Campo>
    </section>
  )
}
