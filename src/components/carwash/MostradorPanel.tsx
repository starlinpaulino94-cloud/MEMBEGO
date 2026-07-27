'use client'

/**
 * App Car Wash — clientes de mostrador.
 *
 * QUÉ HACE ÚTIL ESTA PANTALLA: buscar por PLACA. El encargado no recuerda
 * nombres, recuerda carros. Si busca "A123456" y aparece "Juan Pérez · 12
 * visitas", el sistema acaba de sustituir al cuaderno.
 *
 * El alta pide solo nombre. Todo lo demás es opcional: exigir correo o cédula
 * en la puerta de una pista es la forma más rápida de que nadie lo use.
 */

import { useActionState, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Search, UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  crearClienteMostrador,
  buscarParaPista,
  type MostradorState,
} from '@/modules/carwash/mostrador-actions'

const initial: MostradorState = {}

export interface ClienteReciente {
  id: string
  nombre: string
  telefono: string | null
  createdAt: Date
  placas: (string | null)[]
  visitas: number
}

function fmtFecha(d: Date) {
  return new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(d)
  )
}

export function MostradorPanel({
  recientes,
  tipos,
}: {
  recientes: ClienteReciente[]
  tipos: { id: string; nombre: string }[]
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <FormAlta tipos={tipos} />

      <div className="space-y-6">
        <Buscador />

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Últimos registrados en mostrador
          </h2>
          {recientes.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              <Users className="mx-auto mb-2 h-7 w-7 opacity-40" />
              Todavía no has registrado clientes de mostrador. También puedes darlos de alta desde
              la pantalla de la pista, sin salir de ahí.
            </p>
          ) : (
            <div className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/70 bg-card">
              {recientes.map((c) => (
                <Link
                  key={c.id}
                  href={`/admin/app/carwash/clientes/${c.id}`}
                  className="flex items-center justify-between gap-3 p-3 hover:bg-primary/5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{c.nombre}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        c.telefono,
                        c.placas.filter(Boolean).join(' · '),
                        `desde ${fmtFecha(c.createdAt)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {c.visitas} visita{c.visitas === 1 ? '' : 's'}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function FormAlta({ tipos }: { tipos: { id: string; nombre: string }[] }) {
  const [state, formAction, pending] = useActionState(crearClienteMostrador, initial)

  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])

  const input = 'min-h-11'

  return (
    <form
      action={formAction}
      className="h-fit space-y-3 rounded-2xl border border-border/70 bg-card p-5"
    >
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
        <UserPlus className="h-4 w-4" /> Nuevo cliente de mostrador
      </h2>
      <p className="text-xs text-muted-foreground">
        Para quien viene a lavar sin cuenta en la plataforma. Solo el nombre es obligatorio.
      </p>

      <Input name="nombre" required maxLength={80} placeholder="Nombre" className={input} />
      <Input
        name="telefono"
        maxLength={30}
        inputMode="tel"
        placeholder="Teléfono (opcional)"
        className={input}
      />

      <div className="border-t border-border/60 pt-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Su vehículo (opcional)</p>
        <Input
          name="placa"
          maxLength={20}
          placeholder="Placa"
          className={`${input} uppercase`}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Input name="marca" maxLength={40} placeholder="Marca" className={input} />
          <Input name="modelo" maxLength={40} placeholder="Modelo" className={input} />
          <Input name="color" maxLength={30} placeholder="Color" className={input} />
          <Input name="anio" inputMode="numeric" placeholder="Año" className={input} />
        </div>
        {tipos.length > 0 && (
          <select
            name="tipoVehiculoId"
            defaultValue=""
            className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Tipo de vehículo (define el precio)</option>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        )}
      </div>

      <Button type="submit" disabled={pending} className="w-full gap-1.5">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} Registrar cliente
      </Button>
    </form>
  )
}

interface Encontrado {
  id: string
  nombre: string
  telefono: string | null
  esLocal: boolean
  placas: string[]
}

function Buscador() {
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<Encontrado[] | null>(null)
  const [buscando, start] = useTransition()

  function buscar() {
    const termino = q.trim()
    if (termino.length < 2) {
      toast.error('Escribe al menos dos letras.')
      return
    }
    start(async () => {
      setResultados(await buscarParaPista(termino))
    })
  }

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5">
      <h2 className="text-sm font-bold text-foreground">Buscar cliente</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Por nombre, teléfono o <b>placa</b>. Busca entre todos: los de mostrador y los que tienen
        cuenta.
      </p>
      <div className="mt-3 flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              buscar()
            }
          }}
          placeholder="A123456, Juan, 809…"
          className="min-h-11"
        />
        <Button type="button" disabled={buscando} onClick={buscar} className="min-h-11 shrink-0">
          {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      {resultados != null && (
        <div className="mt-3">
          {resultados.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nadie con eso. Puedes registrarlo con el formulario de la izquierda.
            </p>
          ) : (
            <ul className="space-y-1">
              {resultados.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/app/carwash/clientes/${c.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 hover:bg-primary/5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {c.nombre}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[c.telefono, c.placas.join(' · ')].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        c.esLocal
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-success/15 text-success'
                      }`}
                    >
                      {c.esLocal ? 'mostrador' : 'con cuenta'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
