'use client'

/**
 * App Car Wash — ficha de un cliente: sus carros y su historial de lavados.
 *
 * ESTO ES LO QUE SUSTITUYE AL CUADERNO. "¿Cuántas veces ha venido este señor?
 * ¿Cuánto ha gastado? ¿Qué carro trae?" — tres preguntas que hoy se responden
 * de memoria y aquí se responden solas.
 *
 * En un cliente de mostrador aparece además la opción de VINCULARLO con su
 * cuenta si un día se registra. Sin eso, el cliente que lleva dos años lavando
 * aquí se registra y el sistema lo trata como nuevo.
 */

import { useActionState, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Car, Link2, Loader2, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  editarClienteMostrador,
  agregarVehiculo,
  vincularConCuenta,
  buscarParaPista,
  type MostradorState,
} from '@/modules/carwash/mostrador-actions'
import type { FichaMostrador } from '@/modules/carwash/mostrador'

const initial: MostradorState = {}

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtFecha(d: Date) {
  return new Intl.DateTimeFormat('es-DO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(d))
}

function useAviso(state: MostradorState) {
  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])
}

export function FichaCliente({
  ficha,
  tipos,
}: {
  ficha: FichaMostrador
  tipos: { id: string; nombre: string }[]
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Visitas" valor={String(ficha.totales.visitas)} pie="veces que ha venido" destacar />
        <Kpi label="Facturado" valor={fmtRD(ficha.totales.facturado)} pie="en servicios entregados" />
        <Kpi label="Vehículos" valor={String(ficha.vehiculos.length)} pie="registrados" />
        <Kpi
          label="Cliente desde"
          valor={new Intl.DateTimeFormat('es-DO', { month: 'short', year: 'numeric' }).format(
            new Date(ficha.createdAt)
          )}
          pie={ficha.esLocal ? 'de mostrador' : 'con cuenta'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-6">
          {ficha.esLocal && <Datos ficha={ficha} />}
          <Vehiculos ficha={ficha} tipos={tipos} />
          {ficha.esLocal && <Vincular ficha={ficha} />}
        </div>

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Historial de lavados
          </h2>
          {ficha.visitas.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Todavía no ha pasado por la pista.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Fecha</th>
                    <th className="px-4 py-3 font-semibold">Placa</th>
                    <th className="px-4 py-3 font-semibold">Servicios</th>
                    <th className="px-4 py-3 font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {ficha.visitas.map((v) => (
                    <tr key={v.id} className={v.estado === 'CANCELADO' ? 'opacity-50' : ''}>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {fmtFecha(v.fecha)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs uppercase text-muted-foreground">
                        {v.placa ?? '—'}
                      </td>
                      <td className="max-w-64 truncate px-4 py-3 text-muted-foreground">
                        {v.servicios.join(' + ') || '—'}
                        {v.estado !== 'ENTREGADO' && (
                          <span className="ml-2 text-xs uppercase">({v.estado})</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums text-foreground">
                        {v.total > 0 ? fmtRD(v.total) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Kpi({
  label,
  valor,
  pie,
  destacar,
}: {
  label: string
  valor: string
  pie: string
  destacar?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        destacar ? 'border-primary/40 bg-primary/5' : 'border-border/70 bg-card'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold tabular-nums text-foreground">{valor}</p>
      <p className="text-xs text-muted-foreground">{pie}</p>
    </div>
  )
}

function Datos({ ficha }: { ficha: FichaMostrador }) {
  const [state, formAction, pending] = useActionState(editarClienteMostrador, initial)
  useAviso(state)
  return (
    <form action={formAction} className="space-y-3 rounded-2xl border border-border/70 bg-card p-5">
      <input type="hidden" name="id" value={ficha.id} />
      <h2 className="text-sm font-bold text-foreground">Datos</h2>
      <Input aria-label="Nombre del cliente" name="nombre" required maxLength={80} defaultValue={ficha.nombre} className="min-h-11" />
      <Input
        aria-label="Teléfono del cliente"
        name="telefono"
        maxLength={30}
        inputMode="tel"
        defaultValue={ficha.telefono ?? ''}
        placeholder="Teléfono"
        className="min-h-11"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={pending} className="gap-1.5">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
      </Button>
    </form>
  )
}

function Vehiculos({
  ficha,
  tipos,
}: {
  ficha: FichaMostrador
  tipos: { id: string; nombre: string }[]
}) {
  const [state, formAction, pending] = useActionState(agregarVehiculo, initial)
  const [abierto, setAbierto] = useState(false)
  useAviso(state)

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Car className="h-4 w-4" /> Vehículos
        </h2>
        <Button size="sm" variant="ghost" onClick={() => setAbierto((v) => !v)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {ficha.vehiculos.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Sin vehículos registrados.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {ficha.vehiculos.map((v) => (
            <li key={v.id} className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="font-mono text-sm font-bold uppercase text-foreground">
                {v.placa || 'sin placa'}
              </p>
              <p className="text-xs text-muted-foreground">
                {[v.marca, v.modelo, v.tipo].filter(Boolean).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}

      {abierto && (
        <form action={formAction} className="mt-3 space-y-2 border-t border-border/60 pt-3">
          <input type="hidden" name="clienteId" value={ficha.id} />
          <Input
            aria-label="Placa del vehículo"
            name="placa"
            maxLength={20}
            placeholder="Placa"
            className="min-h-11 uppercase"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label="Marca" name="marca" maxLength={40} placeholder="Marca" className="min-h-11" />
            <Input aria-label="Modelo" name="modelo" maxLength={40} placeholder="Modelo" className="min-h-11" />
            <Input aria-label="Color" name="color" maxLength={30} placeholder="Color" className="min-h-11" />
            <Input aria-label="Año" name="anio" inputMode="numeric" placeholder="Año" className="min-h-11" />
          </div>
          {tipos.length > 0 && (
            <select
              aria-label="Tipo de vehículo"
              name="tipoVehiculoId"
              defaultValue=""
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">Tipo de vehículo</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          )}
          <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Agregar vehículo
          </Button>
        </form>
      )}
    </section>
  )
}

function Vincular({ ficha }: { ficha: FichaMostrador }) {
  const [state, formAction, pending] = useActionState(vincularConCuenta, initial)
  const [q, setQ] = useState('')
  const [candidatos, setCandidatos] = useState<
    { id: string; nombre: string; telefono: string | null; esLocal: boolean }[] | null
  >(null)
  const [destino, setDestino] = useState<{ id: string; nombre: string } | null>(null)
  const [buscando, start] = useTransition()
  useAviso(state)

  function buscar() {
    const termino = q.trim()
    if (termino.length < 2) {
      toast.error('Escribe al menos dos letras.')
      return
    }
    start(async () => {
      const r = await buscarParaPista(termino)
      // Solo cuentas reales: vincular con otro cliente de mostrador no une nada
      // con una cuenta, que es el punto de esta acción.
      const conCuenta = r.filter((c) => !c.esLocal)
      setCandidatos(conCuenta)
      if (conCuenta.length === 0) toast.error('No hay clientes con cuenta que coincidan.')
    })
  }

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
        <Link2 className="h-4 w-4" /> Vincular con su cuenta
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Si esta persona se registró en la plataforma, une las dos fichas. Su historial de lavados
        pasa a la cuenta y no se pierde.
      </p>

      {destino ? (
        <form action={formAction} className="mt-3 space-y-2">
          <input type="hidden" name="localId" value={ficha.id} />
          <input type="hidden" name="destinoId" value={destino.id} />
          <p className="rounded-lg bg-muted/40 p-3 text-sm text-foreground">
            Se unirá el historial de <b>{ficha.nombre}</b> a la cuenta de <b>{destino.nombre}</b>.
            Esto no se puede deshacer.
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDestino(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="mt-3 flex gap-2">
            <Input
              aria-label="Buscar cliente"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  buscar()
                }
              }}
              placeholder="Buscar su cuenta"
              className="min-h-11"
            />
            <Button
              type="button"
              size="sm"
              disabled={buscando}
              onClick={buscar}
              className="min-h-11 shrink-0"
            >
              {buscando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>

          {candidatos && candidatos.length > 0 && (
            <ul className="mt-2 space-y-1">
              {candidatos.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setDestino({ id: c.id, nombre: c.nombre })}
                    className="w-full rounded-lg bg-muted/40 px-3 py-2 text-left text-sm hover:bg-primary/5"
                  >
                    <span className="block truncate font-medium text-foreground">{c.nombre}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.telefono ?? 'Sin teléfono'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
