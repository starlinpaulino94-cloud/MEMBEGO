'use client'

import { Info, Mail, Phone, User } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import type { ClienteOpcion } from '@/modules/excursiones/reservas/formulario'
import { ClienteBuscador, type ResultadoBusqueda } from './ClienteBuscador'
import { Paso } from './Paso'
import type { PasoProps } from './tipos'

const PESTANA = 'rounded-lg px-3 py-2 text-center font-bold transition'

/**
 * PASO 4 · el pasajero principal: un cliente que ya existe (se BUSCA) o uno nuevo (nombre y correo). Lo que se manda al
 * servidor: `modoCliente` dice cuál de los dos aplica; el existente va como `clienteId`; el nuevo, con sus tres campos.
 */
export function PasoCliente({ v, poner, errores, buscar }: PasoProps & { buscar: (q: string) => Promise<ResultadoBusqueda> }) {
  const elegir = (cliente: ClienteOpcion) => poner({ cliente })
  const nuevo = v.modoCliente === 'NUEVO'

  return (
    <Paso
      numero={4}
      id="paso-cliente"
      titulo="Datos del pasajero principal"
      aside={
        <div className="grid w-full shrink-0 grid-cols-2 rounded-xl bg-muted p-1 text-xs sm:w-auto">
          <button
            type="button"
            aria-pressed={!nuevo}
            onClick={() => poner({ modoCliente: 'EXISTENTE' })}
            className={`${PESTANA} ${!nuevo ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Cliente existente
          </button>
          <button
            type="button"
            aria-pressed={nuevo}
            onClick={() => poner({ modoCliente: 'NUEVO' })}
            className={`${PESTANA} ${nuevo ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Nuevo cliente
          </button>
        </div>
      }
    >
      <input type="hidden" name="modoCliente" value={v.modoCliente} />

      {!nuevo ? (
        <>
          {v.cliente && <input type="hidden" name="clienteId" value={v.cliente.id} />}
          <ClienteBuscador
            buscar={buscar}
            seleccionado={v.cliente}
            alElegir={elegir}
            alLimpiar={() => poner({ cliente: null })}
            alCrearNuevo={(texto) =>
              // Lo que se buscó pasa al formulario del cliente nuevo: un correo va al correo; lo demás, al nombre.
              poner({
                modoCliente: 'NUEVO',
                clienteNombre: /@/.test(texto) ? v.clienteNombre : texto,
                clienteEmail: /@/.test(texto) ? texto : v.clienteEmail,
              })
            }
            error={errores.clienteId}
          />
        </>
      ) : (
        <div className="w-full min-w-0 space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span>
              Si el cliente no está registrado o ya existe en otra empresa de MembeGo, se le vinculará automáticamente a tu negocio y se le enviará su pase digital.
            </span>
          </div>

          <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
            <Campo id="reserva-cliente-nombre" etiqueta="Nombre y apellido" error={errores.clienteNombre}>
              {(control) => (
                <div className="relative w-full min-w-0">
                  <User className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    name="clienteNombre"
                    value={v.clienteNombre}
                    onChange={(e) => poner({ clienteNombre: e.target.value })}
                    placeholder="Ej: Laura Méndez"
                    autoComplete="off"
                    className="h-12 w-full bg-background pl-9 text-sm font-medium"
                    required
                    {...control}
                  />
                </div>
              )}
            </Campo>
            <Campo id="reserva-cliente-email" etiqueta="Correo electrónico" error={errores.clienteEmail}>
              {(control) => (
                <div className="relative w-full min-w-0">
                  <Mail className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    name="clienteEmail"
                    type="email"
                    value={v.clienteEmail}
                    onChange={(e) => poner({ clienteEmail: e.target.value })}
                    placeholder="cliente@ejemplo.com"
                    autoComplete="off"
                    className="h-12 w-full bg-background pl-9 text-sm font-medium"
                    required
                    {...control}
                  />
                </div>
              )}
            </Campo>
            <Campo id="reserva-cliente-telefono" etiqueta="Teléfono" opcional>
              {(control) => (
                <div className="relative w-full min-w-0">
                  <Phone className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    name="clienteTelefono"
                    type="tel"
                    value={v.clienteTelefono}
                    onChange={(e) => poner({ clienteTelefono: e.target.value })}
                    placeholder="+1 809 000 0000"
                    autoComplete="off"
                    className="h-12 w-full bg-background pl-9 text-sm font-medium"
                    {...control}
                  />
                </div>
              )}
            </Campo>
          </div>
        </div>
      )}
    </Paso>
  )
}
