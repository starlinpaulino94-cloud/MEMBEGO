'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import {
  cambiarEstadoCategoriaVehiculoAction,
  crearCategoriaVehiculoAction,
  editarCategoriaVehiculoAction,
} from '@/modules/supply-v2/actions-categorias'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { CategoriaVehiculoFila } from '@/modules/supply-v2/categories/queries'

/**
 * MEMBEGO SUPPLY 2.0 · administración de las categorías de vehículo de
 * plataforma.
 *
 * La pantalla explica lo que ningún campo dice por sí mismo: que lo que une
 * este catálogo con las categorías de cada comercio es el NÚMERO, no el
 * nombre. Sin ese texto, un operador razonable asume que «SUV» casa con «SUV»
 * y no entiende por qué una jeepeta cobró como sedán.
 */

function Aviso({ estado }: { estado: EstadoAccion }) {
  if (!estado.error) return null
  return (
    <p className="text-sm text-destructive" role="alert">
      {estado.error}
    </p>
  )
}

function useToast(estado: EstadoAccion) {
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && visto.current !== estado.success) {
      visto.current = estado.success
      toast.success(estado.success)
      router.refresh()
    }
    if (estado.error) toast.error(estado.error)
  }, [estado, router])
}

function FilaCategoria({ c }: { c: CategoriaVehiculoFila }) {
  const [editando, setEditando] = useState(false)
  const [estado, guardar, pendiente] = useActionState<EstadoAccion, FormData>(editarCategoriaVehiculoAction, {})
  const [estadoBaja, cambiarEstado, cambiando] = useActionState<EstadoAccion, FormData>(
    cambiarEstadoCategoriaVehiculoAction,
    {}
  )
  useToast(estado)
  useToast(estadoBaja)

  useEffect(() => {
    if (estado.success) setEditando(false)
  }, [estado.success])

  if (!editando) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
        data-testid={`categoria-${c.code}`}
      >
        <div className="min-w-0">
          <p className="font-medium">
            {c.nombre}{' '}
            <span className="text-caption text-muted-foreground">
              · nivel {c.nivelTarifario} · {c.code}
            </span>
            {!c.activo && <span className="ml-2 text-caption text-muted-foreground">(desactivada)</span>}
          </p>
          {c.descripcion && <p className="text-caption text-muted-foreground">{c.descripcion}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditando(true)} data-testid={`editar-${c.code}`}>
            Editar
          </Button>
          <form action={cambiarEstado}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="activo" value={c.activo ? 'false' : 'true'} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={cambiando}
              loading={cambiando}
              data-testid={`estado-${c.code}`}
            >
              {c.activo ? 'Desactivar' : 'Reactivar'}
            </Button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <form action={guardar} className="space-y-3 rounded-lg border border-primary/40 p-3">
      <input type="hidden" name="id" value={c.id} />
      <p className="text-caption text-muted-foreground">
        El código <strong>{c.code}</strong> no se edita: viaja a semillas e informes, y cambiarlo rompería la
        correspondencia con lo que ya se escribió fuera de la base.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor={`nombre-${c.id}`}>Nombre</Label>
          <Input id={`nombre-${c.id}`} name="nombre" defaultValue={c.nombre} maxLength={60} required />
        </div>
        <div>
          <Label htmlFor={`nivel-${c.id}`}>Nivel tarifario</Label>
          <Input
            id={`nivel-${c.id}`}
            name="nivelTarifario"
            type="number"
            min={1}
            max={999}
            defaultValue={c.nivelTarifario}
            required
          />
        </div>
        <div>
          <Label htmlFor={`orden-${c.id}`}>Orden</Label>
          <Input id={`orden-${c.id}`} name="orden" type="number" min={0} defaultValue={c.orden} />
        </div>
      </div>
      <div>
        <Label htmlFor={`desc-${c.id}`}>Descripción (opcional)</Label>
        <Input id={`desc-${c.id}`} name="descripcion" defaultValue={c.descripcion ?? ''} maxLength={300} />
      </div>
      <Aviso estado={estado} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pendiente} loading={pendiente}>
          Guardar
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditando(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function FormNueva() {
  const [estado, crear, pendiente] = useActionState<EstadoAccion, FormData>(crearCategoriaVehiculoAction, {})
  const [abierto, setAbierto] = useState(false)
  useToast(estado)
  useEffect(() => {
    if (estado.success) setAbierto(false)
  }, [estado.success])

  if (!abierto) {
    return (
      <Button variant="outline" onClick={() => setAbierto(true)} data-testid="btn-nueva-categoria">
        Añadir categoría
      </Button>
    )
  }

  return (
    <form action={crear} className="space-y-3 rounded-lg border border-border p-3" data-testid="form-nueva-categoria">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="nuevaCode">Código</Label>
          <Input id="nuevaCode" name="code" placeholder="PATANA" maxLength={32} required />
          <p className="text-caption text-muted-foreground">Letras sin acentos, números y guión bajo.</p>
        </div>
        <div>
          <Label htmlFor="nuevaNombre">Nombre</Label>
          <Input id="nuevaNombre" name="nombre" placeholder="Patana" maxLength={60} required />
        </div>
        <div>
          <Label htmlFor="nuevaNivel">Nivel tarifario</Label>
          <Input id="nuevaNivel" name="nivelTarifario" type="number" min={1} max={999} required />
        </div>
        <div>
          <Label htmlFor="nuevaOrden">Orden</Label>
          <Input id="nuevaOrden" name="orden" type="number" min={0} defaultValue={0} />
        </div>
      </div>
      <div>
        <Label htmlFor="nuevaDesc">Descripción (opcional)</Label>
        <Input id="nuevaDesc" name="descripcion" maxLength={300} />
      </div>
      <Aviso estado={estado} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pendiente} loading={pendiente}>
          Crear
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

export function PanelCategoriasVehiculo({ categorias }: { categorias: CategoriaVehiculoFila[] }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm font-medium">Lo que une este catálogo con cada comercio es el NÚMERO</p>
          <p className="text-sm text-muted-foreground">
            Cada comercio nombra sus categorías como quiere: lo que uno llama «Jeepeta» otro lo llama «SUV». Membego no
            compara nombres —sería comparar ortografía—, compara el <strong>nivel tarifario</strong>. Si dos comercios
            pusieron su camioneta en nivel 2, los dos cobran el precio del nivel 2 de la oferta.
          </p>
          <p className="text-caption text-muted-foreground">
            Por eso cada nivel admite <strong>una sola</strong> categoría: si hubiera dos, no habría forma de saber qué
            precio aplicar. Y por eso un vehículo cuya categoría esté en un nivel que no aparezca aquí paga el precio
            base de la oferta, nunca el del nivel más parecido.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {categorias.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="sin-categorias">
            No hay ninguna categoría. Mientras el catálogo esté vacío, toda oferta cobra su precio base.
          </p>
        ) : (
          categorias.map((c) => <FilaCategoria key={c.id} c={c} />)
        )}
      </div>

      <FormNueva />
    </div>
  )
}
