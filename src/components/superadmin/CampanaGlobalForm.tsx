'use client'

import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Megaphone, X } from 'lucide-react'
import { crearCampanaGlobal } from '@/modules/superadmin/campanasActions'
import { CAMPANA_TIPOS, CAMPANA_TIPO_LABELS } from '@/modules/superadmin/campanasGlobales'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Alta de una campaña global. La campaña nace en BORRADOR: crear NO reparte
 * nada — el reparto es un segundo paso explícito, para que se pueda revisar
 * antes de tocar la base de datos de varias empresas.
 */
export function CampanaGlobalForm({
  empresas,
}: {
  empresas: { id: string; name: string }[]
}) {
  const [abierto, setAbierto] = useState(false)
  const [modo, setModo] = useState<'COPIA' | 'CADENA'>('COPIA')
  const [tipo, setTipo] = useState<string>('PROMOCION')
  const [todas, setTodas] = useState(true)
  // Eslabones de la cadena. Arrancan en 2 porque una cadena de 1 no es cadena.
  const [pasos, setPasos] = useState<number[]>([0, 1])
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function action(formData: FormData) {
    startTransition(async () => {
      const res = await crearCampanaGlobal({}, formData)
      if (res.success) {
        toast.success(res.success)
        formRef.current?.reset()
        setAbierto(false)
      }
      if (res.error) toast.error(res.error)
    })
  }

  if (!abierto) {
    return (
      <Button type="button" className="gap-1.5" onClick={() => setAbierto(true)}>
        <Megaphone className="h-4 w-4" /> Nueva campaña conjunta
      </Button>
    )
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="space-y-5 rounded-2xl border border-border/70 bg-card p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Nueva campaña conjunta
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Modo: replicar la misma oferta vs. cadena entre negocios distintos */}
      <input type="hidden" name="modo" value={modo} />
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setModo('COPIA')}
          className={`rounded-xl border p-3 text-left transition-colors ${
            modo === 'COPIA' ? 'border-primary bg-primary/5' : 'border-border/70 hover:bg-muted/40'
          }`}
        >
          <span className="block text-sm font-bold text-foreground">Misma oferta en todas</span>
          <span className="block text-xs text-muted-foreground">
            La misma promoción o membresía se crea igual en cada empresa.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setModo('CADENA')}
          className={`rounded-xl border p-3 text-left transition-colors ${
            modo === 'CADENA' ? 'border-primary bg-primary/5' : 'border-border/70 hover:bg-muted/40'
          }`}
        >
          <span className="block text-sm font-bold text-foreground">Cadena entre negocios</span>
          <span className="block text-xs text-muted-foreground">
            Cada empresa da un beneficio distinto y canjear uno desbloquea el siguiente.
          </span>
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="c-nombre">Nombre de la campaña *</Label>
          <Input id="c-nombre" name="nombre" required maxLength={120} placeholder="Ej. Black Friday MembeGo" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-img">Imagen de portada (URL)</Label>
          <Input id="c-img" name="imagenUrl" placeholder="https://..." />
        </div>
        {modo === 'COPIA' && (
        <div className="space-y-1.5">
          <Label htmlFor="c-tipo">¿Qué se crea en cada empresa? *</Label>
          <select
            id="c-tipo"
            name="tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          >
            {CAMPANA_TIPOS.map((t) => (
              <option key={t} value={t}>
                {CAMPANA_TIPO_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        )}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="c-desc">Nota interna (opcional)</Label>
          <Input id="c-desc" name="descripcion" maxLength={500} placeholder="Para qué es esta campaña" />
        </div>
      </div>

      {modo === 'COPIA' && (
        <>
      {/* Plantilla según el tipo */}
      <fieldset className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Lo que verá el cliente en cada empresa
        </legend>

        {tipo === 'PLAN' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-nombre">Nombre del plan</Label>
              <Input id="p-nombre" name="p_nombre" maxLength={120} placeholder="Ej. Plan Aliados" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-precio">Precio (RD$)</Label>
              <Input id="p-precio" name="p_precio" inputMode="decimal" placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-lavados">Usos incluidos</Label>
              <Input id="p-lavados" name="p_lavados" inputMode="numeric" placeholder="4" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-vig">Duración (días)</Label>
              <Input id="p-vig" name="p_vigenciaDias" inputMode="numeric" placeholder="30" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-desc">Descripción</Label>
              <Input id="p-desc" name="p_descripcion" maxLength={300} />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="p_ilimitado" className="h-4 w-4 rounded border-border" />
              Usos ilimitados
            </label>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-titulo">Título</Label>
              <Input id="p-titulo" name="p_titulo" maxLength={120} placeholder="Ej. 20% en tu próximo servicio" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-descuento">Descuento (%)</Label>
              <Input id="p-descuento" name="p_descuento" inputMode="numeric" placeholder="20" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-descripcion">Descripción</Label>
              <Input id="p-descripcion" name="p_descripcion" maxLength={300} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-hasta">Vigente hasta</Label>
              <Input id="p-hasta" name="p_vigenciaHasta" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-usos">Usos por compra</Label>
              <Input id="p-usos" name="p_usos" inputMode="numeric" placeholder="1" />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
              <input type="checkbox" name="p_comprable" className="h-4 w-4 rounded border-border" />
              El cliente la compra (si no, es un beneficio directo)
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="p-precio2">Precio si es comprable (RD$)</Label>
              <Input id="p-precio2" name="p_precio" inputMode="decimal" placeholder="0" />
            </div>
          </div>
        )}
      </fieldset>

      {/* Empresas participantes */}
      <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Empresas participantes
        </legend>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            name="todasLasEmpresas"
            checked={todas}
            onChange={(e) => setTodas(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Todas las empresas activas ({empresas.length})
          <span className="text-xs font-normal text-muted-foreground">
            — incluye las que se agreguen después
          </span>
        </label>

        {!todas && (
          <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-border/60 p-3">
            {empresas.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  name="empresas"
                  value={e.id}
                  className="h-4 w-4 rounded border-border"
                />
                {e.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
        </>
      )}

      {/* ── CADENA: un eslabón por empresa, en orden ───────────────────── */}
      {modo === 'CADENA' && (
        <fieldset className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
          <legend className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Los eslabones de la cadena
          </legend>
          <p className="text-xs text-muted-foreground">
            El cliente recibe el <b>paso 1</b> al tomarlo. En cuanto lo usa por
            primera vez se le entrega el paso 2 en la otra empresa, y así
            sucesivamente.
          </p>

          {pasos.map((key, i) => (
            <div key={key} className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase text-primary">
                  Paso {i + 1}
                </span>
                {pasos.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPasos(pasos.filter((k) => k !== key))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Empresa que lo da *</Label>
                  <select
                    name="paso_companyId"
                    required
                    defaultValue=""
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                  >
                    <option value="" disabled>
                      Elegir empresa…
                    </option>
                    {empresas.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Beneficio *</Label>
                  <Input
                    name="paso_titulo"
                    required
                    maxLength={120}
                    placeholder={i === 0 ? 'Ej. Lavado gratis' : 'Ej. 20% en desayuno'}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Descripción</Label>
                  <Input name="paso_descripcion" maxLength={300} placeholder="Detalle para el cliente" />
                </div>
                <div className="space-y-1.5">
                  <Label>Imagen del beneficio (URL)</Label>
                  <Input name="paso_imagenUrl" placeholder="Si lo dejas vacío, usa la portada" />
                </div>
                <div className="space-y-1.5">
                  <Label>Descuento (%)</Label>
                  <Input name="paso_descuento" inputMode="numeric" placeholder="20" />
                </div>
                <div className="space-y-1.5">
                  <Label>Usos</Label>
                  <Input name="paso_usos" inputMode="numeric" placeholder="1" />
                </div>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPasos([...pasos, Date.now()])}
          >
            + Agregar otra empresa a la cadena
          </Button>
        </fieldset>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="gap-1.5">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Crear en borrador
        </Button>
        <p className="text-xs text-muted-foreground">
          Crear no reparte nada todavía: la campaña queda en borrador para que la revises.
        </p>
      </div>
    </form>
  )
}
