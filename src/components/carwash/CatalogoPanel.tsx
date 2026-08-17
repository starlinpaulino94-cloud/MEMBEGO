'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Power, Car, Sparkles, LayoutGrid } from 'lucide-react'
import {
  guardarTipoVehiculo,
  guardarServicio,
  guardarBahia,
  alternarTipoVehiculo,
  alternarServicio,
  alternarBahia,
} from '@/modules/carwash/catalogo-actions'
import type { TipoVehiculoItem, ServicioItem, BahiaItem } from '@/modules/carwash/catalogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Configuración del catálogo del oficio: tipos de vehículo, servicios con su
 * tarifa por tipo, y bahías.
 *
 * El orden de las tres secciones NO es casual: sin tipos de vehículo no se
 * puede poner precio a un servicio, así que se configuran primero y la
 * sección de servicios lo dice explícitamente si faltan.
 */

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(n)
}

type Seccion = 'tipos' | 'servicios' | 'bahias'

export function CatalogoPanel({
  tipos,
  servicios,
  bahias,
  sucursales,
}: {
  tipos: TipoVehiculoItem[]
  servicios: ServicioItem[]
  bahias: BahiaItem[]
  sucursales: { id: string; nombre: string }[]
}) {
  const [seccion, setSeccion] = useState<Seccion>('tipos')
  const [pending, startTransition] = useTransition()
  const [editando, setEditando] = useState<string | null>(null)

  const tiposActivos = tipos.filter((t) => t.activo)

  function accion(fn: () => Promise<{ error?: string; success?: string }>) {
    startTransition(async () => {
      const r = await fn()
      if (r.error) toast.error(r.error)
      else if (r.success) toast.success(r.success)
    })
  }

  function enviar(fn: typeof guardarTipoVehiculo, formData: FormData) {
    startTransition(async () => {
      const r = await fn({}, formData)
      if (r.error) toast.error(r.error)
      else if (r.success) {
        toast.success(r.success)
        setEditando(null)
      }
    })
  }

  const tabs: { id: Seccion; label: string; icon: typeof Car; n: number }[] = [
    { id: 'tipos', label: 'Tipos de vehículo', icon: Car, n: tipos.length },
    { id: 'servicios', label: 'Servicios y precios', icon: Sparkles, n: servicios.length },
    { id: 'bahias', label: 'Bahías', icon: LayoutGrid, n: bahias.length },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setSeccion(t.id)
              setEditando(null)
            }}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              seccion === t.id
                ? 'bg-foreground text-background'
                : 'border border-border/70 text-muted-foreground hover:bg-muted/60'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
            <span className="opacity-60">{t.n}</span>
          </button>
        ))}
      </div>

      {/* ── Tipos de vehículo ───────────────────────────────────────────── */}
      {seccion === 'tipos' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            El tipo de vehículo define el precio de cada servicio. Empieza por aquí:
            sin tipos no se pueden poner tarifas.
          </p>

          {/*
            El nivel no se explica solo, y de él depende dinero. Sin esta nota
            alguien deja todos los tipos en 1 —el valor de fábrica— y luego no
            entiende por qué un plan de sedán le cubre camionetas.
          */}
          <p className="rounded-2xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
            El <b>nivel</b> es lo que decide qué cubre cada plan: un plan de nivel 2
            cubre los vehículos de nivel 1 y 2, y no los de 3. Lo usan también los
            sistemas conectados —como el car wash— para calcular la diferencia que
            paga un cliente cuyo carro se sale de su plan.{' '}
            <b>Mientras todos los tipos estén en 1, cualquier plan cubre cualquier
            vehículo.</b>
          </p>

          <form
            action={(fd) => enviar(guardarTipoVehiculo, fd)}
            className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-card p-4"
          >
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="t-nombre">Nombre del tipo</Label>
              <Input
                id="t-nombre"
                name="nombre"
                required
                maxLength={60}
                placeholder="Ej. Sedán, Jeepeta, Camioneta"
              />
            </div>
            <div className="w-24 space-y-1.5">
              <Label htmlFor="t-orden">Orden</Label>
              <Input id="t-orden" name="orden" inputMode="numeric" defaultValue={tipos.length} />
            </div>
            <div className="w-24 space-y-1.5">
              <Label htmlFor="t-nivel">Nivel</Label>
              <Input
                id="t-nivel"
                name="nivelTarifario"
                type="number"
                min={1}
                max={9}
                inputMode="numeric"
                defaultValue={1}
              />
            </div>
            <Button type="submit" disabled={pending} className="gap-1.5">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Agregar
            </Button>
          </form>

          {tipos.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Todavía no hay tipos de vehículo.
            </p>
          ) : (
            <div className="divide-y divide-border/50 rounded-2xl border border-border/70 bg-card">
              {tipos.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p
                      className={`font-semibold ${t.activo ? 'text-foreground' : 'text-muted-foreground line-through'}`}
                    >
                      {t.nombre}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.serviciosConPrecio} servicio{t.serviciosConPrecio !== 1 ? 's' : ''} con
                      precio
                    </p>
                  </div>

                  {/*
                    El nivel se edita EN LA FILA, con su propio formulario. La
                    lista solo permitía activar y desactivar, así que el nivel de
                    un tipo ya creado no había forma de cambiarlo — y es el dato
                    que decide la cobertura.

                    Van `nombre` y `orden` ocultos porque la acción los exige:
                    mandarla sin ellos rechazaría el guardado por «falta el
                    nombre» al intentar cambiar solo el número.
                  */}
                  <form
                    action={(fd) => enviar(guardarTipoVehiculo, fd)}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="nombre" value={t.nombre} />
                    <input type="hidden" name="orden" value={t.orden} />
                    <Label htmlFor={`nivel-${t.id}`} className="text-xs text-muted-foreground">
                      Nivel
                    </Label>
                    <Input
                      id={`nivel-${t.id}`}
                      name="nivelTarifario"
                      type="number"
                      min={1}
                      max={9}
                      inputMode="numeric"
                      defaultValue={t.nivelTarifario}
                      disabled={pending}
                      className="w-16 text-center"
                      aria-label={`Nivel tarifario de ${t.nombre}`}
                    />
                    <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                      Guardar
                    </Button>
                  </form>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => accion(() => alternarTipoVehiculo(t.id))}
                    className="gap-1.5"
                  >
                    <Power className="h-4 w-4" />
                    {t.activo ? 'Desactivar' : 'Activar'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Servicios y precios ─────────────────────────────────────────── */}
      {seccion === 'servicios' && (
        <div className="space-y-4">
          {tiposActivos.length === 0 ? (
            <p className="rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm text-foreground">
              Primero crea al menos un <b>tipo de vehículo</b>: el precio de un servicio se
              define por tipo.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Deja el precio <b>vacío</b> si ese servicio no aplica a ese tipo de vehículo.
              </p>

              <form
                action={(fd) => enviar(guardarServicio, fd)}
                className="space-y-4 rounded-2xl border border-border/70 bg-card p-4"
              >
                {editando && <input type="hidden" name="id" value={editando} />}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1.5 lg:col-span-2">
                    <Label htmlFor="s-nombre">Servicio *</Label>
                    <Input
                      id="s-nombre"
                      name="nombre"
                      required
                      maxLength={80}
                      defaultValue={servicios.find((s) => s.id === editando)?.nombre ?? ''}
                      placeholder="Ej. Lavado básico, Detallado completo"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="s-cat">Categoría</Label>
                    <Input
                      id="s-cat"
                      name="categoria"
                      maxLength={40}
                      defaultValue={servicios.find((s) => s.id === editando)?.categoria ?? ''}
                      placeholder="Lavado"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="s-dur">Duración (min)</Label>
                    <Input
                      id="s-dur"
                      name="duracionMin"
                      inputMode="numeric"
                      defaultValue={servicios.find((s) => s.id === editando)?.duracionMin ?? 30}
                    />
                  </div>
                </div>

                <fieldset className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
                  <legend className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Precio por tipo de vehículo
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {tiposActivos.map((t) => (
                      <div key={t.id} className="space-y-1.5">
                        <Label htmlFor={`p-${t.id}`}>{t.nombre}</Label>
                        <Input
                          id={`p-${t.id}`}
                          name={`precio_${t.id}`}
                          inputMode="decimal"
                          defaultValue={
                            servicios.find((s) => s.id === editando)?.precios[t.id] ?? ''
                          }
                          placeholder="—"
                        />
                      </div>
                    ))}
                  </div>
                </fieldset>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      name="esAdicional"
                      defaultChecked={servicios.find((s) => s.id === editando)?.esAdicional}
                      className="h-4 w-4 rounded border-border"
                    />
                    Es un extra (se suma a un servicio principal)
                  </label>
                  <Button type="submit" disabled={pending} className="ml-auto gap-1.5">
                    {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {editando ? 'Guardar cambios' : 'Agregar servicio'}
                  </Button>
                  {editando && (
                    <Button type="button" variant="ghost" onClick={() => setEditando(null)}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </form>

              {servicios.length > 0 && (
                <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-semibold">Servicio</th>
                        {tiposActivos.map((t) => (
                          <th key={t.id} className="px-4 py-3 text-right font-semibold">
                            {t.nombre}
                          </th>
                        ))}
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {servicios.map((s) => (
                        <tr key={s.id} className="hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <p
                              className={`font-semibold ${s.activo ? 'text-foreground' : 'text-muted-foreground line-through'}`}
                            >
                              {s.nombre}
                              {s.esAdicional && (
                                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                                  extra
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {s.categoria ? `${s.categoria} · ` : ''}
                              {s.duracionMin} min
                            </p>
                          </td>
                          {tiposActivos.map((t) => (
                            <td
                              key={t.id}
                              className="px-4 py-3 text-right tabular-nums text-foreground"
                            >
                              {s.precios[t.id] != null ? (
                                fmtRD(s.precios[t.id])
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          ))}
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditando(s.id)}
                            >
                              Editar
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => accion(() => alternarServicio(s.id))}
                            >
                              <Power className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Bahías ──────────────────────────────────────────────────────── */}
      {seccion === 'bahias' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Los puestos de trabajo de la pista. Son lo que la pantalla principal muestra
            como ocupado o libre.
          </p>

          <form
            action={(fd) => enviar(guardarBahia, fd)}
            className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-card p-4"
          >
            <div className="min-w-40 flex-1 space-y-1.5">
              <Label htmlFor="b-nombre">Nombre</Label>
              <Input id="b-nombre" name="nombre" required maxLength={40} placeholder="Bahía 1" />
            </div>
            {sucursales.length > 1 && (
              <div className="min-w-40 space-y-1.5">
                <Label htmlFor="b-suc">Sucursal</Label>
                <select
                  id="b-suc"
                  name="sucursalId"
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="">Sin asignar</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="w-24 space-y-1.5">
              <Label htmlFor="b-orden">Orden</Label>
              <Input id="b-orden" name="orden" inputMode="numeric" defaultValue={bahias.length} />
            </div>
            <Button type="submit" disabled={pending} className="gap-1.5">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Agregar
            </Button>
          </form>

          {bahias.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Sin bahías configuradas. La pista funciona igual, pero no podrás ver cuál está
              libre.
            </p>
          ) : (
            <div className="divide-y divide-border/50 rounded-2xl border border-border/70 bg-card">
              {bahias.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p
                      className={`font-semibold ${b.activa ? 'text-foreground' : 'text-muted-foreground line-through'}`}
                    >
                      {b.nombre}
                    </p>
                    {b.sucursalNombre && (
                      <p className="text-xs text-muted-foreground">{b.sucursalNombre}</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => accion(() => alternarBahia(b.id))}
                    className="gap-1.5"
                  >
                    <Power className="h-4 w-4" />
                    {b.activa ? 'Desactivar' : 'Activar'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
